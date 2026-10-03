/**
 * Points tickets at departments that still exist.
 *
 *   npm run repair:ticket-departments            -> dry run: lists what it would change
 *   npm run repair:ticket-departments -- --apply -> changes it
 *
 * A ticket keeps the department ids it was raised to and from. Deleting a
 * department - or deleting it and making it again under the same name -
 * leaves those ids pointing at nothing. The people on the ticket still have
 * it, but the department they are in now is not on it, so its head never sees
 * it and the ticket shows a row of dashes where a department should be.
 *
 * For each ticket this keeps the departments that still exist and adds, for
 * anybody on it who is in none of those, the department they are in today.
 * The side it came from is repaired the same way from the person who raised
 * it. Safe to run more than once: a ticket with nothing to repair is left
 * alone.
 */
import mongoose from 'mongoose';

import { connectDatabase, disconnectDatabase } from '../config/db.js';

const APPLY = process.argv.includes('--apply');

async function run() {
  await connectDatabase();
  const db = mongoose.connection.db;
  console.log(`Database: ${mongoose.connection.host} / ${mongoose.connection.name}`);
  console.log(APPLY ? 'Applying changes.' : 'Dry run - nothing is written. Add --apply to write.');

  const departments = await db.collection('departments').find({}, { projection: { name: 1 } }).toArray();
  const nameOf = new Map(departments.map((department) => [String(department._id), department.name]));
  const exists = (id) => nameOf.has(String(id));

  const users = await db
    .collection('users')
    .find({}, { projection: { name: 1, memberships: 1 } })
    .toArray();
  const userById = new Map(users.map((user) => [String(user._id), user]));
  const rolesOf = (id) => (userById.get(String(id))?.memberships ?? []).map((role) => String(role.department));

  const tickets = db.collection('tickets');
  let repaired = 0;
  let stranded = 0;

  for await (const ticket of tickets.find({})) {
    const stored = [...new Set([ticket.department, ...(ticket.departments ?? [])].filter(Boolean).map(String))];
    const to = stored.filter(exists);
    for (const person of ticket.assignees ?? []) {
      const roles = rolesOf(person);
      if (roles.length === 0 || roles.some((id) => to.includes(id))) continue;
      const theirs = roles.find(exists);
      if (theirs) to.push(theirs);
    }

    const fromStored = (ticket.fromDepartments ?? []).map(String);
    const from = fromStored.filter(exists);
    if (from.length === 0 && fromStored.length > 0) {
      const theirs = rolesOf(ticket.raisedBy).find(exists);
      if (theirs) from.push(theirs);
    }

    const toChanged = to.join(',') !== stored.join(',');
    const fromChanged = from.join(',') !== fromStored.join(',');
    if (!toChanged && !fromChanged) continue;

    if (to.length === 0) {
      // Every department gone and nobody on it to say where it belongs now.
      stranded += 1;
      console.log(`  ${ticket.number}: no department left and nobody on it - left as it is`);
      continue;
    }

    const label = (ids) => ids.map((id) => nameOf.get(id) ?? `(deleted ${id.slice(-6)})`).join(', ') || '-';
    console.log(
      `  ${ticket.number}: to [${label(stored)}] -> [${label(to)}]` +
        (fromChanged ? `  from [${label(fromStored)}] -> [${label(from)}]` : ''),
    );
    repaired += 1;

    if (APPLY) {
      const lead = stored[0] && exists(stored[0]) ? stored[0] : to[0];
      const asIds = (ids) => ids.map((id) => new mongoose.Types.ObjectId(id));
      // eslint-disable-next-line no-await-in-loop
      await tickets.updateOne(
        { _id: ticket._id },
        {
          $set: {
            department: new mongoose.Types.ObjectId(lead),
            departments: asIds([lead, ...to.filter((id) => id !== lead)]),
            ...(fromChanged && from.length > 0 ? { fromDepartments: asIds(from) } : {}),
          },
        },
      );
    }
  }

  console.log(
    `${repaired} ticket(s) ${APPLY ? 'repaired' : 'to repair'}` + (stranded ? `, ${stranded} left as they are` : '') + '.',
  );
  await disconnectDatabase();
}

run().catch(async (error) => {
  console.error('Repair failed:', error);
  await disconnectDatabase().catch(() => {});
  process.exit(1);
});
