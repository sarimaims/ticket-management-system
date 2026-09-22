import mongoose from 'mongoose';

/**
 * When someone last had a ticket's conversation open.
 *
 * One row per reader per ticket rather than a read receipt per message: a
 * thread is read top to bottom, so "Kuldeep had this open at 12:04" answers
 * "who has seen this line?" for every line written before then, at a hundredth
 * of the writes.
 *
 * It is an approximation, and deliberately a modest one - it says the thread
 * was open, not that the words were taken in - so the wording that shows it
 * says "seen", never "read and understood".
 */
const threadReadSchema = new mongoose.Schema(
  {
    ticket: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Ticket',
      required: true,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    /** Snapshot, like a message's author name: the list still reads after a rename. */
    userName: {
      type: String,
      default: '',
    },
    lastSeenAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: false },
);

// One row per reader per thread; the lookup is always "this ticket, seen since".
threadReadSchema.index({ ticket: 1, user: 1 }, { unique: true });
threadReadSchema.index({ ticket: 1, lastSeenAt: -1 });

const ThreadRead = mongoose.model('ThreadRead', threadReadSchema);

export default ThreadRead;
