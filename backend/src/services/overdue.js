import { OVERDUE } from '../models/Ticket.js';

/**
 * Overdue is a fact about the calendar, not a decision somebody makes.
 *
 * So it is not stored. A ticket keeps the status a person put it in - New, In
 * Progress or Completed - and reads as Overdue for as long as its date has
 * passed. Nothing has to sweep the collection at midnight, a date moved back
 * into the future takes the ticket out of Overdue on the next read, and there
 * is never a row whose stored status disagrees with its own deadline.
 */

/** The day a value falls on, as YYYY-MM-DD, in the server's own timezone. */
const dayOf = (value) => new Date(value).toLocaleDateString('en-CA');

/**
 * The date a ticket is actually judged against: what the department promised
 * if it has promised anything, otherwise what the raiser asked for.
 */
export const dueDate = (ticket) => ticket.committedDeadline ?? ticket.deadline ?? null;

/** Midnight this morning. Anything due before it is late; today is not. */
export function startOfToday() {
  const at = new Date();
  at.setHours(0, 0, 0, 0);
  return at;
}

/** Past its date and not finished. */
export function isOverdue(ticket, today = dayOf(Date.now())) {
  if (!ticket || ticket.status === 'Completed') return false;

  const due = dueDate(ticket);
  return Boolean(due) && dayOf(due) < today;
}

/** What a ticket's status reads as, which is not always what is stored. */
export function statusOf(ticket, today) {
  return isOverdue(ticket, today) ? OVERDUE : ticket.status;
}

/**
 * The same question as `isOverdue`, asked of the database instead.
 *
 * `$ifNull` picks the promised date over the requested one exactly as
 * `dueDate` does, so a query and a presented ticket can never disagree.
 */
export function pastDue(late = true) {
  const at = startOfToday();
  const due = { $ifNull: ['$committedDeadline', '$deadline'] };

  return { $expr: late ? { $lt: [due, at] } : { $gte: [due, at] } };
}
