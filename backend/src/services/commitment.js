import TicketCommitment from '../models/TicketCommitment.js';

/** Which way the promise moved, read off the two dates. */
export function commitmentKind(previous, next) {
  if (!next) return 'withdrawn';
  if (!previous) return 'promised';
  return next.getTime() > previous.getTime() ? 'extended' : 'pulled-in';
}

/**
 * Appends one line to a ticket's promise trail.
 *
 * Unlike the activity log this is NOT swallowed on failure: the reason a date
 * moved is the point of moving it, and a promise recorded without its trail
 * would leave the raiser looking at a date nobody has to account for. The
 * caller writes the trail first and saves the ticket after, so a failure here
 * leaves the old promise standing rather than a new one nobody can explain.
 */
export async function recordCommitment({ ticket, previous, next, reason, actor }) {
  return TicketCommitment.create({
    ticket: ticket._id ?? ticket,
    date: next,
    previousDate: previous,
    kind: commitmentKind(previous, next),
    reason,
    by: actor?._id ?? null,
    byName: actor?.name ?? 'Someone',
    byRole: actor?.role ?? 'user',
  });
}

/** The whole trail for one ticket, oldest first. */
export function listCommitments(ticketId) {
  return TicketCommitment.find({ ticket: ticketId }).sort({ createdAt: 1 });
}
