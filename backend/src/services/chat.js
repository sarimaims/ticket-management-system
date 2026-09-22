import Message from '../models/Message.js';

/**
 * Writes a line the ticket says about itself: raised, retitled, handed over.
 *
 * It lands in the thread with everything else, because what happened to a
 * request and what was said about it are the same story, and reading one
 * without the other leaves people asking questions the log already answered.
 *
 * Deliberately not counted on the ticket: `messageCount` and `lastMessageAt`
 * drive the unread badge, and nobody needs to be chased to read that a
 * deadline moved - the bell already says so.
 *
 * Like the activity log, this must never break the action it describes.
 */
export async function postSystemMessage({ ticket, actor, event, body, side = 'department' }) {
  try {
    return await Message.create({
      ticket: ticket._id ?? ticket,
      kind: 'system',
      event,
      author: actor?._id ?? null,
      authorName: actor?.name ?? 'Someone',
      authorRole: actor?.role ?? 'user',
      side,
      body,
    });
  } catch (error) {
    console.error('System message failed:', error.message);
    return null;
  }
}
