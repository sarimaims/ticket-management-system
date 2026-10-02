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
      // Somebody wrote every message, and every line about the ticket but
      // one kind: the workspace completing an unanswered sign-off itself.
      required: function requiredUnlessSystem() {
        return this.kind !== 'system';
      },
      default: null,
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
    /**
     * A line somebody wrote, or one the ticket wrote about itself.
     *
     * System lines are what happened rather than what was said: raised,
     * retitled, handed over. Nobody may edit, withdraw or reply to one, and
     * they are not counted as messages waiting to be read.
     */
    kind: {
      type: String,
      enum: ['text', 'system'],
      default: 'text',
    },
    /**
     * Which kind of thing happened, for a system line. The history tab shows
     * handovers from the assignment trail instead, so it needs to be able to
     * tell those apart from the rest.
     */
    event: {
      type: String,
      enum: [
        'raised',
        'edited',
        'assignment',
        'resolved',
        'approved',
        'rejected',
        'auto-approved',
        'escalated',
        'escalation.handled',
        null,
      ],
      default: null,
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
     * The line this one answers, WhatsApp-style. A reference rather than a
     * copy: the quote then follows the original if its author corrects it,
     * and a withdrawn original is quoted as withdrawn.
     */
    replyTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Message',
      default: null,
    },
    /**
     * The people named in the line with "@". Checked on the way in against who
     * can read the ticket, and kept with the name as it was written, so the
     * thread marks exactly those words and nothing that merely looks like one.
     */
    mentions: {
      type: [
        {
          user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
          name: { type: String, required: true },
          _id: false,
        },
      ],
      default: [],
    },
    /**
     * A photo, a video, a document or a voice note living in S3. Only the key
     * is stored: the URL is signed fresh on every read, so the bucket can stay
     * private and a link copied out of the page stops working before long.
     */
    attachment: {
      type: {
        kind: { type: String, enum: ['image', 'video', 'file', 'voice'], required: true },
        key: { type: String, required: true },
        mimeType: { type: String, required: true },
        size: { type: Number, required: true },
        /** Voice notes only, in milliseconds. */
        durationMs: { type: Number, default: null },
        /**
         * What the sender called it: "aims-digital-salary-list.xlsx", not the
         * random key it is stored under. Kept for the download, and because it
         * is the only thing a person searching for a file will remember.
         */
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

// The media library: one thread's attachments, newest first.
messageSchema.index({ ticket: 1, 'attachment.kind': 1, createdAt: -1 });

// Finding a file by the name it was sent with, across every thread.
messageSchema.index({ 'attachment.filename': 1 });

const Message = mongoose.model('Message', messageSchema);

export default Message;
