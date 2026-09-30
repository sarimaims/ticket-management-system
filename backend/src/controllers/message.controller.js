import mongoose from 'mongoose';

import ApiError from '../utils/ApiError.js';
import Message from '../models/Message.js';
import ThreadRead from '../models/ThreadRead.js';
import Ticket from '../models/Ticket.js';
import { isRaiser, visibilityFilter } from '../services/ticketAccess.js';
import User, { MANAGER_ROLES } from '../models/User.js';
import { notifyNewMessage } from '../services/notify.js';
import { record } from '../services/activity.js';
import { cleanFilename, filenameWords } from '../utils/fileName.js';
import { statusOf } from '../services/overdue.js';
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

/** How much of a line is repeated in the quote above a reply. */
const QUOTE = 160;

/**
 * Where these people sit in the org, as it stands today.
 *
 * Read live rather than snapshotted like the author's name: the menu on a
 * message answers "who is this, and who do they answer to", which is only
 * worth showing if it is current. One query covers a whole thread.
 */
/** The departments a ticket touches, in the order a title is looked for. */
function departmentsOf(ticket) {
  return [
    ticket.department?._id ?? ticket.department,
    ...(ticket.departments ?? []).map((item) => item?._id ?? item),
    ...(ticket.fromDepartments ?? []).map((item) => item?._id ?? item),
  ]
    .filter(Boolean)
    .map(String);
}

/**
 * The title a person goes by in this thread.
 *
 * Designation is per role, so it is looked for in the department working the
 * ticket first, then in the one it was raised from - whichever end of the
 * conversation this person is on - and only then anywhere they hold one. An
 * admin holds no roles and carries theirs on the account.
 */
function titleOnTicket(affiliation, departmentIds) {
  if (!affiliation) return '';
  for (const id of departmentIds) {
    const role = affiliation.departments.find((item) => item.id === id && item.designation);
    if (role) return role.designation;
  }
  if (affiliation.designation) return affiliation.designation;
  return affiliation.departments.find((item) => item.designation)?.designation ?? '';
}

async function affiliationsFor(authorIds) {
  const unique = [...new Set(authorIds.filter(Boolean).map(String))];
  if (unique.length === 0) return new Map();

  const users = await User.find({ _id: { $in: unique } })
    .select('memberships designation')
    .populate({
      path: 'memberships.department',
      select: 'name unit',
      populate: { path: 'unit', select: 'name' },
    })
    .lean();

  return new Map(
    users.map((user) => {
      const departments = [];
      const units = [];

      for (const membership of user.memberships ?? []) {
        const department = membership.department;
        if (!department) continue;

        departments.push({
          id: String(department._id),
          name: department.name,
          role: membership.role,
          designation: membership.designation ?? '',
        });

        // One unit can hold several of someone's departments; it is named once.
        const unit = department.unit;
        if (unit && !units.some((item) => item.id === String(unit._id))) {
          units.push({ id: String(unit._id), name: unit.name });
        }
      }

      return [String(user._id), { departments, units, designation: user.designation ?? '' }];
    }),
  );
}

/**
 * Who is expected to read this thread: the person who raised the ticket and
 * whoever is holding it.
 *
 * Deliberately not "everyone who can see the ticket" - an admin can open any
 * thread in the workspace, and a line would never go blue if it waited for all
 * of them. The author is left out of their own audience.
 */
function audienceFor(ticket) {
  const people = new Set();

  const raiser = ticket.raisedBy?._id ?? ticket.raisedBy;
  if (raiser) people.add(String(raiser));
  for (const person of ticket.assignees ?? []) people.add(String(person?._id ?? person));

  return people;
}

/** The originals quoted by these messages, in one query. */
async function repliesFor(messages) {
  const ids = [
    ...new Set(
      messages
        .map((message) => message.replyTo)
        .filter(Boolean)
        .map(String),
    ),
  ];
  if (ids.length === 0) return new Map();

  const originals = await Message.find({ _id: { $in: ids } })
    .select('author authorName body attachment deletedAt')
    .lean();

  return new Map(originals.map((original) => [String(original._id), original]));
}

/**
 * One line, as a particular reader may see it.
 *
 * A withdrawn message is a tombstone to the people in the thread: they are
 * told it existed and that it is gone, but not what it said. An admin reads it
 * in full, along with every earlier version of an edited line - a record that
 * can be quietly rewritten is not a record.
 */
async function present(message, viewer, context = {}) {
  const manager = MANAGER_ROLES.includes(viewer.role);
  const deleted = Boolean(message.deletedAt);
  const hidden = deleted && !manager;
  const attachment = hidden ? null : message.attachment;

  const affiliation = context.affiliations?.get(String(message.author));

  /**
   * How far this line has got: sent, seen by some of the people it was for, or
   * seen by all of them. Read from when each of them last had the thread open,
   * which is the honest version of a read receipt.
   */
  const audience = [...(context.audience ?? [])].filter(
    (id) => id !== String(message.author),
  );
  const written = new Date(message.createdAt ?? Date.now()).getTime();
  const seenBy = audience.filter((id) => {
    const at = context.lastSeen?.get(id);
    return at ? new Date(at).getTime() >= written : false;
  }).length;
  const original = message.replyTo ? context.replies?.get(String(message.replyTo)) : null;
  const quoteHidden = Boolean(original?.deletedAt) && !manager;

  return {
    id: String(message._id),
    ticket: String(message.ticket),
    /** Delivered, and how much of its audience has had the thread open since. */
    seen: { by: seenBy, of: audience.length },
    /** 'text' for something somebody said, 'system' for something that happened. */
    kind: message.kind ?? 'text',
    event: message.event ?? null,
    author: { id: String(message.author), name: message.authorName },
    /** Who the author works for now - shown in the menu on their message. */
    authorDepartments: affiliation?.departments ?? [],
    // Looked for at the end of the ticket this line was written from: somebody
    // in both departments speaks as the requester in one line and as the
    // department in the next, and their title should follow.
    authorDesignation: titleOnTicket(
      affiliation,
      message.side === 'raiser'
        ? [...(context.ticketDepartments ?? []).slice(1), ...(context.ticketDepartments ?? []).slice(0, 1)]
        : context.ticketDepartments ?? [],
    ),
    authorUnits: affiliation?.units ?? [],
    /**
     * The line being answered, quoted. A reference rather than a copy, so a
     * correction to the original shows through here too.
     */
    replyTo: original
      ? {
          id: String(original._id),
          author: { id: String(original.author), name: original.authorName },
          deleted: Boolean(original.deletedAt),
          body: quoteHidden ? '' : (original.body ?? '').slice(0, QUOTE),
          attachmentKind: quoteHidden ? null : (original.attachment?.kind ?? null),
        }
      : null,
    // What the author was when they wrote it, not what they are now.
    authorRole: message.authorRole,
    side: message.side,
    body: hidden ? '' : message.body,
    /** Corrected by its author, and when. */
    editedAt: message.editedAt ?? null,
    deleted,
    deletedAt: message.deletedAt ?? null,
    /** Who withdrew it - only worth naming to someone who can see the text. */
    deletedBy: deleted && manager ? message.deletedByName || null : null,
    /**
     * Earlier versions, for an admin only. Everyone else is told a line was
     * edited; only an admin is shown what it replaced.
     */
    revisions:
      manager && message.revisions?.length
        ? message.revisions.map((revision) => ({
            body: revision.body,
            replacedAt: revision.replacedAt,
          }))
        : [],
    /** True when this reader is seeing something the thread cannot. */
    adminOnly: deleted && manager,
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

/** The same, for an answer that carries one message rather than a thread. */
async function presentOne(message, viewer, ticket) {
  const [affiliations, replies, reads] = await Promise.all([
    affiliationsFor([message.author]),
    repliesFor([message]),
    ThreadRead.find({ ticket: message.ticket }).select('user lastSeenAt').lean(),
  ]);

  return present(message, viewer, {
    affiliations,
    replies,
    ticketDepartments: ticket ? departmentsOf(ticket) : [],
    audience: ticket ? audienceFor(ticket) : new Set(),
    lastSeen: new Map(reads.map((read) => [String(read.user), read.lastSeenAt])),
  });
}

/** The message named in the URL, on the ticket named in the URL. */
async function readableMessage(req, ticket) {
  if (!mongoose.isValidObjectId(req.params.messageId)) {
    throw ApiError.badRequest('Invalid message id.');
  }

  const message = await Message.findOne({ _id: req.params.messageId, ticket: ticket._id });
  if (!message) throw ApiError.notFound('Message not found.');
  return message;
}

/**
 * Only the author may change their own line.
 *
 * Deliberately not extended to admins: an admin editing someone else's words
 * under their name would make the thread untrustworthy. Admins read
 * everything; they do not speak for anyone.
 */
function assertNotSystem(message) {
  if (message.kind === 'system') {
    throw ApiError.badRequest('That line is part of the ticket\'s record, not a message.');
  }
}

function assertAuthor(message, user) {
  if (String(message.author) !== String(user._id)) {
    throw ApiError.forbidden('You can only change your own messages.');
  }
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
    // updatedAt, not createdAt: an edit or a withdrawal changes the thread
    // without adding to it, and an open chat has to notice.
    Message.findOne({ ticket: ticketId }).sort({ updatedAt: -1 }).select('updatedAt').lean(),
  ]);

  const last = newest?.updatedAt ? new Date(newest.updatedAt).getTime() : 0;
  // Signed links live an hour, so the tag turns over every half hour: a chat
  // left open overnight refetches rather than holding dead URLs.
  const window = Math.floor(Date.now() / (30 * 60 * 1000));
  return `W/"msg-${count}-${last}-${window}"`;
}

/**
 * Notes that this reader has the thread open.
 *
 * Written on every read of the thread, including the ones that answer 304:
 * the point is when someone last looked, and a poll that finds nothing new is
 * still someone looking. Failures are swallowed - not knowing who has seen a
 * message must never stop the message being delivered.
 */
async function markSeen(ticket, user) {
  try {
    await ThreadRead.updateOne(
      { ticket: ticket._id, user: user._id },
      { $set: { lastSeenAt: new Date(), userName: user.name } },
      { upsert: true },
    );
  } catch {
    // A racing upsert can collide on the unique key; the next poll settles it.
  }
}

/**
 * When one line was said, and who has had the thread open since.
 *
 * "Seen" here means the conversation was open after this was written, which is
 * what a thread read top to bottom actually tells you. The author is left out
 * of their own list.
 */
export async function messageInfo(req, res) {
  const ticket = await readableTicket(req);
  const message = await readableMessage(req, ticket);

  const reads = await ThreadRead.find({
    ticket: ticket._id,
    user: { $ne: message.author },
    lastSeenAt: { $gte: message.createdAt },
  })
    .sort({ lastSeenAt: 1 })
    .lean();

  // One row per person: the unique index is the guard, this is the belt.
  const seen = [];
  const counted = new Set();
  for (const read of reads) {
    const id = String(read.user);
    if (counted.has(id)) continue;
    counted.add(id);
    seen.push({ id, name: read.userName || 'Someone', at: read.lastSeenAt });
  }

  res.json({
    success: true,
    info: {
      sentAt: message.createdAt,
      editedAt: message.editedAt ?? null,
      deletedAt: message.deletedAt ?? null,
      seenBy: seen,
    },
  });
}

/** The whole conversation, oldest first - the order a chat is read in. */
export async function listMessages(req, res) {
  const ticket = await readableTicket(req);
  await markSeen(ticket, req.user);

  const tag = await fingerprint(ticket._id);
  res.set('ETag', tag);
  res.set('Cache-Control', 'private, no-cache');

  const offered = (req.headers['if-none-match'] ?? '').split(',').map((value) => value.trim());
  if (offered.includes(tag)) {
    res.status(304).end();
    return;
  }

  const messages = await Message.find({ ticket: ticket._id }).sort({ createdAt: 1 });

  // Three queries for the whole thread rather than three per line, and all of
  // them at once - the database is far enough away that a round trip costs
  // more than everything else here put together.
  const [affiliations, replies, reads] = await Promise.all([
    affiliationsFor(messages.map((message) => message.author)),
    repliesFor(messages),
    ThreadRead.find({ ticket: ticket._id }).select('user lastSeenAt').lean(),
  ]);

  const lastSeen = new Map(reads.map((read) => [String(read.user), read.lastSeenAt]));
  const audience = audienceFor(ticket);

  res.json({
    success: true,
    messages: await Promise.all(
      messages.map((message) =>
        present(message, req.user, {
          affiliations,
          replies,
          audience,
          lastSeen,
          ticketDepartments: departmentsOf(ticket),
        }),
      ),
    ),
  });
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
  const replyTo = await resolveReply(req, ticket);

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
    replyTo,
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
    // A file's own name says more than its kind: "Document" tells nobody
    // whether it is the invoice they were waiting for.
    preview:
      trimmed ||
      (attachment
        ? attachment.kind !== 'voice' && attachment.filename
          ? `${ATTACHMENT_KINDS[attachment.kind].label}: ${attachment.filename}`
          : ATTACHMENT_KINDS[attachment.kind].label
        : ''),
  });

  res.status(201).json({ success: true, message: await presentOne(message, req.user, ticket) });
}

/**
 * Corrects a line already said.
 *
 * The previous text is kept rather than replaced: everyone sees that it was
 * edited, and an admin can see what it used to say. An attachment is not
 * touched - a photo cannot be swapped for another under the same message.
 */
export async function updateMessage(req, res) {
  const ticket = await readableTicket(req);
  const message = await readableMessage(req, ticket);

  assertNotSystem(message);
  assertAuthor(message, req.user);
  if (message.deletedAt) throw ApiError.badRequest('That message was deleted.');

  const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
  if (!body && !message.attachment) throw ApiError.badRequest('Write something first.');
  if (body.length > MAX_BODY) {
    throw ApiError.badRequest(`A message cannot be longer than ${MAX_BODY} characters.`);
  }

  // Saying the same thing again is not an edit.
  if (body !== message.body) {
    message.revisions.push({ body: message.body, replacedAt: new Date() });
    message.body = body;
    message.editedAt = new Date();
    await message.save();

    // Changing what was said is worth a line of its own: the thread shows
    // that it happened, the log shows who and when, and an admin can still
    // read both versions on the message itself.
    await record({
      actor: req.user,
      department: ticket.department,
      action: 'message.edited',
      summary: `edited a message on ${ticket.number}`,
      ticketNumber: ticket.number,
    });
  }

  res.json({ success: true, message: await presentOne(message, req.user, ticket) });
}

/**
 * Withdraws a line.
 *
 * Nothing is removed from the database and no attachment is deleted from
 * storage: the thread shows that a message was withdrawn, and an admin can
 * still read it. A hard delete would let a thread be rewritten after the fact.
 */
export async function deleteMessage(req, res) {
  const ticket = await readableTicket(req);
  const message = await readableMessage(req, ticket);

  assertNotSystem(message);
  assertAuthor(message, req.user);

  if (!message.deletedAt) {
    message.deletedAt = new Date();
    message.deletedBy = req.user._id;
    message.deletedByName = req.user.name;
    await message.save();

    // The ticket's own counter follows what the thread now shows.
    await Ticket.updateOne({ _id: ticket._id }, { $inc: { messageCount: -1 } });

    await record({
      actor: req.user,
      department: ticket.department,
      action: 'message.deleted',
      summary: `withdrew a message on ${ticket.number}`,
      ticketNumber: ticket.number,
    });
  }

  res.json({ success: true, message: await presentOne(message, req.user, ticket) });
}

/**
 * The line being answered, checked to be on this same ticket.
 *
 * Without that check a reply could quote a message from a thread the reader
 * cannot see, and the quote would carry its text into a place it does not
 * belong.
 */
async function resolveReply(req, ticket) {
  const value = req.body?.replyTo;
  if (!value) return null;

  if (!mongoose.isValidObjectId(value)) throw ApiError.badRequest('Invalid message id.');

  const original = await Message.findOne({ _id: value, ticket: ticket._id }).select('_id');
  if (!original) throw ApiError.badRequest('That message is not on this ticket.');

  return original._id;
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
    // The sender's own name for it, which is what a search for it will use. A
    // voice note has none, so it is given one worth finding by date.
    filename: cleanFilename(
      filename,
      kind === 'voice' ? `Voice note ${new Date().toISOString().slice(0, 16).replace('T', ' ')}` : '',
    ),
  };
}

/** A web address inside a message, as people type them. */
const LINK = /\bhttps?:\/\/[^\s<>"']+/gi;

/** The same pattern, in the form a Mongo query takes. */
const LINK_SOURCE = /https?:\/\//i;

/** Trailing punctuation belongs to the sentence, not the address. */
const trimLink = (url) => url.replace(/[.,;:!?)\]]+$/, '');

/**
 * Everything this thread has shared, the way a phone groups it: media, the
 * documents, and the links - with the request's own attachments included,
 * because the paperwork a ticket was raised with is part of what was shared.
 *
 * `q` narrows all three by the words in it, matched one word at a time against
 * the name each file was sent with. "digital salary" then finds
 * "aims-digital-salary-list.xlsx", which a plain substring search would not.
 *
 * A withdrawn message is gone from here for everyone but an admin, exactly as
 * it is gone from the thread.
 */
export async function listMedia(req, res) {
  const ticket = await readableTicket(req);
  const manager = MANAGER_ROLES.includes(req.user.role);

  const words = filenameWords(typeof req.query.q === 'string' ? req.query.q : '');

  const filter = {
    ticket: ticket._id,
    ...(manager ? {} : { deletedAt: null }),
    $or: [{ 'attachment.kind': { $in: ['image', 'video', 'file'] } }, { body: LINK_SOURCE }],
  };

  const messages = await Message.find(filter)
    .sort({ createdAt: -1 })
    .select('author authorName body attachment createdAt deletedAt')
    .limit(500)
    .lean();

  const matchesName = (name) => {
    if (words.length === 0) return true;
    const own = filenameWords(name).join(' ');
    return words.every((word) => own.includes(word));
  };

  const matchesText = (text) => {
    if (words.length === 0) return true;
    const lower = String(text ?? '').toLowerCase();
    return words.every((word) => lower.includes(word));
  };

  const media = [];
  const documents = [];
  const links = [];

  for (const message of messages) {
    const by = { id: String(message.author), name: message.authorName };
    const attachment = message.attachment;

    if (attachment && ['image', 'video', 'file'].includes(attachment.kind)) {
      if (!matchesName(attachment.filename)) continue;

      const entry = {
        id: String(message._id),
        from: 'chat',
        kind: attachment.kind,
        filename: attachment.filename || '',
        mimeType: attachment.mimeType,
        size: attachment.size,
        url: await createDownloadUrl(attachment.key),
        by,
        createdAt: message.createdAt,
      };
      (attachment.kind === 'file' ? documents : media).push(entry);
    }

    const found = [...new Set((message.body ?? '').match(LINK) ?? [])].map(trimLink);
    for (const url of found) {
      if (!matchesText(`${url} ${message.body}`)) continue;
      links.push({
        id: `${message._id}-${links.length}`,
        messageId: String(message._id),
        url,
        // The line it was said in: "the invoice is here" is what makes a
        // link findable a week later.
        context: message.body.slice(0, 160),
        by,
        createdAt: message.createdAt,
      });
    }
  }

  // The request's own attachments, which the raiser sent before there was a
  // conversation to send them in.
  for (const [index, file] of (ticket.attachments ?? []).entries()) {
    if (!matchesName(file.filename)) continue;
    const family = file.mimeType?.startsWith('image/')
      ? 'image'
      : file.mimeType?.startsWith('video/')
        ? 'video'
        : 'file';

    const entry = {
      id: `request-${index}`,
      from: 'request',
      kind: family,
      filename: file.filename || '',
      mimeType: file.mimeType,
      size: file.size,
      url: await createDownloadUrl(file.key),
      by: { id: String(ticket.raisedBy?._id ?? ticket.raisedBy), name: ticket.raisedBy?.name ?? '' },
      createdAt: file.uploadedAt ?? ticket.createdAt,
    };
    (family === 'file' ? documents : media).push(entry);
  }

  const newest = (a, b) => new Date(b.createdAt) - new Date(a.createdAt);

  res.json({
    success: true,
    media: media.sort(newest),
    documents: documents.sort(newest),
    links: links.sort(newest),
  });
}

/** How many of each kind the library hands back at once, newest first. */
const LIBRARY_LIMIT = 400;

/** How many messages are read to build it: attachments and links only. */
const LIBRARY_SCAN = 3000;

/** Which shelf a file belongs on, by what it is rather than how it was sent. */
const shelfOf = (kind, mimeType) =>
  kind === 'image' || mimeType?.startsWith('image/')
    ? 'image'
    : kind === 'video' || mimeType?.startsWith('video/')
      ? 'video'
      : 'document';

/**
 * Every photo, video, document and link across all the tickets this person
 * can see - the place to go when you remember the file but not the ticket.
 *
 * Drawn from three places: what was attached when each request was raised,
 * what was sent in each conversation, and the links in both the requests and
 * the messages. Voice notes are left out: nobody searches for one by name.
 *
 * `q` is matched a word at a time against everything a person might remember
 * about a file - its name, the ticket's number and subject, who sent it and
 * which department it went to - so "salary digital" finds
 * "aims-digital-salary-list.xlsx", and "0058" finds everything on TK-0058.
 *
 * Visibility is the tickets' own: nothing here is readable that the ticket it
 * came from is not, and a withdrawn message is gone for everyone but an admin.
 */
export async function listLibrary(req, res) {
  const manager = MANAGER_ROLES.includes(req.user.role);
  const words = filenameWords(typeof req.query.q === 'string' ? req.query.q : '');

  const tickets = await Ticket.find(visibilityFilter(req.user))
    .select('number subject status deadline committedDeadline department departments raisedBy attachments description createdAt')
    .populate('department', 'name')
    .populate('departments', 'name')
    .populate('raisedBy', 'name')
    .lean();

  const byId = new Map(tickets.map((ticket) => [String(ticket._id), ticket]));

  const messages = await Message.find({
    ticket: { $in: tickets.map((ticket) => ticket._id) },
    ...(manager ? {} : { deletedAt: null }),
    $or: [{ 'attachment.kind': { $in: ['image', 'video', 'file'] } }, { body: LINK_SOURCE }],
  })
    .sort({ createdAt: -1 })
    .select('ticket author authorName body attachment createdAt')
    .limit(LIBRARY_SCAN)
    .lean();

  /** What the row says about where it came from, so it can be opened. */
  const ticketOf = (ticket) => ({
    id: String(ticket._id),
    number: ticket.number,
    subject: ticket.subject,
    status: statusOf(ticket),
    // Every department a shared ticket went to.
    department:
      (ticket.departments ?? []).length > 1
        ? ticket.departments.map((item) => item?.name).filter(Boolean).join(', ')
        : ticket.department?.name ?? '',
    raisedById: String(ticket.raisedBy?._id ?? ticket.raisedBy ?? ''),
  });

  /** Every word of the search, somewhere in what is known about the item. */
  const matches = (...parts) => {
    if (words.length === 0) return true;
    const known = filenameWords(parts.filter(Boolean).join(' ')).join(' ');
    return words.every((word) => known.includes(word));
  };

  const items = [];

  const addFile = async ({ id, from, kind, key, filename, mimeType, size, by, createdAt, ticket }) => {
    const name = filename || '';
    if (!matches(name, ticket.number, ticket.subject, by.name, ticket.department?.name)) return;
    items.push({
      id,
      type: shelfOf(kind, mimeType),
      from,
      filename: name,
      mimeType,
      size,
      // One link to look at it, one that arrives as a download.
      url: await createDownloadUrl(key),
      downloadUrl: await createDownloadUrl(key, { saveAs: name || 'attachment' }),
      by,
      createdAt,
      ticket: ticketOf(ticket),
    });
  };

  const addLinks = ({ idPrefix, from, text, by, createdAt, ticket, messageId = null }) => {
    const found = [...new Set(String(text ?? '').match(LINK) ?? [])].map(trimLink);
    for (const [index, url] of found.entries()) {
      if (!matches(url, text, ticket.number, ticket.subject, by.name)) continue;
      items.push({
        id: `${idPrefix}-link-${index}`,
        type: 'link',
        from,
        url,
        messageId,
        // The sentence it was posted in is what makes a link findable later.
        context: String(text).slice(0, 200),
        by,
        createdAt,
        ticket: ticketOf(ticket),
      });
    }
  };

  /* eslint-disable no-await-in-loop -- signing is local work, not a round trip */
  for (const message of messages) {
    const ticket = byId.get(String(message.ticket));
    if (!ticket) continue;
    const by = { id: String(message.author), name: message.authorName };
    const attachment = message.attachment;

    if (attachment && ['image', 'video', 'file'].includes(attachment.kind)) {
      await addFile({
        id: String(message._id),
        from: 'chat',
        kind: attachment.kind,
        key: attachment.key,
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        size: attachment.size,
        by,
        createdAt: message.createdAt,
        ticket,
      });
    }

    if (message.body) {
      addLinks({
        idPrefix: String(message._id),
        from: 'chat',
        text: message.body,
        by,
        createdAt: message.createdAt,
        ticket,
        messageId: String(message._id),
      });
    }
  }

  // The paperwork each request was raised with, and any links in the ask.
  for (const ticket of tickets) {
    const raiser = {
      id: String(ticket.raisedBy?._id ?? ticket.raisedBy ?? ''),
      name: ticket.raisedBy?.name ?? '',
    };

    for (const [index, file] of (ticket.attachments ?? []).entries()) {
      await addFile({
        id: `${ticket._id}-request-${index}`,
        from: 'request',
        kind: null,
        key: file.key,
        filename: file.filename,
        mimeType: file.mimeType,
        size: file.size,
        by: raiser,
        createdAt: file.uploadedAt ?? ticket.createdAt,
        ticket,
      });
    }

    addLinks({
      idPrefix: `${ticket._id}-request`,
      from: 'request',
      text: ticket.description,
      by: raiser,
      createdAt: ticket.createdAt,
      ticket,
    });
  }
  /* eslint-enable no-await-in-loop */

  items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const counts = { image: 0, video: 0, document: 0, link: 0 };
  const kept = [];
  for (const item of items) {
    counts[item.type] += 1;
    if (counts[item.type] <= LIBRARY_LIMIT) kept.push(item);
  }

  res.json({
    success: true,
    counts,
    /** How many tickets the answer was drawn from. */
    tickets: new Set(items.map((item) => item.ticket.id)).size,
    items: kept,
  });
}
