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

/** Whoever runs a department - the people an unassigned ticket is waiting on. */
async function departmentHeadIds(departmentId) {
  const heads = await User.find({
    status: { $ne: 'suspended' },
    memberships: { $elemMatch: { department: departmentId, role: 'head' } },
  }).select('_id');
  return heads.map((head) => head._id);
}

/**
 * Who hears about something that happened on a ticket.
 *
 * Not the whole department. Somebody working in one is told about the tickets
 * on their own desk; the head, who runs the queue, is told about all of it. A
 * colleague's ticket is on the department's own list either way, and a bell
 * for every one of them is a row of bells nobody reads.
 *
 * Whoever raised it is added by the callers where it belongs - they are
 * waiting on an answer rather than working the ticket.
 */
async function audienceFor(ticket) {
  const departmentId = ticket.department?._id ?? ticket.department;
  const holders = (ticket.assignees ?? []).map((person) => person?._id ?? person);
  const heads = await departmentHeadIds(departmentId);

  // A department with no head yet and nothing assigned would hear nothing at
  // all, so it falls back to everyone in it.
  if (holders.length === 0 && heads.length === 0) return departmentMemberIds(departmentId);

  return [...holders, ...heads];
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

/**
 * A ticket just landed in a department: tell whoever it landed on.
 *
 * Which is whoever was named, or - when nobody was - that department's head.
 * An unnamed ticket is left unassigned in All Tickets, and handing it out is
 * the head's call, so the head is the one rung. The rest of the department is
 * not: the ticket is on their queue either way, and a bell for every request
 * a colleague was asked for is noise.
 *
 * A department with no head yet still tells everyone. Better an unnecessary
 * bell than a request raised into silence.
 */
export async function notifyNewTicket({ ticket, actor }) {
  try {
    return await deliver({
      recipients: await audienceFor(ticket),
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
    return await deliver({
      recipients: await audienceFor(ticket),
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
    const raiser = ticket.raisedBy?._id ?? ticket.raisedBy;

    return await deliver({
      recipients: [...(await audienceFor(ticket)), raiser],
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
    const raiser = ticket.raisedBy?._id ?? ticket.raisedBy;

    return await deliver({
      recipients: [...(await audienceFor(ticket)), raiser],
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

/**
 * Somebody is asking these people to take a ticket off them.
 *
 * Addressed rather than broadcast: only the people actually asked hear about
 * it, because it is a question put to them and not news about the ticket.
 */
export async function notifyHandoverAsked({ ticket, actor, recipients }) {
  try {
    return await deliver({
      recipients,
      exclude: actor._id,
      type: 'ticket.handover',
      ticket,
      title: `${ticket.number} · ${actor.name} asks you to take this on`,
      body: ticket.subject,
      actorName: actor.name,
    });
  } catch (error) {
    console.error('Notification failed (ticket.handover):', error.message);
    return 0;
  }
}

/** And the answer, back to whoever asked. */
export async function notifyHandoverAnswered({ ticket, actor, recipient, accepted }) {
  try {
    return await deliver({
      recipients: [recipient],
      exclude: actor._id,
      type: 'ticket.handover.answered',
      ticket,
      title: `${ticket.number} · ${actor.name} ${accepted ? 'took it on' : 'turned it down'}`,
      body: ticket.subject,
      actorName: actor.name,
    });
  } catch (error) {
    console.error('Notification failed (ticket.handover.answered):', error.message);
    return 0;
  }
}
