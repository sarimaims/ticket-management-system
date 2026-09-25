/**
 * Seeds the one account a fresh workspace cannot be built without: the super
 * admin who signs in and creates everything else.
 *
 *   npm run seed
 *
 * Idempotent and non-destructive. Nothing else is created - units, departments,
 * members and tickets are made in the app, by the person who knows what they
 * should be called. If the account is already there it is left alone, except
 * for drift that would break it: a wrong role, a suspended status, or a
 * department membership, which a manager must not hold.
 *
 * The password is only ever written when the account is created. To reset a
 * forgotten one deliberately:
 *
 *   SEED_ADMIN_PASSWORD=somethingNew SEED_FORCE_PASSWORD=yes npm run seed
 */
import { connectDatabase, disconnectDatabase } from '../config/db.js';
import User, { MANAGER_ROLES } from '../models/User.js';

const SUPER_ADMIN = {
  name: process.env.SEED_ADMIN_NAME || 'Super Admin',
  email: (process.env.SEED_ADMIN_EMAIL || 'admin@flowdesk.com').toLowerCase(),
  // Every account carries one; the owner's is set here so a fresh workspace
  // is not born with an account its own rules would refuse.
  phone: process.env.SEED_ADMIN_PHONE || '+971500000000',
  password: process.env.SEED_ADMIN_PASSWORD || 'admin1234',
};

/** Only ever true when it was asked for on the command line. */
const forcePassword = ['1', 'true', 'yes'].includes(
  (process.env.SEED_FORCE_PASSWORD ?? '').toLowerCase(),
);

async function run() {
  await connectDatabase();

  let admin = await User.findOne({ email: SUPER_ADMIN.email });

  if (!admin) {
    admin = await User.create({ ...SUPER_ADMIN, role: 'superadmin', status: 'active' });
    console.log(`Created super admin ${SUPER_ADMIN.email} / ${SUPER_ADMIN.password}`);
  } else {
    console.log(`Super admin already exists: ${SUPER_ADMIN.email}`);

    // Drift that would lock the workspace out of its own owner is corrected;
    // anything else about the account is left as the workspace has it.
    const fixes = [];
    if (admin.role !== 'superadmin') {
      admin.role = 'superadmin';
      fixes.push('role');
    }
    if (admin.status !== 'active') {
      admin.status = 'active';
      fixes.push('status');
    }
    // An owner from before the field existed cannot be edited until it has
    // one, so the seed puts the default back.
    if (!admin.phone) {
      admin.phone = SUPER_ADMIN.phone;
      fixes.push('phone');
    }
    if ((admin.memberships ?? []).length > 0) {
      admin.memberships = [];
      fixes.push('memberships');
    }
    if (forcePassword) {
      // The pre-save hook hashes it, so the plaintext never reaches the
      // database.
      admin.password = SUPER_ADMIN.password;
      fixes.push('password');
    }

    if (fixes.length > 0) {
      await admin.save({ validateBeforeSave: false });
      console.log(`Corrected: ${fixes.join(', ')}`);
    }
  }

  // Managers sit above the org chart. Anything left over from before that rule
  // existed is cleared here, so the data matches what the model now enforces.
  const stripped = await User.updateMany(
    { role: { $in: MANAGER_ROLES }, 'memberships.0': { $exists: true } },
    { $set: { memberships: [] } },
  );
  if (stripped.modifiedCount > 0) {
    console.log(`Removed department memberships from ${stripped.modifiedCount} manager account(s)`);
  }

  await disconnectDatabase();
  console.log('Seed complete.');
}

run().catch(async (error) => {
  console.error('Seed failed:', error.message);
  await disconnectDatabase();
  process.exit(1);
});
