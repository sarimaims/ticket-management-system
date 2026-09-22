/**
 * One assignee becomes several.
 *
 *   npm run migrate:assignees
 *
 * A department often puts two people on one request, so `assignee` on a ticket
 * and `from`/`to` on an assignment line are now lists. This rewrites what is
 * already stored into the new shape, and is safe to run more than once: a
 * document already carrying the list is left alone.
 */
import mongoose from 'mongoose';

import { connectDatabase, disconnectDatabase } from '../config/db.js';

async function run() {
  await connectDatabase();
  const db = mongoose.connection.db;

  // --- tickets -------------------------------------------------------------
  const tickets = db.collection('tickets');
  let moved = 0;
  let emptied = 0;

  for await (const ticket of tickets.find({ assignees: { $exists: false } })) {
    const held = ticket.assignee ? [ticket.assignee] : [];
    await tickets.updateOne(
      { _id: ticket._id },
      { $set: { assignees: held }, $unset: { assignee: '' } },
    );
    if (held.length > 0) moved += 1;
    else emptied += 1;
  }
  console.log(`Tickets: ${moved} carried a name over, ${emptied} had none.`);

  // --- the assignment trail -------------------------------------------------
  const trail = db.collection('ticketassignments');
  let lines = 0;

  for await (const entry of trail.find({ toNames: { $exists: false } })) {
    await trail.updateOne(
      { _id: entry._id },
      {
        $set: {
          from: entry.from ? [entry.from] : [],
          fromNames: entry.fromName ? [entry.fromName] : [],
          to: entry.to ? [entry.to] : [],
          toNames: entry.toName ? [entry.toName] : [],
        },
        $unset: { fromName: '', toName: '' },
      },
    );
    lines += 1;
  }
  console.log(`Assignment trail: ${lines} line(s) rewritten.`);

  await disconnectDatabase();
  console.log('Migration complete.');
}

run().catch(async (error) => {
  console.error('Migration failed:', error.message);
  await disconnectDatabase();
  process.exit(1);
});
