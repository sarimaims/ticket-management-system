import mongoose from 'mongoose';

/**
 * One workspace on a person's to-do page - SEO, Graphics, whatever they keep
 * apart. Each has its own columns, and its cards follow those columns.
 *
 * Personal like the rest of the board: every query is scoped by `user`.
 */
const todoBoardSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    name: {
      type: String,
      required: [true, 'A workspace needs a name'],
      trim: true,
      maxlength: 40,
    },
    /** Left to right in the workspace tabs. */
    order: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true },
);

todoBoardSchema.index({ user: 1, order: 1 });

const TodoBoard = mongoose.model('TodoBoard', todoBoardSchema);

export default TodoBoard;
