import mongoose from 'mongoose';

import env from './env.js';
import Message from '../models/Message.js';
import ThreadRead from '../models/ThreadRead.js';
import TicketAssignment from '../models/TicketAssignment.js';

/**
 * Collections the Prisma schema does not describe, and whose indexes therefore
 * have to be asked for here. `createIndexes` only adds what is missing - unlike
 * `syncIndexes`, it never drops one it does not recognise.
 */
const OURS = [Message, ThreadRead, TicketAssignment];

export async function connectDatabase() {
  mongoose.set('strictQuery', true);
  await mongoose.connect(env.mongoUri, {
    serverSelectionTimeoutMS: 8000,
    // Indexes are owned by the Prisma schema and created by `npm run
    // prisma:push`. Letting Mongoose build its own as well fails with
    // IndexOptionsConflict, because the two name the same keys differently.
    autoIndex: false,
    /**
     * A handful of sockets, opened before anything needs them.
     *
     * Every new connection to Atlas costs a TLS handshake, which is several
     * round trips of its own - so the first few parallel queries of a cold
     * process were each paying for their own introduction. Holding a few open
     * makes a parallel fetch cost one round trip rather than four.
     */
    minPoolSize: 5,
    maxPoolSize: 20,
  });
  console.log(`MongoDB connected: ${mongoose.connection.name}`);

  await Promise.all(
    OURS.map((model) =>
      model
        .createIndexes()
        .catch((error) => console.warn(`Index check failed for ${model.modelName}:`, error.message)),
    ),
  );

  return mongoose.connection;
}

export async function disconnectDatabase() {
  await mongoose.disconnect();
}
