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
