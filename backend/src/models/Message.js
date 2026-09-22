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
 * An author may correct or withdraw their own line, but nothing is ever
 * really erased: an edit keeps every previous version and a delete only marks
 * the message. Everyone sees that it happened; an admin can still read what it
 * said, which is what makes the thread usable as a record.
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
      // A photo or a voice note is a message on its own; the controller
      // refuses only a line that is empty of both.
      trim: true,
      maxlength: 2000,
      default: '',
    },
    /** When the author last corrected it, and what it said before. */
    editedAt: {
      type: Date,
      default: null,
    },
    /**
     * Every earlier version, oldest first. Kept for admins: a correction that
     * cannot be inspected is indistinguishable from a rewrite of history.
     */
    revisions: {
      type: [
        {
          body: { type: String, default: '' },
          replacedAt: { type: Date, required: true },
          _id: false,
        },
      ],
      default: [],
    },
    /** Withdrawn by its author. The text stays; who may read it changes. */
    deletedAt: {
      type: Date,
      default: null,
    },
    deletedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    deletedByName: {
      type: String,
      default: '',
    },
    /**
     * A photo or a voice note living in S3. Only the key is stored: the URL is
     * signed fresh on every read, so the bucket can stay private and a link
     * copied out of the page stops working before long.
     */
    attachment: {
      type: {
        kind: { type: String, enum: ['image', 'voice'], required: true },
        key: { type: String, required: true },
        mimeType: { type: String, required: true },
        size: { type: Number, required: true },
        /** Voice notes only, in milliseconds. */
        durationMs: { type: Number, default: null },
        /** What the sender called it, kept for the download filename. */
        filename: { type: String, default: '' },
      },
      default: null,
      _id: false,
    },
  },
  { timestamps: true },
);

// The thread is always "this ticket, oldest first", and the poll below asks
// for its newest line - one index covers both.
messageSchema.index({ ticket: 1, createdAt: 1 });

const Message = mongoose.model('Message', messageSchema);

export default Message;
