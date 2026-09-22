import mongoose from 'mongoose';

import { SYSTEM_ROLES } from './User.js';

/**
 * One line of a ticket's assignment trail: who it moved from, who it moved to,
 * and who moved it.
 *
 * Names are snapshots, like the activity log and the chat: the trail still
 * reads correctly after an account is renamed, demoted or removed. Nothing
 * here is ever edited or deleted, so there is no updatedAt - a history that
 * can be rewritten is not a history.
 */
export const ASSIGNMENT_KINDS = ['raised', 'reassigned'];

const ticketAssignmentSchema = new mongoose.Schema(
  {
    ticket: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Ticket',
      required: true,
      index: true,
    },
    /** Empty on the first line: it came from nobody. */
    from: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    fromNames: {
      type: [String],
      default: [],
    },
    /** Who it sits with after the move. Several, because a ticket can. */
    to: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    toNames: {
      type: [String],
      default: [],
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
    /** How it got there: raised onto them, or handed over afterwards. */
    kind: {
      type: String,
      enum: ASSIGNMENT_KINDS,
      default: 'reassigned',
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// The trail is always "this ticket, oldest first".
ticketAssignmentSchema.index({ ticket: 1, createdAt: 1 });

const TicketAssignment = mongoose.model('TicketAssignment', ticketAssignmentSchema);

export default TicketAssignment;
