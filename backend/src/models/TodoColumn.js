import mongoose from 'mongoose';

/** The colours a column can wear. Names, not hex: the frontend owns the palette. */
export const TODO_COLORS = ['slate', 'blue', 'amber', 'green', 'red', 'violet', 'teal', 'pink'];

/**
 * One column on a person's to-do board - a status they made up themselves.
 *
 * Personal by design: nobody else reads or edits another person's board, so
 * every query is scoped by `user`. A new board starts with three columns
 * (see the controller); after that the names, colours and order are theirs.
 */
const todoColumnSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    /**
     * The workspace this column belongs to. Not required at the schema level
     * only because columns from before workspaces existed have none - the
     * controller files those under the person's first workspace on sight.
     */
    board: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TodoBoard',
      default: null,
    },
    name: {
      type: String,
      required: [true, 'A column needs a name'],
      trim: true,
      maxlength: 40,
    },
    color: {
      type: String,
      enum: TODO_COLORS,
      default: 'slate',
    },
    /** Left to right. Rewritten as 0..n whenever the columns are reordered. */
    order: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true },
);

todoColumnSchema.index({ user: 1, board: 1, order: 1 });

const TodoColumn = mongoose.model('TodoColumn', todoColumnSchema);

export default TodoColumn;
