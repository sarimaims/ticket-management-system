import mongoose from 'mongoose';

import { SYSTEM_ROLES } from './User.js';

/**
 * One line of the conversation on a ticket.
 *
 * The author's name and standing are snapshots, like the activity log: a
 * message still reads correctly after the account is renamed, demoted or
 * removed. `side` is likewise frozen at the time of writing - someone who
 * later joins the receiving department does not retroactively become it.
 *
 * Messages are never edited or deleted, so there is no updatedAt: the thread
 * is a record of what was actually said.
 */
const messageSchema = new mongoose.Schema(
  {
    ticket: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Ticket',
      required: true,
      index: true,
    },
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    authorName: {
      type: String,
      required: true,
    },
    authorRole: {
      type: String,
      enum: SYSTEM_ROLES,
      default: 'user',
    },
    /** Which end of the ticket this was written from. */
    side: {
      type: String,
      enum: ['raiser', 'department'],
      default: 'department',
    },
    body: {
      type: String,
      required: [true, 'A message cannot be empty'],
      trim: true,
      maxlength: 2000,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// The thread is always "this ticket, oldest first", and the poll below asks
// for its newest line - one index covers both.
messageSchema.index({ ticket: 1, createdAt: 1 });

const Message = mongoose.model('Message', messageSchema);

export default Message;
