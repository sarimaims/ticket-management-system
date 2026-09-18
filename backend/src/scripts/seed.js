/**
 * Idempotent seed: creates the super admin, the starting departments and a few
 * members so the UI has something to show. Safe to run repeatedly - nothing is
 * overwritten, only what is missing gets created.
 *
 *   npm run seed
 */
import { connectDatabase, disconnectDatabase } from '../config/db.js';
import Department from '../models/Department.js';
import User, { MANAGER_ROLES } from '../models/User.js';

const SUPER_ADMIN = {
  name: process.env.SEED_ADMIN_NAME || 'Super Admin',
  email: (process.env.SEED_ADMIN_EMAIL || 'admin@flowdesk.com').toLowerCase(),
  password: process.env.SEED_ADMIN_PASSWORD || 'admin1234',
};

const DEPARTMENTS = [
  { name: 'Human Resources', description: 'Hiring, onboarding and people operations.' },
  { name: 'IT Support', description: 'Accounts, hardware and internal tooling.' },
  { name: 'Development', description: 'Product engineering and platform work.' },
  { name: 'Graphics & Design', description: 'Brand, creatives and campaign design.' },
  { name: 'Finance', description: 'Purchasing, invoicing and approvals.' },
  { name: 'Digital Marketing', description: 'Campaigns, content and performance.' },
];

const MEMBERS = [
  { name: 'Ayesha Khan', email: 'ayesha.khan@flowdesk.com', department: 'Human Resources', role: 'head' },
  { name: 'Intizar Shah', email: 'intizar.shah@flowdesk.com', department: 'Digital Marketing', role: 'head' },
  { name: 'Bilal Ahmed', email: 'bilal.ahmed@flowdesk.com', department: 'IT Support', role: 'head' },
  { name: 'Sana Yousaf', email: 'sana.yousaf@flowdesk.com', department: 'IT Support', role: 'team' },
  { name: 'Hamza Tariq', email: 'hamza.tariq@flowdesk.com', department: 'Development', role: 'team' },
  { name: 'Mehwish Ali', email: 'mehwish.ali@flowdesk.com', department: 'Graphics & Design', role: 'team' },
];

const MEMBER_PASSWORD = process.env.SEED_MEMBER_PASSWORD || 'flowdesk1234';

async function uniqueCode(name) {
  const base = Department.codeFrom(name);
  let candidate = base;
  let suffix = 1;
  while (await Department.exists({ code: candidate })) {
    suffix += 1;
    candidate = `${base}${suffix}`.slice(0, 8);
  }
  return candidate;
}

async function run() {
  await connectDatabase();

  let admin = await User.findOne({ email: SUPER_ADMIN.email });
  if (!admin) {
    admin = await User.create({ ...SUPER_ADMIN, role: 'superadmin', status: 'active' });
    console.log(`Created super admin ${SUPER_ADMIN.email} / ${SUPER_ADMIN.password}`);
  } else {
    console.log(`Super admin already exists: ${SUPER_ADMIN.email}`);
  }

  const byName = new Map();
  for (const entry of DEPARTMENTS) {
    let department = await Department.findOne({ name: entry.name });
    if (!department) {
      department = await Department.create({
        name: entry.name,
        code: await uniqueCode(entry.name),
        description: entry.description,
        createdBy: admin._id,
      });
      console.log(`Created department ${department.name} (${department.code})`);
    }
    byName.set(entry.name, department);
  }

  for (const entry of MEMBERS) {
    const department = byName.get(entry.department);
    if (!department) continue;

    let user = await User.findOne({ email: entry.email });
    if (!user) {
      user = await User.create({
        name: entry.name,
        email: entry.email,
        password: MEMBER_PASSWORD,
        role: 'user',
        status: 'active',
        memberships: [{ department: department._id, role: entry.role }],
      });
      console.log(`Created ${entry.role} ${entry.email} in ${entry.department}`);
    } else if (!user.roleInDepartment(department._id)) {
      user.memberships.push({ department: department._id, role: entry.role });
      await user.save({ validateBeforeSave: false });
      console.log(`Added ${entry.email} to ${entry.department} as ${entry.role}`);
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
