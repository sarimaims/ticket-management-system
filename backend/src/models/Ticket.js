import mongoose from 'mongoose';

import { SYSTEM_ROLES } from './User.js';

export const TICKET_STATUSES = [
  'New',
  'Accepted',
  'In Progress',
  'Waiting',
  'Completed',
  'Overdue',
];

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
    project: {
      type: String,
      trim: true,
      maxlength: 80,
      default: '',
    },
    // The thread lives in its own collection; these two are kept here so a
    // list can show that a conversation exists without reading any of it.
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
