import { PrismaClient } from '@prisma/client';

import env from './env.js';

/**
 * One Prisma client per process, reading the same database as Mongoose.
 *
 * Nodemon reloads the module on every save, so the instance is parked on
 * `globalThis` - otherwise each restart would open another connection pool and
 * MongoDB would run out of connections in a long dev session.
 */
const globalForPrisma = globalThis;

export const prisma =
  globalForPrisma.__flowdeskPrisma ??
  new PrismaClient({
    log: env.isProduction ? ['error'] : ['warn', 'error'],
  });

if (!env.isProduction) globalForPrisma.__flowdeskPrisma = prisma;

export async function disconnectPrisma() {
  await prisma.$disconnect();
}
