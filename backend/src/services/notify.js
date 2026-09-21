import Notification from '../models/Notification.js';
import User from '../models/User.js';
import { publish } from './stream.js';

/**
 * Everyone in a department: head and team alike. Managers are not members of
 * anything, so they are never pulled in here - they would otherwise be
 * notified about every ticket in the workspace.
 */
async function departmentMemberIds(departmentId) {
  const members = await User.find({ 'memberships.department': departmentId }).select('_id');
  return members.map((member) => member._id);
}

/**
 * Writes one notification per recipient. Like the activity log, this must
 * never break the action that triggered it: a failure here is logged and
 * swallowed, because a ticket being raised matters more than the bell.
 */
async function deliver({ recipients, exclude, type, ticket, title, body, actorName }) {
  const excluded = String(exclude ?? '');
  const unique = [...new Set(recipients.map(String))].filter((id) => id !== excluded);
  if (unique.length === 0) return 0;

  const department = ticket.department;
  const raiser = String(ticket.raisedBy?._id ?? ticket.raisedBy ?? '');
  const rows = unique.map((user) => ({
    user,
    type,
    ticket: ticket._id,
    ticketNumber: ticket.number,
    title,
    body,
    actorName,
    departmentName: department?.name ?? '',
    // One event, two audiences: the raiser reads it on My Requests, the
    // department on its queue. Stored per copy, because by the time it is
    // clicked nothing else knows which side the reader was on.
    forRaiser: raiser !== '' && String(user) === raiser,
  }));

  await Notification.insertMany(rows);

  // The feed is now different for each of these people; their open tabs are
  // told so they can announce it without waiting for their next poll.
  for (const user of unique) publish(user, 'notification', { type, ticketNumber: ticket.number });

  return rows.length;
}

/** A ticket just landed in a department: tell its head and its team. */
export async function notifyNewTicket({ ticket, actor }) {
  try {
    const departmentId = ticket.department?._id ?? ticket.department;
    return await deliver({
      recipients: await departmentMemberIds(departmentId),
      exclude: actor._id,
      type: 'ticket.new',
      ticket,
      title: `${ticket.number} · new request`,
      body: ticket.subject,
      actorName: actor.name,
    });
  } catch (error) {
    console.error('Notification failed (ticket.new):', error.message);
    return 0;
  }
}

/**
 * The raiser changed their own request: tell the department that has to act on
 * it, because what they were asked for is no longer what they read yesterday.
 * Only the receiving side is notified - the raiser made the change.
 */
export async function notifyTicketEdited({ ticket, actor, summary }) {
  try {
    const departmentId = ticket.department?._id ?? ticket.department;
    return await deliver({
      recipients: await departmentMemberIds(departmentId),
      exclude: actor._id,
      type: 'ticket.edited',
      ticket,
      title: `${ticket.number} · request updated`,
      body: summary,
      actorName: actor.name,
    });
  } catch (error) {
    console.error('Notification failed (ticket.edited):', error.message);
    return 0;
  }
}

/**
 * A ticket moved: tell the person who raised it and the department working it.
 * `summary` is the same human line the activity log records.
 */
export async function notifyTicketUpdated({ ticket, actor, summary }) {
  try {
    const departmentId = ticket.department?._id ?? ticket.department;
    const raiser = ticket.raisedBy?._id ?? ticket.raisedBy;

    return await deliver({
      recipients: [...(await departmentMemberIds(departmentId)), raiser],
      exclude: actor._id,
      type: 'ticket.updated',
      ticket,
      title: `${ticket.number} · updated`,
      body: summary,
      actorName: actor.name,
    });
  } catch (error) {
    console.error('Notification failed (ticket.updated):', error.message);
    return 0;
  }
}

/**
 * Somebody said something on a ticket: tell everyone else who can see it - the
 * raiser and the receiving department, minus the person who just typed it.
 *
 * `preview` is the message trimmed to a line, because the bell shows one line
 * and the thread itself is a click away.
 */
export async function notifyNewMessage({ ticket, actor, preview }) {
  try {
    const departmentId = ticket.department?._id ?? ticket.department;
    const raiser = ticket.raisedBy?._id ?? ticket.raisedBy;

    return await deliver({
      recipients: [...(await departmentMemberIds(departmentId)), raiser],
      exclude: actor._id,
      type: 'ticket.message',
      ticket,
      title: `${ticket.number} · ${actor.name}`,
      body: preview,
      actorName: actor.name,
    });
  } catch (error) {
    console.error('Notification failed (ticket.message):', error.message);
    return 0;
  }
}
