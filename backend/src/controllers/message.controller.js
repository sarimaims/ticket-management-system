import mongoose from 'mongoose';

import ApiError from '../utils/ApiError.js';
import Message from '../models/Message.js';
import Ticket from '../models/Ticket.js';
import { isRaiser, visibilityFilter } from '../services/ticketAccess.js';
import { notifyNewMessage } from '../services/notify.js';
import {
  ATTACHMENT_KINDS,
  buildKey,
  createDownloadUrl,
  createUploadUrl,
  describeObject,
  isConfigured as storageReady,
  keyPrefixFor,
  StorageUnavailable,
  validateUpload,
} from '../services/storage.js';

/** Same ceiling as the model, checked here so the error is a sentence. */
const MAX_BODY = 2000;

/** How much of a message the bell and the toast quote. */
const PREVIEW = 140;

async function present(message) {
  const attachment = message.attachment;

  return {
    id: String(message._id),
    ticket: String(message.ticket),
    author: { id: String(message.author), name: message.authorName },
    // What the author was when they wrote it, not what they are now.
    authorRole: message.authorRole,
    side: message.side,
    body: message.body,
    attachment: attachment
      ? {
          kind: attachment.kind,
          mimeType: attachment.mimeType,
          size: attachment.size,
          durationMs: attachment.durationMs ?? null,
          filename: attachment.filename || '',
          // Signed on the way out; expires long before it could be shared.
          url: await createDownloadUrl(attachment.key),
        }
      : null,
    createdAt: message.createdAt,
  };
}

/**
 * The ticket this thread hangs off, or 404.
 *
 * Reading the thread is exactly the right to read the ticket - the same filter
 * decides both - so there is no separate rule to keep in step. Not found and
 * not allowed answer the same, so the endpoint cannot be used to discover
 * which ticket ids exist.
 */
async function readableTicket(req) {
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.badRequest('Invalid ticket id.');

  const ticket = await Ticket.findOne({ _id: req.params.id, ...visibilityFilter(req.user) })
    .populate('department', 'name code')
    .populate('raisedBy', 'name email');

  if (!ticket) throw ApiError.notFound('Ticket not found.');
  return ticket;
}

/**
 * A cheap stand-in for the whole thread: how many lines it has and when the
 * last one landed. An open chat asks this every few seconds, and an unchanged
 * thread answers 304 with no body.
 */
async function fingerprint(ticketId) {
  const [count, newest] = await Promise.all([
    Message.countDocuments({ ticket: ticketId }),
    Message.findOne({ ticket: ticketId }).sort({ createdAt: -1 }).select('createdAt').lean(),
  ]);

  const last = newest?.createdAt ? new Date(newest.createdAt).getTime() : 0;
  // Signed links live an hour, so the tag turns over every half hour: a chat
  // left open overnight refetches rather than holding dead URLs.
  const window = Math.floor(Date.now() / (30 * 60 * 1000));
  return `W/"msg-${count}-${last}-${window}"`;
}

/** The whole conversation, oldest first - the order a chat is read in. */
export async function listMessages(req, res) {
  const ticket = await readableTicket(req);

  const tag = await fingerprint(ticket._id);
  res.set('ETag', tag);
  res.set('Cache-Control', 'private, no-cache');

  const offered = (req.headers['if-none-match'] ?? '').split(',').map((value) => value.trim());
  if (offered.includes(tag)) {
    res.status(304).end();
    return;
  }

  const messages = await Message.find({ ticket: ticket._id }).sort({ createdAt: 1 });

  res.json({ success: true, messages: await Promise.all(messages.map(present)) });
}

/**
 * Hands back a URL the browser may PUT one file to.
 *
 * The key is built here rather than taken from the caller: a client that could
 * name its own object could overwrite someone else's, or read one by guessing.
 * The ticket id is in the path, so every object can be traced to its thread.
 */
export async function createUploadTarget(req, res) {
  const ticket = await readableTicket(req);

  if (!storageReady()) {
    throw ApiError.unavailable(
      'File storage is not configured yet, so photos and voice notes cannot be sent.',
    );
  }

  const { kind, contentType, size, filename } = req.body ?? {};

  const problem = validateUpload({ kind, contentType, size });
  if (problem) throw ApiError.badRequest(problem);

  const key = buildKey({ ticketId: String(ticket._id), kind, filename, contentType });

  let target;
  try {
    target = await createUploadUrl({ key, contentType, size: Number(size) });
  } catch (error) {
    if (error instanceof StorageUnavailable) throw ApiError.unavailable(error.message);
    throw error;
  }

  res.json({ success: true, key, ...target });
}

/**
 * Says something on a ticket.
 *
 * Anyone who can read the ticket can write on it: the point of the thread is
 * that the raiser and the department can settle a question without one of them
 * editing the other's fields. Status, dates and assignment stay where they
 * were - talking about a ticket is not working it.
 */
export async function createMessage(req, res) {
  const ticket = await readableTicket(req);

  const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
  const attachment = await resolveAttachment(req, ticket);

  // A photo or a voice note says something on its own; only a line with
  // neither is nothing at all.
  if (!body && !attachment) throw ApiError.badRequest('Write something first.');
  if (body.length > MAX_BODY) {
    throw ApiError.badRequest(`A message cannot be longer than ${MAX_BODY} characters.`);
  }

  const message = await Message.create({
    ticket: ticket._id,
    author: req.user._id,
    authorName: req.user.name,
    authorRole: req.user.role,
    side: isRaiser(req.user, ticket) ? 'raiser' : 'department',
    body,
    attachment,
  });

  // The ticket carries the thread's size and its last line, so a list can show
  // that a conversation exists without reading it. Touching the ticket also
  // moves its updatedAt, which is what the queue's own tag is built from - so
  // an open list notices the message on its next poll.
  await Ticket.updateOne(
    { _id: ticket._id },
    { $inc: { messageCount: 1 }, $set: { lastMessageAt: message.createdAt } },
  );

  const trimmed = body.length > PREVIEW ? `${body.slice(0, PREVIEW - 1)}…` : body;
  await notifyNewMessage({
    ticket,
    actor: req.user,
    // A bell that says "Photo" is more use than one that says nothing.
    preview: trimmed || (attachment ? ATTACHMENT_KINDS[attachment.kind].label : ''),
  });

  res.status(201).json({ success: true, message: await present(message) });
}

/**
 * Turns the key the browser uploaded to into something worth storing.
 *
 * The object is inspected in the bucket first: that proves the upload actually
 * finished, and means the size and type recorded are S3's own rather than
 * whatever the client claimed. The key is checked against this ticket's own
 * prefix, so a message cannot be made to point at another thread's file.
 */
async function resolveAttachment(req, ticket) {
  const input = req.body?.attachment;
  if (!input) return null;

  if (!storageReady()) {
    throw ApiError.unavailable('File storage is not configured yet.');
  }

  const { kind, key, durationMs, filename } = input;
  if (!ATTACHMENT_KINDS[kind]) throw ApiError.badRequest('Unknown attachment kind.');
  if (typeof key !== 'string' || !key) throw ApiError.badRequest('The upload key is missing.');

  // The key names its ticket, so one thread cannot be made to show another's file.
  if (!key.startsWith(keyPrefixFor({ ticketId: String(ticket._id), kind }))) {
    throw ApiError.badRequest('That upload does not belong to this ticket.');
  }

  let object;
  try {
    object = await describeObject(key);
  } catch (error) {
    // Storage being unusable and the file being absent are different problems
    // and deserve different answers.
    if (error instanceof StorageUnavailable) throw ApiError.unavailable(error.message);
    throw ApiError.badRequest('That upload did not finish. Try sending it again.');
  }

  const problem = validateUpload({ kind, contentType: object.contentType, size: object.size });
  if (problem) throw ApiError.badRequest(problem);

  return {
    kind,
    key,
    mimeType: object.contentType,
    size: object.size,
    durationMs: Number.isFinite(Number(durationMs)) ? Math.round(Number(durationMs)) : null,
    filename: typeof filename === 'string' ? filename.slice(0, 120) : '',
  };
}
