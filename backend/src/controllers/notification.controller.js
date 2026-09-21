import mongoose from 'mongoose';

import Notification from '../models/Notification.js';
import { addClient } from '../services/stream.js';

const MAX_FEED = 40;

function present(item) {
  return {
    id: String(item._id),
    type: item.type,
    ticket: item.ticket ? String(item.ticket) : null,
    ticketNumber: item.ticketNumber,
    title: item.title,
    body: item.body,
    actorName: item.actorName,
    departmentName: item.departmentName,
    // Which page this copy belongs on: see the field on the model. Null on
    // rows written before it existed, and the client has a rule for those.
    forRaiser: item.forRaiser ?? null,
    read: Boolean(item.readAt),
    createdAt: item.createdAt,
  };
}

/**
 * Everything addressed to the caller, newest first. Nobody can read anyone
 * else's: the recipient is the filter, and there is no parameter to widen it.
 */
export async function listNotifications(req, res) {
  const limit = Math.min(Number(req.query.limit) || MAX_FEED, MAX_FEED);

  const [items, unread] = await Promise.all([
    Notification.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(limit),
    Notification.countDocuments({ user: req.user._id, readAt: null }),
  ]);

  res.json({ success: true, notifications: items.map(present), unread });
}

/** Marks the caller's notifications read: the given ids, or all of them. */
export async function markRead(req, res) {
  const { ids } = req.body ?? {};

  const filter = { user: req.user._id, readAt: null };
  if (Array.isArray(ids) && ids.length > 0) {
    const valid = ids.filter((id) => mongoose.isValidObjectId(id));
    filter._id = { $in: valid };
  }

  const result = await Notification.updateMany(filter, { $set: { readAt: new Date() } });
  const unread = await Notification.countDocuments({ user: req.user._id, readAt: null });

  res.json({ success: true, marked: result.modifiedCount, unread });
}

/** Clears the caller's own feed. Nobody else's is reachable from here. */
export async function clearNotifications(req, res) {
  const result = await Notification.deleteMany({ user: req.user._id });
  res.json({ success: true, cleared: result.deletedCount });
}

/** How often a comment frame is sent to keep the connection from idling out. */
const HEARTBEAT_MS = 25_000;

/**
 * An open stream of this person's events, one per tab.
 *
 * Nothing about anyone else travels down it: the connection is keyed on the
 * caller, and the payload only says that something arrived - the tab then
 * reads its own feed through the normal, authorised endpoint.
 */
export function streamNotifications(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Proxies that buffer would defeat the point of a stream.
    'X-Accel-Buffering': 'no',
  });

  // Tell the browser how soon to come back if this drops.
  res.write('retry: 5000\n\n');
  res.write('event: ready\ndata: {}\n\n');

  const remove = addClient(req.user._id, res);
  const heartbeat = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      /* the close handler below does the cleanup */
    }
  }, HEARTBEAT_MS);

  req.on('close', () => {
    clearInterval(heartbeat);
    remove();
    res.end();
  });
}
