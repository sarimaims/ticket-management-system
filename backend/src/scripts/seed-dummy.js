/**
 * Extra demo data hung off one account, so a real session has something to
 * look at: more units, more departments, and a spread of tickets in both
 * directions.
 *
 *   npm run seed:dummy
 *
 * Idempotent, like `npm run seed`: everything is looked up by name first, and
 * only what is missing gets written. Nothing already in the workspace is
 * renamed, restaffed or deleted.
 *
 * The account it hangs off:
 *   SEED_DUMMY_EMAIL, default dummy@flowdesk.com
 */
import { connectDatabase, disconnectDatabase } from '../config/db.js';
import Department from '../models/Department.js';
import Ticket from '../models/Ticket.js';
import Unit from '../models/Unit.js';
import User from '../models/User.js';

const DUMMY_EMAIL = (process.env.SEED_DUMMY_EMAIL || 'dummy@flowdesk.com').toLowerCase();
const MEMBER_PASSWORD = process.env.SEED_MEMBER_PASSWORD || 'flowdesk1234';

/** Two more units, so the unit switcher has somewhere to switch to. */
const UNITS = [
  { name: 'Sharjah Clinic', description: 'The Sharjah site and the teams that run it.' },
  { name: 'Training Academy', description: 'Clinical training, certification and compliance.' },
];

const DEPARTMENTS = [
  { name: 'Patient Experience', unit: 'Sharjah Clinic', description: 'Feedback, complaints and the front-of-house standard.' },
  { name: 'Dental', unit: 'Sharjah Clinic', description: 'Dental clinic, hygiene and orthodontics.' },
  { name: 'Clinical Training', unit: 'Training Academy', description: 'Courses, assessments and refreshers.' },
  { name: 'Compliance', unit: 'Training Academy', description: 'Audits, licences and regulatory paperwork.' },
  { name: 'Internal Audit', unit: 'Head Office', description: 'Controls, spot checks and remediation.' },
];

/**
 * A head and a team member for every new department.
 *
 * An unstaffed department cannot be addressed at anybody, which makes the
 * people picker look broken the first time it is opened on one.
 */
const MEMBERS = [
  { name: 'Yusra Kamal', email: 'yusra.kamal@flowdesk.com', department: 'Patient Experience', role: 'head' },
  { name: 'Hassan Raza', email: 'hassan.raza@flowdesk.com', department: 'Patient Experience', role: 'team' },
  { name: 'Iqra Shahid', email: 'iqra.shahid@flowdesk.com', department: 'Dental', role: 'head' },
  { name: 'Waleed Akram', email: 'waleed.akram@flowdesk.com', department: 'Dental', role: 'team' },
  { name: 'Sadia Raheel', email: 'sadia.raheel@flowdesk.com', department: 'Clinical Training', role: 'head' },
  { name: 'Bilal Munir', email: 'bilal.munir@flowdesk.com', department: 'Clinical Training', role: 'team' },
  { name: 'Nauman Sheikh', email: 'nauman.sheikh@flowdesk.com', department: 'Compliance', role: 'head' },
  { name: 'Anum Zafar', email: 'anum.zafar@flowdesk.com', department: 'Compliance', role: 'team' },
  { name: 'Rehan Abbasi', email: 'rehan.abbasi@flowdesk.com', department: 'Internal Audit', role: 'head' },
  { name: 'Komal Ashraf', email: 'komal.ashraf@flowdesk.com', department: 'Internal Audit', role: 'team' },
];

/**
 * Where the demo account sits after this runs: three units rather than two,
 * and a department it heads in a brand new one - so switching unit visibly
 * changes what the ticket lists hold.
 */
const DUMMY_MEMBERSHIPS = [
  { department: 'Patient Experience', role: 'head' },
  { department: 'Clinical Training', role: 'team' },
  { department: 'Finance', role: 'team' },
];

const DAY = 24 * 60 * 60 * 1000;

/**
 * The tickets.
 *
 * `from` is who raised it - `dummy` for the demo account, otherwise the email
 * of a seeded member. `to` is the department being asked. `agedDays` backdates
 * it, `dueDays` is relative to today, so a run in six months still produces a
 * queue with overdue work, work due today and work due later.
 */
const TICKETS = [
  // --- raised by the demo account: these fill My Requests -----------------
  {
    from: 'dummy',
    to: 'IT Support',
    onBehalfOf: 'Digital Marketing',
    subject: 'Laptop replacement for the campaigns desk',
    description:
      'The campaigns laptop will not hold a charge for more than twenty minutes and is now tied to the desk. Please replace or service it.',
    priority: 'High',
    status: 'In Progress',
    agedDays: 9,
    dueDays: 2,
    committedDays: 3,
    assignTo: 'bilal.ahmed@flowdesk.com',
    project: 'Workplace IT',
  },
  {
    from: 'dummy',
    to: 'Finance',
    onBehalfOf: 'Digital Marketing',
    subject: 'Approve Q4 paid media budget',
    description:
      'Media plan for the last quarter is attached in the shared drive. Needs sign-off before we can commit the spend with the agency.',
    priority: 'Critical',
    status: 'In Progress',
    agedDays: 6,
    dueDays: -1,
    project: 'Q4 Campaign',
  },
  {
    from: 'dummy',
    to: 'Graphics & Design',
    onBehalfOf: 'Digital Marketing',
    subject: 'Social templates for the Sharjah launch',
    description:
      'Six square and six story templates in the new brand palette, editable, for the Sharjah clinic opening.',
    priority: 'Medium',
    status: 'In Progress',
    agedDays: 4,
    dueDays: 5,
    committedDays: 6,
    project: 'Sharjah Launch',
  },
  {
    from: 'dummy',
    to: 'Human Resources',
    subject: 'Onboarding for two new campaign executives',
    description:
      'Two joiners start at the beginning of next month. Please raise the accounts, badges and induction slots.',
    priority: 'Medium',
    status: 'New',
    agedDays: 1,
    dueDays: 9,
  },
  {
    from: 'dummy',
    to: 'Procurement',
    onBehalfOf: 'Digital Marketing',
    subject: 'Quotes for exhibition stand hire',
    description:
      'Three comparable quotes for a six by three metre stand, build and teardown included, for the February health expo.',
    priority: 'Low',
    status: 'Completed',
    agedDays: 21,
    dueDays: -7,
    committedDays: -8,
    project: 'Health Expo',
  },
  {
    from: 'dummy',
    to: 'Compliance',
    subject: 'Sign off marketing claims for the dental page',
    description:
      'The new dental landing page makes two clinical claims. Both need a compliance read before it goes live.',
    priority: 'High',
    status: 'New',
    agedDays: 2,
    dueDays: 3,
    project: 'Sharjah Launch',
  },
  {
    from: 'dummy',
    to: 'Development',
    subject: 'Campaign landing pages behind a feature flag',
    description:
      'Three landing pages need to ship dark so the campaign can be switched on at a fixed time rather than deployed live.',
    priority: 'Medium',
    status: 'In Progress',
    agedDays: 12,
    dueDays: 4,
    committedDays: 4,
    assignTo: 'hamza.tariq@flowdesk.com',
    project: 'Q4 Campaign',
  },

  // --- raised at the demo account's departments: these fill the queues ----
  {
    from: 'rehan.abbasi@flowdesk.com',
    to: 'Digital Marketing',
    subject: 'Evidence pack for the advertising spend audit',
    description:
      'Invoices, media plans and approvals for the last two quarters. Needed for the internal audit file.',
    priority: 'High',
    status: 'In Progress',
    agedDays: 5,
    dueDays: 1,
    committedDays: 2,
    assignDummy: true,
  },
  {
    from: 'yusra.kamal@flowdesk.com',
    to: 'Patient Experience',
    subject: 'Patient feedback forms are not reaching the inbox',
    description:
      'Forms submitted from the tablet at reception have not arrived since Monday. Paper is being used as a stopgap.',
    priority: 'Critical',
    status: 'New',
    agedDays: 0,
    dueDays: 0,
    assignDummy: true,
  },
  {
    from: 'iqra.shahid@flowdesk.com',
    to: 'Patient Experience',
    subject: 'Rewrite the dental aftercare leaflet',
    description:
      'The current leaflet is three years old and still lists the old opening hours and phone number.',
    priority: 'Low',
    status: 'New',
    agedDays: 3,
    dueDays: 11,
  },
  {
    from: 'sadia.raheel@flowdesk.com',
    to: 'Clinical Training',
    subject: 'Schedule the annual resuscitation refresher',
    description:
      'Every clinical member of staff is due a refresher before the end of the quarter. Needs rooms and two trainers.',
    priority: 'High',
    status: 'In Progress',
    agedDays: 8,
    dueDays: 6,
    committedDays: 7,
    assignDummy: true,
  },
  {
    from: 'usman.javed@flowdesk.com',
    to: 'Finance',
    subject: 'Reconcile the agency retainer invoices',
    description:
      'Two retainer invoices were paid against the wrong cost centre and need moving before the month closes.',
    priority: 'Medium',
    status: 'In Progress',
    agedDays: 14,
    dueDays: -3,
    assignDummy: true,
  },
  {
    from: 'omar.siddique@flowdesk.com',
    to: 'Physiotherapy',
    subject: 'Replace the worn treatment couch in room 2',
    description:
      'The headrest no longer locks and the vinyl has split. It is being worked around rather than used.',
    priority: 'Medium',
    status: 'In Progress',
    agedDays: 7,
    dueDays: 8,
    committedDays: 10,
    assignDummy: true,
  },
  {
    from: 'nauman.sheikh@flowdesk.com',
    to: 'Digital Marketing',
    subject: 'Take down the expired promotional pricing',
    description:
      'The summer offer ended a fortnight ago and is still live on two pages. It has to come down today.',
    priority: 'Critical',
    status: 'In Progress',
    agedDays: 16,
    dueDays: -4,
    assignDummy: true,
  },
  {
    from: 'waleed.akram@flowdesk.com',
    to: 'Dental',
    subject: 'Order impression trays and a curing light',
    description:
      'Stock of medium trays is down to a fortnight and the spare curing light has failed.',
    priority: 'Medium',
    status: 'New',
    agedDays: 2,
    dueDays: 7,
  },
  {
    from: 'komal.ashraf@flowdesk.com',
    to: 'Internal Audit',
    subject: 'Close out the petty cash findings',
    description:
      'Four findings from the last review are still open. Each needs an owner and a date.',
    priority: 'Low',
    status: 'Completed',
    agedDays: 25,
    dueDays: -10,
    committedDays: -12,
  },
];

/** A department's code, made unique the way the app makes it unique. */
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

const at = (days) => new Date(Date.now() + days * DAY);

async function run() {
  await connectDatabase();

  const dummy = await User.findOne({ email: DUMMY_EMAIL });
  if (!dummy) {
    throw new Error(
      `No account for ${DUMMY_EMAIL}. Create it first, or set SEED_DUMMY_EMAIL to one that exists.`,
    );
  }

  const counts = { units: 0, departments: 0, members: 0, memberships: 0, tickets: 0 };

  // Departments hang off a unit, so the units come first.
  for (const entry of UNITS) {
    const existing = await Unit.findOne({ name: entry.name });
    if (existing) continue;

    const unit = await Unit.create({
      name: entry.name,
      code: await uniqueUnitCode(entry.name),
      description: entry.description,
    });
    counts.units += 1;
    console.log(`Created unit ${unit.name} (${unit.code})`);
  }

  const byName = new Map();
  for (const entry of DEPARTMENTS) {
    const parent = await Unit.findOne({ name: entry.unit });
    if (!parent) {
      console.log(`Skipped ${entry.name}: no unit called ${entry.unit}`);
      continue;
    }

    let department = await Department.findOne({ name: entry.name });
    if (!department) {
      department = await Department.create({
        name: entry.name,
        code: await uniqueCode(entry.name),
        unit: parent._id,
        description: entry.description,
      });
      counts.departments += 1;
      console.log(`Created department ${department.name} (${department.code})`);
    }
    byName.set(entry.name, department);
  }

  // Anything the tickets below refer to, whether this script made it or the
  // main seed did.
  for (const entry of [...DEPARTMENTS.map((item) => item.name), ...new Set(TICKETS.map((item) => item.to))]) {
    if (byName.has(entry)) continue;
    const found = await Department.findOne({ name: entry });
    if (found) byName.set(entry, found);
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
      counts.members += 1;
      console.log(`Created ${entry.role} ${entry.email} in ${entry.department}`);
    } else if (!user.roleInDepartment(department._id)) {
      user.memberships.push({ department: department._id, role: entry.role });
      await user.save({ validateBeforeSave: false });
      console.log(`Added ${entry.email} to ${entry.department} as ${entry.role}`);
    }
  }

  // The demo account's own memberships, added rather than replaced: whatever
  // it already belongs to stays.
  for (const entry of DUMMY_MEMBERSHIPS) {
    const department = byName.get(entry.department);
    if (!department) continue;
    if (dummy.roleInDepartment(department._id)) continue;

    dummy.memberships.push({ department: department._id, role: entry.role });
    counts.memberships += 1;
    console.log(`Added ${DUMMY_EMAIL} to ${entry.department} as ${entry.role}`);
  }
  if (counts.memberships > 0) await dummy.save({ validateBeforeSave: false });

  for (const entry of TICKETS) {
    const department = byName.get(entry.to);
    if (!department) {
      console.log(`Skipped "${entry.subject}": no department called ${entry.to}`);
      continue;
    }

    // Subjects are unique in this file, so one is enough to recognise a ticket
    // this script already wrote.
    if (await Ticket.exists({ subject: entry.subject })) continue;

    const raiser =
      entry.from === 'dummy' ? dummy : await User.findOne({ email: entry.from });
    if (!raiser) {
      console.log(`Skipped "${entry.subject}": no account for ${entry.from}`);
      continue;
    }

    const onBehalfOf = entry.onBehalfOf ? byName.get(entry.onBehalfOf) : null;

    let assignees = [];
    if (entry.assignDummy) {
      assignees = [dummy._id];
    } else if (entry.assignTo) {
      const person = await User.findOne({ email: entry.assignTo });
      if (person) assignees = [person._id];
    }

    const committed = entry.committedDays === undefined ? null : at(entry.committedDays);

    // Created through the model, one at a time: the ticket number comes from a
    // shared counter that only the save hook bumps.
    const ticket = await Ticket.create({
      subject: entry.subject,
      description: entry.description,
      priority: entry.priority,
      status: entry.status,
      department: department._id,
      raisedBy: raiser._id,
      raisedByRole: raiser.role,
      fromDepartments: onBehalfOf ? [onBehalfOf._id] : [],
      assignees,
      deadline: at(entry.dueDays),
      committedDeadline: committed,
      committedBy: committed ? (assignees[0] ?? null) : null,
      committedAt: committed ? at(-entry.agedDays) : null,
      project: entry.project ?? '',
    });

    // Backdate it. `timestamps: false` on the write, or mongoose would stamp
    // updatedAt with now and undo half of it.
    const raisedAt = at(-entry.agedDays);
    await Ticket.updateOne(
      { _id: ticket._id },
      { $set: { createdAt: raisedAt, updatedAt: raisedAt } },
      { timestamps: false },
    );

    counts.tickets += 1;
    console.log(`Created ${ticket.number} "${entry.subject}" -> ${entry.to}`);
  }

  console.log(
    `\nDone. ${counts.units} units, ${counts.departments} departments, ${counts.members} people, ` +
      `${counts.memberships} memberships for ${DUMMY_EMAIL}, ${counts.tickets} tickets.`,
  );
}

run()
  .catch((error) => {
    console.error('Seed failed:', error.message);
    process.exitCode = 1;
  })
  .finally(disconnectDatabase);
