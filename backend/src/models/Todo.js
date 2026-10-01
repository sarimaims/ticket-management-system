import mongoose from 'mongoose';

export const TODO_PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];

/**
 * One card on a person's to-do board.
 *
 * Separate from tickets on purpose: a ticket is a request between people with
 * its own rules, a to-do is a note to yourself. It sits in one of its owner's
 * columns, at a position within it.
 */
const todoSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    column: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TodoColumn',
      required: true,
    },
    title: {
      type: String,
      required: [true, 'A to-do needs a title'],
      trim: true,
      maxlength: 200,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: '',
    },
    priority: {
      type: String,
      enum: TODO_PRIORITIES,
      default: 'Medium',
    },
    dueDate: {
      type: Date,
      default: null,
    },
    /** Top to bottom within its column. Rewritten as 0..n on every move. */
    order: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true },
);

todoSchema.index({ user: 1, column: 1, order: 1 });

const Todo = mongoose.model('Todo', todoSchema);

export default Todo;
