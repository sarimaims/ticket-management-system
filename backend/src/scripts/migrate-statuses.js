import 'dotenv/config';
import mongoose from 'mongoose';

import Ticket from '../models/Ticket.js';

/**
 * Folds the statuses that no longer exist into the three that do.
 *
 * Accepted and Waiting were both "somebody is on it", so they become In
 * Progress. Overdue was a status people set by hand and is now worked out from
 * the deadline, so a ticket carrying it goes back to In Progress and reads as
 * overdue again by itself if its date has in fact passed.
 *
 * Safe to run twice: the second run finds nothing left to change.
 */
const FOLDS = {
  Accepted: 'In Progress',
  Waiting: 'In Progress',
  Overdue: 'In Progress',
};

async function run() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set.');

  await mongoose.connect(uri);

  for (const [was, now] of Object.entries(FOLDS)) {
    // Straight through the collection: the status is no longer in the schema's
    // enum, so a document holding it cannot be loaded and saved the usual way.
    const { modifiedCount } = await Ticket.collection.updateMany(
      { status: was },
      { $set: { status: now } },
    );

    console.log(`${was} -> ${now}: ${modifiedCount}`);
  }

  const left = await Ticket.collection.distinct('status');
  console.log('statuses now in use:', left.join(', ') || 'none');

  await mongoose.disconnect();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
