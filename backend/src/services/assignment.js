import TicketAssignment from '../models/TicketAssignment.js';

/**
 * Appends one line to a ticket's assignment trail.
 *
 * Like the activity log, this must never break the action it describes: a
 * ticket being handed over matters more than the record of it, and there are
 * no transactions to lean on here. A failure is reported and swallowed.
 */
export async function recordAssignment({ ticket, from, to, actor, kind = 'reassigned' }) {
  try {
    await TicketAssignment.create({
      ticket: ticket._id ?? ticket,
      from: from?._id ?? null,
      fromName: from?.name ?? '',
      to: to?._id ?? null,
      toName: to?.name ?? '',
      by: actor?._id ?? null,
      byName: actor?.name ?? 'Someone',
      byRole: actor?.role ?? 'user',
      kind,
    });
  } catch (error) {
    console.error('Assignment trail failed:', error.message);
  }
}
