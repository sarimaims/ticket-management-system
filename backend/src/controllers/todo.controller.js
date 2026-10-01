import mongoose from 'mongoose';

import Todo, { TODO_PRIORITIES } from '../models/Todo.js';
import TodoBoard from '../models/TodoBoard.js';
import TodoColumn, { TODO_COLORS } from '../models/TodoColumn.js';
import ApiError from '../utils/ApiError.js';

/**
 * A person's own to-do board: columns they name themselves, and cards they
 * drag between them. Every query is scoped to `req.user`, so one person can
 * never read or move another's.
 */

/** What a fresh board opens with. Renamed, recoloured or removed like any other. */
const STARTER_COLUMNS = [
  { name: 'To Do', color: 'slate' },
  { name: 'In Progress', color: 'blue' },
  { name: 'Done', color: 'green' },
];

const MAX_COLUMNS = 12;
const MAX_BOARDS = 20;

/** What a person's first workspace is called, including the one old boards move into. */
const FIRST_BOARD = 'My board';

/**
 * A person's default workspace is the first one they ever had - "My board",
 * where their to-dos from before workspaces went. It can be renamed but never
 * deleted, so there is always somewhere for the board to open.
 */
async function defaultBoardId(user) {
  const first = await TodoBoard.findOne({ user: user._id }).sort({ createdAt: 1 }).select('_id');
  return first ? String(first._id) : null;
}

const presentBoard = (board, defaultId) => ({
  id: String(board._id),
  name: board.name,
  order: board.order,
  isDefault: String(board._id) === defaultId,
});

const presentColumn = (column) => ({
  id: String(column._id),
  name: column.name,
  color: column.color,
  order: column.order,
});

const presentTodo = (todo) => ({
  id: String(todo._id),
  column: String(todo.column),
  title: todo.title,
  description: todo.description,
  priority: todo.priority,
  dueDate: todo.dueDate ?? null,
  order: todo.order,
  createdAt: todo.createdAt,
  updatedAt: todo.updatedAt,
});

function assertId(value, what) {
  if (!mongoose.isValidObjectId(value)) throw ApiError.badRequest(`Invalid ${what}.`);
}

async function ownColumn(user, id) {
  assertId(id, 'column');
  const column = await TodoColumn.findOne({ _id: id, user: user._id });
  if (!column) throw ApiError.notFound('Column not found.');
  return column;
}

async function ownBoard(user, id) {
  assertId(id, 'workspace');
  const board = await TodoBoard.findOne({ _id: id, user: user._id });
  if (!board) throw ApiError.notFound('Workspace not found.');
  return board;
}

function readBoardName(body) {
  const value = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!value) throw ApiError.badRequest('A workspace needs a name.');
  if (value.length > 40) throw ApiError.badRequest('Keep the name under 40 characters.');
  return value;
}

/**
 * This person's workspaces, left to right - and the place a board from before
 * workspaces is filed. There is always at least one, and any column without a
 * workspace is moved into the first, so nothing they made goes missing.
 */
async function boardsOf(user) {
  let boards = await TodoBoard.find({ user: user._id }).sort({ order: 1, createdAt: 1 });
  if (boards.length === 0) {
    boards = [await TodoBoard.create({ user: user._id, name: FIRST_BOARD, order: 0 })];
  }
  await TodoColumn.updateMany({ user: user._id, board: null }, { $set: { board: boards[0]._id } });
  return boards;
}

async function ownTodo(user, id) {
  assertId(id, 'to-do');
  const todo = await Todo.findOne({ _id: id, user: user._id });
  if (!todo) throw ApiError.notFound('To-do not found.');
  return todo;
}

/** Validates the editable fields of a card; only what was sent is checked. */
function readTodoFields(body, { creating = false } = {}) {
  const out = {};
  const { title, description, priority, dueDate } = body ?? {};

  if (creating || title !== undefined) {
    const value = typeof title === 'string' ? title.trim() : '';
    if (!value) throw ApiError.badRequest('A to-do needs a title.');
    if (value.length > 200) throw ApiError.badRequest('Keep the title under 200 characters.');
    out.title = value;
  }
  if (description !== undefined) {
    const value = typeof description === 'string' ? description.trim() : '';
    if (value.length > 2000) throw ApiError.badRequest('Keep the description under 2000 characters.');
    out.description = value;
  }
  if (priority !== undefined) {
    if (!TODO_PRIORITIES.includes(priority)) {
      throw ApiError.badRequest(`Priority must be one of: ${TODO_PRIORITIES.join(', ')}.`);
    }
    out.priority = priority;
  }
  if (dueDate !== undefined) {
    if (dueDate === null || dueDate === '') {
      out.dueDate = null;
    } else {
      const parsed = new Date(dueDate);
      if (Number.isNaN(parsed.getTime())) throw ApiError.badRequest('Invalid due date.');
      out.dueDate = parsed;
    }
  }
  return out;
}

function readColumnFields(body, { creating = false } = {}) {
  const out = {};
  const { name, color } = body ?? {};

  if (creating || name !== undefined) {
    const value = typeof name === 'string' ? name.trim() : '';
    if (!value) throw ApiError.badRequest('A column needs a name.');
    if (value.length > 40) throw ApiError.badRequest('Keep the column name under 40 characters.');
    out.name = value;
  }
  if (color !== undefined) {
    if (!TODO_COLORS.includes(color)) throw ApiError.badRequest('Unknown colour.');
    out.color = color;
  }
  return out;
}

/** Writes 0..n as the order of these ids, in the order given. */
async function renumber(Model, ids, extra = {}) {
  if (ids.length === 0) return;
  await Model.bulkWrite(
    ids.map((id, index) => ({
      updateOne: { filter: { _id: id }, update: { $set: { order: index, ...extra } } },
    })),
  );
}

/* ------------------------------------------------------------ workspaces */

export async function listBoards(req, res) {
  const boards = await boardsOf(req.user);
  const defaultId = await defaultBoardId(req.user);
  res.json({ success: true, boards: boards.map((board) => presentBoard(board, defaultId)) });
}

export async function createBoard(req, res) {
  const name = readBoardName(req.body);
  const boards = await boardsOf(req.user);
  if (boards.length >= MAX_BOARDS) {
    throw ApiError.badRequest(`You can have at most ${MAX_BOARDS} workspaces.`);
  }

  const board = await TodoBoard.create({ user: req.user._id, name, order: boards.length });
  // A new workspace starts with the same three columns a first board does.
  await TodoColumn.insertMany(
    STARTER_COLUMNS.map((column, order) => ({
      ...column,
      order,
      user: req.user._id,
      board: board._id,
    })),
  );
  res.status(201).json({ success: true, board: presentBoard(board, await defaultBoardId(req.user)) });
}

export async function updateBoard(req, res) {
  const board = await ownBoard(req.user, req.params.id);
  board.name = readBoardName(req.body);
  await board.save();
  res.json({ success: true, board: presentBoard(board, await defaultBoardId(req.user)) });
}

/** A workspace goes with everything in it. The default one stays. */
export async function deleteBoard(req, res) {
  const board = await ownBoard(req.user, req.params.id);
  if (String(board._id) === (await defaultBoardId(req.user))) {
    throw ApiError.badRequest('Your default workspace can be renamed, but not deleted.');
  }
  const count = await TodoBoard.countDocuments({ user: req.user._id });
  if (count <= 1) throw ApiError.badRequest('You need at least one workspace.');

  const columns = await TodoColumn.find({ user: req.user._id, board: board._id }).select('_id');
  const ids = columns.map((column) => column._id);
  const { deletedCount } = await Todo.deleteMany({ user: req.user._id, column: { $in: ids } });
  await TodoColumn.deleteMany({ _id: { $in: ids } });
  await board.deleteOne();

  const rest = await TodoBoard.find({ user: req.user._id }).sort({ order: 1 }).select('_id');
  await renumber(
    TodoBoard,
    rest.map((item) => item._id),
  );

  res.json({ success: true, deletedTodos: deletedCount });
}

/* ----------------------------------------------------------------- board */

/** One workspace in one answer: columns left to right, cards top to bottom. */
export async function getBoard(req, res) {
  await boardsOf(req.user);
  const board = await ownBoard(req.user, req.query.board);

  let columns = await TodoColumn.find({ user: req.user._id, board: board._id }).sort({
    order: 1,
    createdAt: 1,
  });

  // An empty workspace is given somewhere to start.
  if (columns.length === 0) {
    columns = await TodoColumn.insertMany(
      STARTER_COLUMNS.map((column, order) => ({
        ...column,
        order,
        user: req.user._id,
        board: board._id,
      })),
    );
  }

  const todos = await Todo.find({
    user: req.user._id,
    column: { $in: columns.map((column) => column._id) },
  }).sort({ order: 1, createdAt: 1 });

  res.json({
    success: true,
    columns: columns.map(presentColumn),
    todos: todos.map(presentTodo),
  });
}

export async function createColumn(req, res) {
  const fields = readColumnFields(req.body, { creating: true });
  const board = await ownBoard(req.user, req.body?.board);

  const count = await TodoColumn.countDocuments({ user: req.user._id, board: board._id });
  if (count >= MAX_COLUMNS) {
    throw ApiError.badRequest(`A workspace can have at most ${MAX_COLUMNS} columns.`);
  }

  const column = await TodoColumn.create({
    ...fields,
    user: req.user._id,
    board: board._id,
    order: count,
  });
  res.status(201).json({ success: true, column: presentColumn(column) });
}

export async function updateColumn(req, res) {
  const column = await ownColumn(req.user, req.params.id);
  Object.assign(column, readColumnFields(req.body));
  await column.save();
  res.json({ success: true, column: presentColumn(column) });
}

/**
 * Removes a column. Its cards are not thrown away with it: they move to the
 * column named in `moveTo`, or the first remaining one, at the bottom.
 */
export async function deleteColumn(req, res) {
  const column = await ownColumn(req.user, req.params.id);

  // Only the columns of the same workspace: cards do not move between them.
  const others = await TodoColumn.find({
    user: req.user._id,
    board: column.board,
    _id: { $ne: column._id },
  }).sort({ order: 1 });
  if (others.length === 0) throw ApiError.badRequest('A workspace needs at least one column.');

  const moveTo = req.body?.moveTo
    ? others.find((item) => String(item._id) === String(req.body.moveTo))
    : others[0];
  if (!moveTo) throw ApiError.badRequest('Choose a column to move its cards to.');

  const [moving, already] = await Promise.all([
    Todo.find({ user: req.user._id, column: column._id }).sort({ order: 1 }).select('_id'),
    Todo.find({ user: req.user._id, column: moveTo._id }).sort({ order: 1 }).select('_id'),
  ]);

  await renumber(
    Todo,
    [...already, ...moving].map((todo) => todo._id),
    { column: moveTo._id },
  );
  await column.deleteOne();
  await renumber(
    TodoColumn,
    others.map((item) => item._id),
  );

  res.json({ success: true, movedTo: String(moveTo._id), moved: moving.length });
}

/** `{ board, ids: [...] }` - every column of one workspace, left to right. */
export async function reorderColumns(req, res) {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : null;
  if (!ids) throw ApiError.badRequest('Send the columns as a list.');
  const board = await ownBoard(req.user, req.body?.board);

  const columns = await TodoColumn.find({ user: req.user._id, board: board._id }).select('_id');
  const own = new Set(columns.map((column) => String(column._id)));
  if (ids.length !== own.size || ids.some((id) => !own.has(id))) {
    throw ApiError.badRequest('Send every column of the board, once each.');
  }

  await renumber(TodoColumn, ids);
  res.json({ success: true });
}

export async function createTodo(req, res) {
  const fields = readTodoFields(req.body, { creating: true });
  const column = await ownColumn(req.user, req.body?.column);

  // New cards go on top, where they are seen.
  await Todo.updateMany({ user: req.user._id, column: column._id }, { $inc: { order: 1 } });
  const todo = await Todo.create({ ...fields, user: req.user._id, column: column._id, order: 0 });

  res.status(201).json({ success: true, todo: presentTodo(todo) });
}

export async function updateTodo(req, res) {
  const todo = await ownTodo(req.user, req.params.id);
  Object.assign(todo, readTodoFields(req.body));
  await todo.save();
  res.json({ success: true, todo: presentTodo(todo) });
}

export async function deleteTodo(req, res) {
  const todo = await ownTodo(req.user, req.params.id);
  await todo.deleteOne();

  const rest = await Todo.find({ user: req.user._id, column: todo.column })
    .sort({ order: 1 })
    .select('_id');
  await renumber(
    Todo,
    rest.map((item) => item._id),
  );

  res.json({ success: true });
}

/**
 * A drop: `{ column, index }` puts the card at that position in that column,
 * which may be the one it is already in. Both columns are renumbered, so the
 * order on the server is always exactly what the board showed.
 */
export async function moveTodo(req, res) {
  const todo = await ownTodo(req.user, req.params.id);
  const target = await ownColumn(req.user, req.body?.column);
  const index = Number.isInteger(req.body?.index) ? req.body.index : 0;

  // A card stays in its own workspace; the columns of another are not on offer.
  const source = await TodoColumn.findById(todo.column).select('board');
  if (source && String(source.board) !== String(target.board)) {
    throw ApiError.badRequest('A to-do can only move between columns of its own workspace.');
  }

  const from = todo.column;
  const into = await Todo.find({ user: req.user._id, column: target._id, _id: { $ne: todo._id } })
    .sort({ order: 1 })
    .select('_id');

  const ids = into.map((item) => item._id);
  ids.splice(Math.max(0, Math.min(index, ids.length)), 0, todo._id);
  await renumber(Todo, ids, { column: target._id });

  if (String(from) !== String(target._id)) {
    const left = await Todo.find({ user: req.user._id, column: from }).sort({ order: 1 }).select('_id');
    await renumber(
      Todo,
      left.map((item) => item._id),
    );
  }

  res.json({ success: true });
}
