import mongoose from 'mongoose';

import ApiError from '../utils/ApiError.js';
import Message from '../models/Message.js';
import Ticket from '../models/Ticket.js';
import { isRaiser, visibilityFilter } from '../services/ticketAccess.js';
import { notifyNewMessage } from '../services/notify.js';

/** Same ceiling as the model, checked here so the error is a sentence. */
const MAX_BODY = 2000;

/** How much of a message the bell and the toast quote. */
const PREVIEW = 140;

function present(message) {
  return {
    id: String(message._id),
    ticket: String(message.ticket),
    author: { id: String(message.author), name: message.authorName },
    // What the author was when they wrote it, not what they are now.
    authorRole: message.authorRole,
    side: message.side,
    body: message.body,
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
  return `W/"msg-${count}-${last}"`;
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

  res.json({ success: true, messages: messages.map(present) });
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
  if (!body) throw ApiError.badRequest('Write something first.');
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
  });

  // The ticket carries the thread's size and its last line, so a list can show
  // that a conversation exists without reading it. Touching the ticket also
  // moves its updatedAt, which is what the queue's own tag is built from - so
  // an open list notices the message on its next poll.
  await Ticket.updateOne(
    { _id: ticket._id },
    { $inc: { messageCount: 1 }, $set: { lastMessageAt: message.createdAt } },
  );

  await notifyNewMessage({
    ticket,
    actor: req.user,
    preview: body.length > PREVIEW ? `${body.slice(0, PREVIEW - 1)}…` : body,
  });

  res.status(201).json({ success: true, message: present(message) });
}
