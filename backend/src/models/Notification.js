import mongoose from 'mongoose';

/**
 * One line addressed to one person: a ticket arrived for their department, or
 * one they care about moved. Names are snapshots, like the activity log, so an
 * old notification still reads correctly after a rename or a deletion.
 */
export const NOTIFICATION_TYPES = [
  'ticket.new',
  'ticket.updated',
  'ticket.edited',
  'ticket.message',
  /** Somebody is asking you to take a ticket on. */
  'ticket.handover',
  /** They answered the one you sent. */
  'ticket.handover.answered',
  /** A ticket you were part of was taken back, with the reason why. */
  'ticket.deleted',
  /** Your request was marked resolved and is waiting for you to sign it off. */
  'ticket.approval',
  /** Somebody put a ticket in front of the super admin. */
  'ticket.escalated',
];

/**
 * What actually happened, under the broad type.
 *
 * `ticket.updated` covers a ticket being finished, called off, promised a new
 * date and handed to somebody else - four things a reader wants to tell apart
 * at a glance, and four colours in the feed. The type says which page the
 * event belongs to; this says what it was.
 */
export const NOTIFICATION_EVENTS = [
  'raised',
  'completed',
  'cancelled',
  'status',
  'promise',
  'assigned',
  'moved',
  'edited',
  'message',
  'handover',
  'handover.answered',
  'deleted',
  /** Marked done by the department; the requester's sign-off is wanted. */
  'resolved',
  /** The requester agreed it is done. */
  'approved',
  /** The requester sent it back. */
  'rejected',
  /** Put in front of the super admin. */
  'escalated',
  /** The super admin dealt with it. */
  'escalation.handled',
];

const notificationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: NOTIFICATION_TYPES,
      required: true,
    },
    /** The finer action, for rows written since it existed. */
    event: {
      type: String,
      enum: [...NOTIFICATION_EVENTS, null],
      default: null,
    },
    ticket: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Ticket',
      default: null,
    },
    ticketNumber: {
      type: String,
      default: '',
    },
    /** Headline, already written for a human: "TK-0007 from Digital Department". */
    title: {
      type: String,
      required: true,
    },
    /** One supporting line: the subject, or what changed. */
    body: {
      type: String,
      default: '',
    },
    actorName: {
      type: String,
      default: '',
    },
    departmentName: {
      type: String,
      default: '',
    },
    /**
     * Whether this copy went to the person who raised the ticket. The same
     * event is written once per recipient, and the two sides read it on
     * different pages - the raiser on My Requests, the department on its own
     * queue - so the link has to know which copy it is looking at.
     */
    forRaiser: {
      type: Boolean,
      default: null,
    },
    readAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// The feed is always "mine, newest first".
notificationSchema.index({ user: 1, createdAt: -1 });

const Notification = mongoose.model('Notification', notificationSchema);

export default Notification;
