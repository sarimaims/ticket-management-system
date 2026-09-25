import mongoose from 'mongoose';

import { SYSTEM_ROLES } from './User.js';

/**
 * What somebody can put a ticket in: not started, being worked, done.
 *
 * Overdue is deliberately not among them. It is not a decision anybody makes
 * but a fact about the date, so it is worked out on the way out of the API
 * rather than stored - see services/overdue.js.
 */
export const TICKET_STATUSES = ['New', 'In Progress', 'Completed'];

/** Past its date and not finished. Assigned by the calendar, never by hand. */
export const OVERDUE = 'Overdue';

export const TICKET_PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];

/**
 * A sequence per name, bumped atomically. Counting documents instead would
 * hand two simultaneous requests the same number.
 */
const counterSchema = new mongoose.Schema({
  _id: String,
  seq: { type: Number, default: 0 },
});

const Counter = mongoose.models.Counter ?? mongoose.model('Counter', counterSchema);

const ticketSchema = new mongoose.Schema(
  {
    // Human-readable and stable: TK-0001. The _id stays the real key.
    number: {
      type: String,
      unique: true,
      index: true,
    },
    subject: {
      type: String,
      required: [true, 'Subject is required'],
      trim: true,
      maxlength: 160,
    },
    description: {
      type: String,
      required: [true, 'Description is required'],
      trim: true,
      maxlength: 1000,
    },
    // Free text, kept for the tickets that were raised while the form asked
    // for it. Nothing requires it now.
    requestType: {
      type: String,
      trim: true,
      maxlength: 60,
      default: '',
    },
    priority: {
      type: String,
      enum: TICKET_PRIORITIES,
      default: 'Medium',
    },
    status: {
      type: String,
      enum: TICKET_STATUSES,
      default: 'New',
    },
    // Who handles it. Everyone in this department can see the ticket.
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Department',
      required: true,
      index: true,
    },
    raisedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    // Which of the raiser's own departments this is asked on behalf of. A
    // manager belongs to none, so this is simply empty for them.
    fromDepartments: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Department',
      },
    ],
    // Snapshot of the raiser's standing at the time. Stored rather than read
    // from the user, so the receiving department still sees "raised by an
    // admin" even if that person is demoted later.
    raisedByRole: {
      type: String,
      enum: SYSTEM_ROLES,
      default: 'user',
    },
    /**
     * Who is handling it. More than one, because a department often puts two
     * people on the same request rather than splitting it into two requests.
     *
     * Empty only on tickets raised before a name was required; from then on a
     * ticket always sits with somebody, and is handed on rather than dropped.
     */
    assignees: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    // What the raiser asked for. Theirs to move, nobody else's.
    deadline: {
      type: Date,
      default: null,
    },
    // What the receiving department promises back: "I can resolve this by".
    // Kept apart from `deadline` so a commitment can never overwrite the ask,
    // and so both dates stay readable side by side.
    committedDeadline: {
      type: Date,
      default: null,
    },
    committedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    committedAt: {
      type: Date,
      default: null,
    },
    /**
     * Why the current promise is the date it is. Written with the date and
     * cleared with it; every earlier answer lives on in the commitment trail.
     */
    committedReason: {
      type: String,
      trim: true,
      maxlength: 400,
      default: '',
    },
    project: {
      type: String,
      trim: true,
      maxlength: 80,
      default: '',
    },
    // The thread lives in its own collection; these two are kept here so a
    // list can show that a conversation exists without reading any of it.
    /**
     * The paperwork that came with the request: whatever the raiser attached
     * on the form. Only the key is stored, as with a chat attachment - the URL
     * is signed fresh on every read, so the bucket stays private.
     */
    attachments: {
      type: [
        {
          key: { type: String, required: true },
          filename: { type: String, default: '' },
          mimeType: { type: String, required: true },
          size: { type: Number, required: true },
          uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
          uploadedAt: { type: Date, default: Date.now },
          _id: false,
        },
      ],
      default: [],
    },
    messageCount: {
      type: Number,
      default: 0,
    },
    lastMessageAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

// Polling asks the same two questions over and over: how many tickets a
// person can see, and which of them moved most recently. These cover both
// halves of the visibility filter so neither question scans the collection.
ticketSchema.index({ department: 1, updatedAt: -1 });

// The two shapes the queues ask for: "what is on this person" and "what is in
// this state", newest first. Declared here so a fresh database gets them too.
ticketSchema.index({ assignees: 1, updatedAt: -1 });
ticketSchema.index({ status: 1, updatedAt: -1 });
ticketSchema.index({ raisedBy: 1, updatedAt: -1 });

ticketSchema.pre('save', async function assignNumber() {
  if (this.number) return;

  const counter = await Counter.findByIdAndUpdate(
    'ticket',
    { $inc: { seq: 1 } },
    { new: true, upsert: true },
  );
  this.number = `TK-${String(counter.seq).padStart(4, '0')}`;
});

const Ticket = mongoose.model('Ticket', ticketSchema);

export default Ticket;
