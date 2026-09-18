import mongoose from 'mongoose';

import env from './env.js';

export async function connectDatabase() {
  mongoose.set('strictQuery', true);
  await mongoose.connect(env.mongoUri, {
    serverSelectionTimeoutMS: 8000,
    // Indexes are owned by the Prisma schema and created by `npm run
    // prisma:push`. Letting Mongoose build its own as well fails with
    // IndexOptionsConflict, because the two name the same keys differently.
    autoIndex: false,
  });
  console.log(`MongoDB connected: ${mongoose.connection.name}`);
  return mongoose.connection;
}

export async function disconnectDatabase() {
  await mongoose.disconnect();
}
