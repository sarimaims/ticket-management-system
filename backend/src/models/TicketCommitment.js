import mongoose from 'mongoose';

import { SYSTEM_ROLES } from './User.js';

/**
 * How a promise moved, worked out from the two dates rather than asked for:
 *
 *   promised     - the first date this department put its name to
 *   extended     - later than what was promised before
 *   pulled-in    - earlier than what was promised before
 *   withdrawn    - the promise taken back, leaving no date
 */
export const COMMITMENT_KINDS = ['promised', 'extended', 'pulled-in', 'withdrawn'];

/**
 * One promise about when a ticket will be resolved, and why that date.
 *
 * Kept as its own trail rather than a field that gets overwritten: a date that
 * has moved three times is a different thing from a date that was right first
 * time, and the raiser is entitled to see which one they are looking at. Every
 * line carries the date it replaced, so the trail reads as a sequence of moves
 * rather than a pile of dates.
 *
 * A reason is required by the controller, never optional: a promise moved
 * without one tells the person waiting nothing they did not already know.
 *
 * Names and roles are snapshots, like the assignment trail and the chat, and
 * nothing here is ever edited or deleted - which is what makes it a history.
 */
const ticketCommitmentSchema = new mongoose.Schema(
  {
    ticket: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Ticket',
      required: true,
      index: true,
    },
    /** What was promised. Null when the promise was withdrawn. */
    date: {
      type: Date,
      default: null,
    },
    /** What it replaced. Null on the first promise. */
    previousDate: {
      type: Date,
      default: null,
    },
    kind: {
      type: String,
      enum: COMMITMENT_KINDS,
      default: 'promised',
    },
    reason: {
      type: String,
      required: true,
      trim: true,
      maxlength: 400,
    },
    by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    byName: {
      type: String,
      required: true,
    },
    byRole: {
      type: String,
      enum: SYSTEM_ROLES,
      default: 'user',
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// The trail is always "this ticket, oldest first".
ticketCommitmentSchema.index({ ticket: 1, createdAt: 1 });

const TicketCommitment = mongoose.model('TicketCommitment', ticketCommitmentSchema);

export default TicketCommitment;
