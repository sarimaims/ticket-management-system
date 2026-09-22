/**
 * Idempotent seed: creates the super admin, the starting departments and a few
 * members so the UI has something to show. Safe to run repeatedly - nothing is
 * overwritten, only what is missing gets created.
 *
 *   npm run seed
 */
import { connectDatabase, disconnectDatabase } from '../config/db.js';
import Department from '../models/Department.js';
import Unit from '../models/Unit.js';
import User, { MANAGER_ROLES } from '../models/User.js';

const SUPER_ADMIN = {
  name: process.env.SEED_ADMIN_NAME || 'Super Admin',
  email: (process.env.SEED_ADMIN_EMAIL || 'admin@flowdesk.com').toLowerCase(),
  password: process.env.SEED_ADMIN_PASSWORD || 'admin1234',
};

/** The unit the central departments sit under. Renameable for a fresh workspace. */
const UNIT_NAME = process.env.SEED_UNIT_NAME || 'Head Office';

/**
 * Several units, not one.
 *
 * A single unit makes every unit picker in the app look like a label, because
 * there is nothing to narrow. With four, the pickers on the ticket form and
 * the create-user dialog do the job they were built for.
 */
const UNITS = [
  { name: UNIT_NAME, description: 'Central functions every site leans on.' },
  { name: 'Dubai Clinic', description: 'The Dubai site and the teams that run it.' },
  { name: 'Abu Dhabi Clinic', description: 'The Abu Dhabi site and its clinical teams.' },
  { name: 'Supply Chain', description: 'Buying, moving and holding stock for every site.' },
];

/**
 * Department names are unique across the whole workspace, not per unit, so
 * each one here is named for what it does rather than where it sits.
 */
const DEPARTMENTS = [
  { name: 'Human Resources', unit: UNIT_NAME, description: 'Hiring, onboarding and people operations.' },
  { name: 'IT Support', unit: UNIT_NAME, description: 'Accounts, hardware and internal tooling.' },
  { name: 'Development', unit: UNIT_NAME, description: 'Product engineering and platform work.' },
  { name: 'Graphics & Design', unit: UNIT_NAME, description: 'Brand, creatives and campaign design.' },
  { name: 'Finance', unit: UNIT_NAME, description: 'Purchasing, invoicing and approvals.' },
  { name: 'Digital Marketing', unit: UNIT_NAME, description: 'Campaigns, content and performance.' },

  { name: 'Reception', unit: 'Dubai Clinic', description: 'Front desk, appointments and patient records.' },
  { name: 'Nursing', unit: 'Dubai Clinic', description: 'Ward and outpatient nursing.' },
  { name: 'Pharmacy', unit: 'Dubai Clinic', description: 'Dispensing and medicine stock.' },

  { name: 'Radiology', unit: 'Abu Dhabi Clinic', description: 'Imaging, scans and reporting.' },
  { name: 'Physiotherapy', unit: 'Abu Dhabi Clinic', description: 'Rehabilitation and movement therapy.' },
  { name: 'Laboratory', unit: 'Abu Dhabi Clinic', description: 'Samples, testing and results.' },

  { name: 'Procurement', unit: 'Supply Chain', description: 'Suppliers, quotes and purchase orders.' },
  { name: 'Logistics', unit: 'Supply Chain', description: 'Deliveries between sites and stores.' },
];

/**
 * One head and at least one team member per department.
 *
 * Every department is staffed, because an empty one cannot be addressed at a
 * person - a ticket sent there can only be left for "anyone", which makes the
 * whole picker look broken the first time someone opens it.
 */
const MEMBERS = [
  { name: 'Ayesha Khan', email: 'ayesha.khan@flowdesk.com', department: 'Human Resources', role: 'head' },
  { name: 'Hira Aslam', email: 'hira.aslam@flowdesk.com', department: 'Human Resources', role: 'team' },
  { name: 'Intizar Shah', email: 'intizar.shah@flowdesk.com', department: 'Digital Marketing', role: 'head' },
  { name: 'Danish Raza', email: 'danish.raza@flowdesk.com', department: 'Digital Marketing', role: 'team' },
  { name: 'Bilal Ahmed', email: 'bilal.ahmed@flowdesk.com', department: 'IT Support', role: 'head' },
  { name: 'Sana Yousaf', email: 'sana.yousaf@flowdesk.com', department: 'IT Support', role: 'team' },
  { name: 'Zeeshan Haider', email: 'zeeshan.haider@flowdesk.com', department: 'Development', role: 'head' },
  { name: 'Hamza Tariq', email: 'hamza.tariq@flowdesk.com', department: 'Development', role: 'team' },
  { name: 'Areeba Siddiqui', email: 'areeba.siddiqui@flowdesk.com', department: 'Graphics & Design', role: 'head' },
  { name: 'Mehwish Ali', email: 'mehwish.ali@flowdesk.com', department: 'Graphics & Design', role: 'team' },
  { name: 'Usman Javed', email: 'usman.javed@flowdesk.com', department: 'Finance', role: 'head' },
  { name: 'Fatima Noor', email: 'fatima.noor@flowdesk.com', department: 'Finance', role: 'team' },

  { name: 'Rabia Anwar', email: 'rabia.anwar@flowdesk.com', department: 'Reception', role: 'head' },
  { name: 'Noor Abbas', email: 'noor.abbas@flowdesk.com', department: 'Reception', role: 'team' },
  { name: 'Saira Malik', email: 'saira.malik@flowdesk.com', department: 'Nursing', role: 'head' },
  { name: 'Junaid Farooq', email: 'junaid.farooq@flowdesk.com', department: 'Nursing', role: 'team' },
  { name: 'Adnan Qureshi', email: 'adnan.qureshi@flowdesk.com', department: 'Pharmacy', role: 'head' },
  { name: 'Maryam Iqbal', email: 'maryam.iqbal@flowdesk.com', department: 'Pharmacy', role: 'team' },

  { name: 'Faisal Nadeem', email: 'faisal.nadeem@flowdesk.com', department: 'Radiology', role: 'head' },
  { name: 'Aliya Rehman', email: 'aliya.rehman@flowdesk.com', department: 'Radiology', role: 'team' },
  { name: 'Omar Siddique', email: 'omar.siddique@flowdesk.com', department: 'Physiotherapy', role: 'head' },
  { name: 'Zainab Hussain', email: 'zainab.hussain@flowdesk.com', department: 'Physiotherapy', role: 'team' },
  { name: 'Tariq Mehmood', email: 'tariq.mehmood@flowdesk.com', department: 'Laboratory', role: 'head' },
  { name: 'Saba Kausar', email: 'saba.kausar@flowdesk.com', department: 'Laboratory', role: 'team' },

  { name: 'Imran Baig', email: 'imran.baig@flowdesk.com', department: 'Procurement', role: 'head' },
  { name: 'Nida Sultan', email: 'nida.sultan@flowdesk.com', department: 'Procurement', role: 'team' },
  { name: 'Kamran Aziz', email: 'kamran.aziz@flowdesk.com', department: 'Logistics', role: 'head' },
  { name: 'Rida Nawaz', email: 'rida.nawaz@flowdesk.com', department: 'Logistics', role: 'team' },
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

/** The same walk for units: two of them can shorten to the same code. */
async function uniqueUnitCode(name) {
  const base = Unit.codeFrom(name);
  let candidate = base;
  let suffix = 1;
  while (await Unit.exists({ code: candidate })) {
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

  // Departments hang off a unit, so the units come first.
  const units = new Map();
  for (const entry of UNITS) {
    let unit = await Unit.findOne({ name: entry.name });
    if (!unit) {
      unit = await Unit.create({
        name: entry.name,
        code: await uniqueUnitCode(entry.name),
        description: entry.description,
      });
      console.log(`Created unit ${unit.name} (${unit.code})`);
    }
    units.set(entry.name, unit);
  }

  const byName = new Map();
  for (const entry of DEPARTMENTS) {
    const parent = units.get(entry.unit);
    if (!parent) continue;

    let department = await Department.findOne({ name: entry.name });
    if (!department) {
      department = await Department.create({
        name: entry.name,
        code: await uniqueCode(entry.name),
        unit: parent._id,
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
