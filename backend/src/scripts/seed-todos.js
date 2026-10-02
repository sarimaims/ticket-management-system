/**
 * Puts a handful of sample to-dos on one person's board, so the dashboard's
 * to-do brief has something to show: late, due today, due this week, later,
 * undated, and a couple already done.
 *
 *   node src/scripts/seed-todos.js [email]            add the samples
 *   node src/scripts/seed-todos.js [email] --remove   take them away again
 *
 * The email defaults to kuldeep@gmail.com. Dates are relative to the day it
 * runs. Every sample carries the same marker in its description, so --remove
 * takes those and nothing a person wrote.
 *
 * Local databases only: it refuses to touch anything but localhost.
 */
import env from '../config/env.js';
import { connectDatabase, disconnectDatabase } from '../config/db.js';
import Todo from '../models/Todo.js';
import TodoBoard from '../models/TodoBoard.js';
import TodoColumn from '../models/TodoColumn.js';
import User from '../models/User.js';

const MARKER = '[sample to-do]';
const DAY = 86_400_000;

/** [title, column, priority, due in days (null = no date)] */
const SAMPLES = [
  ['Send Q3 vendor invoices to accounts', 'To Do', 'High', -2],
  ['Reconcile September petty cash', 'In Progress', 'Critical', -1],
  ['Finish onboarding pack for the new accountant', 'In Progress', 'Medium', 0],
  ['Check the payroll export before sign-off', 'Review', 'High', 0],
  ['Review budget variance report', 'Review', 'Critical', 1],
  ['Book room for the Thursday finance sync', 'To Do', 'Low', 2],
  ['Update the team leave calendar', 'To Do', 'Medium', 4],
  ['Prepare slides for the monthly close meeting', 'In Progress', 'Medium', 6],
  ['Archive last year\'s audit folders', 'To Do', 'Low', 12],
  ['Clean up the shared finance drive', 'To Do', 'Low', null],
  ['Renew the accounting software licence', 'Done', 'High', -3],
  ['Order printer toner for the office', 'Done', 'Low', null],
];

/** The board's columns as the brief expects them; a missing one is added. */
const WANTED = [
  { name: 'To Do', color: 'slate' },
  { name: 'In Progress', color: 'blue' },
  { name: 'Review', color: 'amber' },
  { name: 'Done', color: 'green' },
];

async function main() {
  if (!/\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(env.mongoUri)) {
    throw new Error('Refusing to seed: the database is not on localhost.');
  }

  const args = process.argv.slice(2);
  const remove = args.includes('--remove');
  const email = (args.find((arg) => !arg.startsWith('--')) ?? 'kuldeep@gmail.com').toLowerCase();

  await connectDatabase();
  try {
    const user = await User.findOne({ email });
    if (!user) throw new Error(`No user with the email ${email}.`);

    if (remove) {
      const { deletedCount } = await Todo.deleteMany({ user: user._id, description: MARKER });
      console.log(`Removed ${deletedCount} sample to-dos from ${user.name}'s board.`);
      return;
    }

    // Their first workspace, as the board page orders them; one is made if
    // they have never opened the page.
    let board = await TodoBoard.findOne({ user: user._id }).sort({ order: 1, createdAt: 1 });
    if (!board) board = await TodoBoard.create({ user: user._id, name: 'My board', order: 0 });

    const columns = await TodoColumn.find({ user: user._id, board: board._id }).sort({ order: 1 });
    const byName = new Map(columns.map((column) => [column.name.toLowerCase(), column]));
    let order = columns.length;
    for (const wanted of WANTED) {
      if (byName.has(wanted.name.toLowerCase())) continue;
      // eslint-disable-next-line no-await-in-loop
      const column = await TodoColumn.create({ ...wanted, user: user._id, board: board._id, order: order++ });
      byName.set(wanted.name.toLowerCase(), column);
    }

    const midnight = new Date(new Date().toDateString()).getTime();
    const counts = new Map();
    const docs = SAMPLES.map(([title, columnName, priority, inDays]) => {
      const column = byName.get(columnName.toLowerCase());
      const place = counts.get(columnName) ?? 0;
      counts.set(columnName, place + 1);
      return {
        user: user._id,
        column: column._id,
        title,
        description: MARKER,
        priority,
        // Noon, so the date is the same day in any timezone near this one.
        dueDate: inDays === null ? null : new Date(midnight + inDays * DAY + 12 * 3_600_000),
        order: 1000 + place,
      };
    });

    await Todo.insertMany(docs);
    console.log(`Added ${docs.length} sample to-dos to ${user.name}'s "${board.name}".`);
  } finally {
    await disconnectDatabase();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
