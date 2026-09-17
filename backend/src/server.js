import app from './app.js';
import env from './config/env.js';
import { connectDatabase, disconnectDatabase } from './config/db.js';

let server;

try {
  await connectDatabase();
  server = app.listen(env.port, () => {
    console.log(`Server running in ${env.nodeEnv} mode on http://localhost:${env.port}`);
  });
} catch (error) {
  console.error('Failed to start:', error.message);
  process.exit(1);
}

const shutdown = async (signal) => {
  console.log(`${signal} received, shutting down.`);
  server?.close(async () => {
    await disconnectDatabase();
    process.exit(0);
  });
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
