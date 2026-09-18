/**
 * Prisma seeder: fills in the one super admin the workspace needs.
 *
 *   npm run prisma:seed      (or: npx prisma db seed)
 *
 * Idempotent and non-destructive. Nothing else is created - departments,
 * members and tickets are made in the app. If the account is already there it
 * is left alone, except for drift that would break it: a wrong role, a
 * suspended status, or a department membership, which a manager must not hold.
 *
 * The password is only ever written when the account is created. To reset a
 * forgotten one deliberately:
 *
 *   SEED_ADMIN_PASSWORD=somethingNew SEED_FORCE_PASSWORD=yes npm run prisma:seed
 *
 * Passwords are hashed here with the same bcrypt cost the User model uses, so
 * an account made by this seeder logs in exactly like one made through the API.
 *
 * Reads go through the Prisma client. Writes go through $runCommandRaw,
 * because prisma.user.create() opens a transaction and MongoDB only offers
 * those on a replica set - a plain local mongod refuses. Swap these two
 * helpers for prisma.user.create / prisma.user.update once this database runs
 * as a replica set; nothing else in the file changes.
 */
import bcrypt from 'bcryptjs';

import { prisma, disconnectPrisma } from '../src/config/prisma.js';

const BCRYPT_ROUNDS = 10;
const MIN_PASSWORD_LENGTH = 8;

const SUPER_ADMIN = {
  name: process.env.SEED_ADMIN_NAME || 'Super Admin',
  email: (process.env.SEED_ADMIN_EMAIL || 'admin@flowdesk.com').trim().toLowerCase(),
  password: process.env.SEED_ADMIN_PASSWORD || 'admin1234',
};

const forcePassword = process.env.SEED_FORCE_PASSWORD === 'yes';

/** BSON dates travel as extended JSON through a raw command. */
const asDate = (value) => ({ $date: value.toISOString() });

async function insertUser(document) {
  const result = await prisma.$runCommandRaw({ insert: 'users', documents: [document] });
  if (result.ok !== 1 || result.n !== 1) {
    throw new Error(`Insert failed: ${JSON.stringify(result.writeErrors ?? result)}`);
  }
}

async function updateUser(id, patch) {
  const result = await prisma.$runCommandRaw({
    update: 'users',
    updates: [{ q: { _id: { $oid: id } }, u: { $set: { ...patch, updatedAt: asDate(new Date()) } } }],
  });
  if (result.ok !== 1) {
    throw new Error(`Update failed: ${JSON.stringify(result.writeErrors ?? result)}`);
  }
}

async function run() {
  if (SUPER_ADMIN.password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`SEED_ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }

  const existing = await prisma.user.findUnique({
    where: { email: SUPER_ADMIN.email },
    select: { id: true, name: true, role: true, status: true, memberships: true },
  });

  if (!existing) {
    const now = new Date();
    await insertUser({
      name: SUPER_ADMIN.name,
      email: SUPER_ADMIN.email,
      password: await bcrypt.hash(SUPER_ADMIN.password, BCRYPT_ROUNDS),
      role: 'superadmin',
      status: 'active',
      // A manager's rights are workspace wide, so it belongs to no department.
      memberships: [],
      lastActiveAt: asDate(now),
      createdAt: asDate(now),
      updatedAt: asDate(now),
    });

    const created = await prisma.user.findUnique({
      where: { email: SUPER_ADMIN.email },
      select: { id: true },
    });
    console.log(`Created super admin ${SUPER_ADMIN.email} / ${SUPER_ADMIN.password}`);
    console.log(`  id: ${created?.id}`);
  } else {
    const repairs = {};
    if (existing.name !== SUPER_ADMIN.name) repairs.name = SUPER_ADMIN.name;
    if (existing.role !== 'superadmin') repairs.role = 'superadmin';
    if (existing.status !== 'active') repairs.status = 'active';
    if (existing.memberships.length > 0) repairs.memberships = [];
    if (forcePassword) repairs.password = await bcrypt.hash(SUPER_ADMIN.password, BCRYPT_ROUNDS);

    if (Object.keys(repairs).length === 0) {
      console.log(`Super admin already correct: ${SUPER_ADMIN.email} (nothing changed)`);
    } else {
      await updateUser(existing.id, repairs);
      const changed = Object.keys(repairs).map((key) =>
        key === 'password' ? 'password (reset)' : key,
      );
      console.log(`Super admin ${SUPER_ADMIN.email} updated: ${changed.join(', ')}`);
    }
  }

  // One owner, by design. More than one means an account was promoted by hand.
  const owners = await prisma.user.findMany({
    where: { role: 'superadmin' },
    select: { email: true },
  });
  if (owners.length > 1) {
    console.warn(
      `Warning: ${owners.length} super admins exist (${owners
        .map((owner) => owner.email)
        .join(', ')}). There should be one.`,
    );
  }

  console.log('Seed complete.');
}

try {
  await run();
} catch (error) {
  console.error('Seed failed:', error.message);
  process.exitCode = 1;
} finally {
  await disconnectPrisma();
}
