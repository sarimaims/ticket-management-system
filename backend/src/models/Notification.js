import mongoose from 'mongoose';

/**
 * One line addressed to one person: a ticket arrived for their department, or
 * one they care about moved. Names are snapshots, like the activity log, so an
 * old notification still reads correctly after a rename or a deletion.
 */
export const NOTIFICATION_TYPES = ['ticket.new', 'ticket.updated', 'ticket.edited'];

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
