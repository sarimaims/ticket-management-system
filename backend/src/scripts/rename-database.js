/**
 * One-off: moves the workspace from the old `aivin_tickets` database to
 * `flowdesk_tickets`, and renames the seeded super admin's address to match.
 * MongoDB cannot rename a database, so every collection is copied across and
 * the old database is dropped only after the counts are confirmed equal.
 *
 *   node src/scripts/rename-database.js
 *
 * Safe to run twice: the second run finds nothing to move.
 */
import mongoose from 'mongoose';

const HOST = process.env.MONGO_HOST || 'mongodb://127.0.0.1:27017';
const OLD_DB = process.env.OLD_DB || 'aivin_tickets';
const NEW_DB = process.env.NEW_DB || 'flowdesk_tickets';
const OLD_ADMIN = 'admin@aivin.com';
const NEW_ADMIN = 'admin@flowdesk.com';

async function run() {
  await mongoose.connect(`${HOST}/${OLD_DB}`);
  const source = mongoose.connection.db;
  const target = mongoose.connection.client.db(NEW_DB);

  const collections = await source.listCollections().toArray();
  if (collections.length === 0) {
    console.log(`Nothing in ${OLD_DB} - already migrated.`);
    await mongoose.disconnect();
    return;
  }

  const moved = {};
  for (const { name } of collections) {
    // eslint-disable-next-line no-await-in-loop
    const documents = await source.collection(name).find({}).toArray();
    if (documents.length > 0) {
      // eslint-disable-next-line no-await-in-loop
      await target.collection(name).deleteMany({});
      // eslint-disable-next-line no-await-in-loop
      await target.collection(name).insertMany(documents);
    }
    moved[name] = documents.length;
  }
  console.log('Copied:', moved);

  // Verify before destroying anything.
  for (const [name, count] of Object.entries(moved)) {
    // eslint-disable-next-line no-await-in-loop
    const arrived = await target.collection(name).countDocuments();
    if (arrived !== count) {
      throw new Error(`${name}: expected ${count} documents, found ${arrived}. Old database kept.`);
    }
  }

  const renamed = await target
    .collection('users')
    .updateOne({ email: OLD_ADMIN }, { $set: { email: NEW_ADMIN } });
  if (renamed.modifiedCount > 0) {
    console.log(`Super admin address is now ${NEW_ADMIN}`);
  }

  await source.dropDatabase();
  console.log(`Dropped ${OLD_DB}. Workspace now lives in ${NEW_DB}.`);

  await mongoose.disconnect();
}

run().catch(async (error) => {
  console.error('Migration failed:', error.message);
  await mongoose.disconnect();
  process.exit(1);
});
