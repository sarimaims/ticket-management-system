import mongoose from 'mongoose';

/**
 * One person asking another to take a ticket off them.
 *
 * A head hands a ticket over; anyone else asks. The difference is not about
 * trust so much as consent: a team member can put work on a colleague's desk
 * without them knowing, and the colleague finds out when the deadline does.
 * An ask that has to be accepted keeps both facts in the open - that it was
 * offered, and that it was taken.
 *
 * Several people can be asked at once. The first to accept takes it and the
 * rest are closed, because the ticket can only move once.
 */
export const HANDOVER_STATUSES = ['pending', 'accepted', 'declined', 'cancelled'];

const handoverRequestSchema = new mongoose.Schema(
  {
    ticket: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Ticket',
      required: true,
      index: true,
    },
    /** Who is asking. They hold the ticket at the time of asking. */
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    requestedByName: {
      type: String,
      required: true,
    },
    /** Who is being asked. Nobody here already holds the ticket. */
    to: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    toNames: {
      type: [String],
      default: [],
    },
    /** Said when asking, so the ask is not a bare notification. */
    note: {
      type: String,
      trim: true,
      maxlength: 500,
      default: '',
    },
    status: {
      type: String,
      enum: HANDOVER_STATUSES,
      default: 'pending',
      index: true,
    },
    /** Whoever answered, and how. Empty while it is still pending. */
    decidedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    decidedByName: {
      type: String,
      default: '',
    },
    decidedAt: {
      type: Date,
      default: null,
    },
    /**
     * Who has said no so far. A request stays open while anyone asked has not
     * answered, so one refusal does not end it for everybody.
     */
    declinedBy: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
  },
  { timestamps: true },
);

// "What is waiting on me" and "what is open on this ticket" are the only two
// questions asked of this collection.
handoverRequestSchema.index({ to: 1, status: 1 });
handoverRequestSchema.index({ ticket: 1, status: 1 });

const HandoverRequest = mongoose.model('HandoverRequest', handoverRequestSchema);

export default HandoverRequest;
