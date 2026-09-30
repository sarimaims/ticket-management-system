import mongoose from 'mongoose';

import { SYSTEM_ROLES } from './User.js';

/**
 * What somebody can put a ticket in: not started, being worked, done.
 *
 * Overdue is deliberately not among them. It is not a decision anybody makes
 * but a fact about the date, so it is worked out on the way out of the API
 * rather than stored - see services/overdue.js.
 */
export const TICKET_STATUSES = ['New', 'In Progress', 'Resolved', 'Completed', 'Cancelled'];

/**
 * Done as far as the department is concerned, and waiting for the person who
 * asked to agree. Not closed - it can still be sent back - but not late
 * either: the work is finished, and a ticket should not turn red while it
 * waits on somebody else's answer.
 */
export const RESOLVED = 'Resolved';

/** How long a resolved ticket waits for an answer before it completes itself. */
export const APPROVAL_WINDOW_MS = 48 * 60 * 60 * 1000;

/**
 * Finished, one way or the other: done, or called off. Neither can be late and
 * neither is waiting on anybody.
 */
export const CLOSED_STATUSES = ['Completed', 'Cancelled'];

/** Statuses the calendar leaves alone: finished, called off, or handed back for sign-off. */
export const NOT_LATE_STATUSES = [...CLOSED_STATUSES, RESOLVED];

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
    /**
     * Every department this one ticket is shared with, the lead one first.
     *
     * A request can need two teams at once - IT to set a laptop up and
     * Pharmacy to hand it over - and splitting it into two tickets splits the
     * conversation, the deadline and the sign-off with it. So one ticket holds
     * all of them: each department sees it in its queue, its own people hold
     * it, and there is one status, one thread and one approval.
     *
     * `department` above stays as the lead - the first asked - for everything
     * that only needs one: the log line, the short label on a bell.
     */
    departments: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Department',
      },
    ],
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
    /**
     * Why it was called off, by whom and when. A snapshot of the name, like
     * the activity log, so it still reads correctly after a rename. Cleared
     * if the ticket is reopened.
     */
    cancelReason: {
      type: String,
      trim: true,
      maxlength: 400,
      default: '',
    },
    cancelledByName: {
      type: String,
      default: '',
    },
    cancelledAt: {
      type: Date,
      default: null,
    },
    project: {
      type: String,
      trim: true,
      maxlength: 80,
      default: '',
    },
    /**
     * The sign-off. A department finishing somebody else's request marks it
     * Resolved; the person who asked then approves it (Completed) or sends it
     * back (In Progress). Names are snapshots, like the activity log.
     */
    resolvedAt: { type: Date, default: null },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    resolvedByName: { type: String, default: '' },
    /** When the request completes itself if nobody answers. Null unless Resolved. */
    approvalDueAt: { type: Date, default: null },
    /** Who signed it off: a name, or 'Auto-approved' when the 48 hours ran out. */
    approvedByName: { type: String, default: '' },
    completedAt: { type: Date, default: null },
    /** The last time it was sent back, and why. Kept until it is resolved again. */
    rejectedReason: { type: String, trim: true, maxlength: 400, default: '' },
    rejectedByName: { type: String, default: '' },
    rejectedAt: { type: Date, default: null },
    /**
     * Escalation: anybody who can see a ticket may put it in front of the super
     * admin, with a reason. Open until the super admin marks it handled; a
     * handled ticket can be escalated again. The whole story is also told in
     * the thread and the log - these fields are the current state of it.
     */
    escalationStatus: { type: String, enum: ['open', 'handled', null], default: null },
    escalatedAt: { type: Date, default: null },
    escalatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    escalatedByName: { type: String, default: '' },
    escalationReason: { type: String, trim: true, maxlength: 400, default: '' },
    escalationHandledAt: { type: Date, default: null },
    escalationHandledByName: { type: String, default: '' },
    escalationNote: { type: String, trim: true, maxlength: 400, default: '' },
    /** How many times it has been escalated, all told. */
    escalationCount: { type: Number, default: 0 },
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
// The queues ask by any of a ticket's departments, not only its lead.
ticketSchema.index({ departments: 1, updatedAt: -1 });

/**
 * The lead department is always one of the departments, and the list is never
 * empty - so a ticket saved from anywhere, however old, is in its own queue.
 */
ticketSchema.pre('validate', function keepDepartmentsWhole() {
  const ids = (this.departments ?? []).map(String);
  if (this.department && !ids.includes(String(this.department))) {
    this.departments = [this.department, ...(this.departments ?? [])];
  }
  if (!this.department && this.departments?.length > 0) {
    this.department = this.departments[0];
  }
});

// The two shapes the queues ask for: "what is on this person" and "what is in
// this state", newest first. Declared here so a fresh database gets them too.
ticketSchema.index({ assignees: 1, updatedAt: -1 });
ticketSchema.index({ status: 1, updatedAt: -1 });
ticketSchema.index({ raisedBy: 1, updatedAt: -1 });
// The sweep that completes unanswered sign-offs asks exactly this.
ticketSchema.index({ status: 1, approvalDueAt: 1 });
// The super admin's escalations page, newest first.
ticketSchema.index({ escalationStatus: 1, escalatedAt: -1 });

ticketSchema.pre('save', async function assignNumber() {
  if (this.number) return;

  const counter = await Counter.findByIdAndUpdate(
    'ticket',
    { $inc: { seq: 1 } },
    { new: true, upsert: true },
  );
  this.number = `TK-${String(counter.seq).padStart(4, '0')}`;
});

// Finding a request by the name of a file that came with it.
ticketSchema.index({ 'attachments.filename': 1 });

const Ticket = mongoose.model('Ticket', ticketSchema);

export default Ticket;
