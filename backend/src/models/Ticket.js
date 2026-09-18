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
    requestType: {
      type: String,
      required: [true, 'Request type is required'],
      trim: true,
      maxlength: 60,
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
    assignee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    deadline: {
      type: Date,
      default: null,
    },
    project: {
      type: String,
      trim: true,
      maxlength: 80,
      default: '',
    },
  },
  { timestamps: true },
);

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
