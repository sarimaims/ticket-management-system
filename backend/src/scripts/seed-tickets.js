/**
 * Demo tickets, spread across every unit and department.
 *
 *   npm run seed:tickets
 *
 * Kept apart from `npm run seed`, which builds the org chart: that one is the
 * shape of the workspace and belongs in any environment, this one is content
 * to look at while testing and belongs in none of them.
 *
 * Idempotent on the subject line, so re-running it adds nothing. To start over:
 *
 *   npm run seed:tickets -- --reset
 *
 * which removes only what this script made - your own tickets are left alone.
 *
 * Everything it writes goes through the same rules the API enforces: a ticket
 * is raised on behalf of a department the raiser actually belongs to, and it
 * is assigned to somebody who is actually in the receiving department. The
 * script refuses a row that breaks either, rather than seeding data the app
 * would never have produced.
 */
import { connectDatabase, disconnectDatabase } from '../config/db.js';
import Department from '../models/Department.js';
import Message from '../models/Message.js';
import Ticket from '../models/Ticket.js';
import TicketAssignment from '../models/TicketAssignment.js';
import User from '../models/User.js';

const DAY = 24 * 60 * 60 * 1000;
const day = (offset) => new Date(Date.now() + offset * DAY);

/**
 * One row per ticket. `from` is the department it is raised on behalf of and
 * `by` must belong to it; `to` is the department being asked and `assignee`
 * must belong to that one.
 */
const TICKETS = [
  // --- into Head Office ---------------------------------------------------
  {
    to: 'IT Support',
    from: 'Reception',
    by: 'rabia.anwar@flowdesk.com',
    assignee: 'sana.yousaf@flowdesk.com',
    subject: 'Front desk PC freezes during check-in',
    description:
      'The check-in machine at the Dubai front desk locks up two or three times a morning, usually while a patient record is open. We lose the queue each time.',
    priority: 'High',
    status: 'In Progress',
    deadline: 4,
    committed: 5,
    messages: [
      ['raiser', 'It went again twice before 10am today. Anything you need from our side?'],
      ['assignee', 'Logs point at the record viewer. I am swapping the machine tomorrow morning.'],
      ['raiser', 'Before 8 would be ideal, that is when the rush starts.'],
    ],
  },
  {
    to: 'Human Resources',
    from: 'Nursing',
    by: 'saira.malik@flowdesk.com',
    assignee: 'hira.aslam@flowdesk.com',
    subject: 'Agency cover for two night shifts in October',
    description:
      'Two of the ward team are on leave from the 12th. We need agency cover for the night shifts or we drop below the minimum staffing ratio.',
    priority: 'Medium',
    status: 'Accepted',
    deadline: 9,
    committed: 8,
    messages: [['assignee', 'Two agencies have been asked for rates. I should have names by Thursday.']],
  },
  {
    to: 'Finance',
    from: 'Procurement',
    by: 'imran.baig@flowdesk.com',
    assignee: 'fatima.noor@flowdesk.com',
    subject: 'Approve the purchase order for reagent supplies',
    description:
      'PO 4471 covers the quarterly reagent order for both labs. It is above my approval limit and the supplier holds the price until month end.',
    priority: 'Critical',
    status: 'Waiting',
    deadline: 2,
    project: 'Q4 Lab Supplies',
    messages: [
      ['assignee', 'Waiting on the cost centre split before I can release it. Which site takes what share?'],
      ['raiser', 'Sixty Abu Dhabi, forty Dubai. Same as last quarter.'],
    ],
  },
  {
    to: 'Development',
    from: 'Digital Marketing',
    by: 'danish.raza@flowdesk.com',
    assignee: 'zeeshan.haider@flowdesk.com',
    subject: 'Campaign landing page is dropping form submissions',
    description:
      'The booking form on the October campaign page fails silently on mobile. Analytics shows starts but almost no completions since Tuesday.',
    priority: 'High',
    status: 'New',
    deadline: 3,
    project: 'October Campaign',
  },
  {
    to: 'Graphics & Design',
    from: 'Physiotherapy',
    by: 'omar.siddique@flowdesk.com',
    assignee: 'mehwish.ali@flowdesk.com',
    subject: 'Posters and signage for the rehab open day',
    description:
      'Six A2 posters and two pull-up banners for the open day. Same look as the spring set, with the new opening hours.',
    priority: 'Low',
    status: 'Completed',
    deadline: -3,
    committed: -4,
    messages: [
      ['assignee', 'Print files are with the printer, proofs came back clean.'],
      ['raiser', 'They arrived this morning, they look great. Thank you.'],
    ],
  },
  {
    to: 'Digital Marketing',
    from: 'Pharmacy',
    by: 'adnan.qureshi@flowdesk.com',
    assignee: 'intizar.shah@flowdesk.com',
    subject: 'Promote the winter vaccination drive',
    description:
      'We start the winter vaccination programme in three weeks and want it on the site and the mailing list before the first week of bookings.',
    priority: 'Medium',
    status: 'New',
    deadline: 12,
  },

  // --- into Dubai Clinic ---------------------------------------------------
  {
    to: 'Reception',
    from: 'Radiology',
    by: 'faisal.nadeem@flowdesk.com',
    assignee: 'noor.abbas@flowdesk.com',
    subject: 'Patients arriving without a scan referral',
    description:
      'Four patients this week arrived for imaging with no referral on file. Could the desk check the referral field before confirming the appointment?',
    priority: 'Medium',
    status: 'Accepted',
    deadline: 6,
    committed: 6,
    messages: [['assignee', 'Added to the check-in script. We will flag anything missing at booking.']],
  },
  {
    to: 'Nursing',
    from: 'Laboratory',
    by: 'tariq.mehmood@flowdesk.com',
    assignee: 'junaid.farooq@flowdesk.com',
    subject: 'Blood draw slots for the diabetes screening week',
    description:
      'We need twenty fasting draws a morning for the screening week. Can the ward hold two nurses for the 7 to 9 window?',
    priority: 'High',
    status: 'In Progress',
    deadline: 7,
    committed: 7,
    project: 'Diabetes Screening',
  },
  {
    to: 'Pharmacy',
    from: 'Nursing',
    by: 'saira.malik@flowdesk.com',
    assignee: 'maryam.iqbal@flowdesk.com',
    subject: 'Ward stock of paediatric antibiotics is low',
    description:
      'Down to two days of the paediatric suspensions on the ward. The last top-up did not come through.',
    priority: 'Critical',
    status: 'Waiting',
    deadline: 1,
    messages: [
      ['assignee', 'Supplier is out until Monday. I can move stock from Abu Dhabi if you need it sooner.'],
      ['raiser', 'Please do, we will not last to Monday.'],
    ],
  },

  // --- into Abu Dhabi Clinic -----------------------------------------------
  {
    to: 'Radiology',
    from: 'Reception',
    by: 'rabia.anwar@flowdesk.com',
    assignee: 'aliya.rehman@flowdesk.com',
    subject: 'MRI slot for a transferred patient',
    description:
      'Patient transferring from Dubai on Thursday needs an MRI the same day. Is there a slot in the afternoon list?',
    priority: 'High',
    status: 'New',
    deadline: 3,
  },
  {
    to: 'Physiotherapy',
    from: 'Human Resources',
    by: 'ayesha.khan@flowdesk.com',
    assignee: 'zainab.hussain@flowdesk.com',
    subject: 'Ergonomic assessment for the finance desks',
    description:
      'Two people in finance have reported back pain. Could someone assess the desk setup and recommend changes?',
    priority: 'Low',
    status: 'Accepted',
    deadline: 14,
    committed: 16,
    messages: [['assignee', 'I can come across on the 9th. Sixteenth for the written recommendations.']],
  },
  {
    to: 'Laboratory',
    from: 'Pharmacy',
    by: 'adnan.qureshi@flowdesk.com',
    assignee: 'saba.kausar@flowdesk.com',
    subject: 'Turnaround time on culture results',
    description:
      'Cultures are coming back in four to five days. Prescribing is waiting on them, so anything that brings it to three would help.',
    priority: 'Medium',
    status: 'In Progress',
    deadline: 10,
    committed: 12,
  },
  {
    to: 'Radiology',
    from: 'Nursing',
    by: 'junaid.farooq@flowdesk.com',
    assignee: 'faisal.nadeem@flowdesk.com',
    subject: 'Portable X-ray for the ward round',
    description:
      'The portable unit was not available for the Tuesday round. Can one be held for the ward between 8 and 10?',
    priority: 'Medium',
    status: 'Overdue',
    deadline: -4,
  },

  // --- into Supply Chain ---------------------------------------------------
  {
    to: 'Procurement',
    from: 'IT Support',
    by: 'bilal.ahmed@flowdesk.com',
    assignee: 'nida.sultan@flowdesk.com',
    subject: 'Twelve replacement laptops for the clinical teams',
    description:
      'The 2021 batch is out of warranty next month. Twelve replacements, same spec as the last order.',
    priority: 'High',
    status: 'Accepted',
    deadline: 20,
    committed: 18,
    project: 'Hardware Refresh',
    messages: [
      ['raiser', 'The T14 spec from last time is fine, no changes needed.'],
      ['assignee', 'Quotes are in from two resellers. I will have a recommendation on Monday.'],
    ],
  },
  {
    to: 'Logistics',
    from: 'Laboratory',
    by: 'tariq.mehmood@flowdesk.com',
    assignee: 'rida.nawaz@flowdesk.com',
    subject: 'Daily sample run between the two sites',
    description:
      'Samples are going across in taxis, which breaks the cold chain. We need a fixed daily run with a cool box.',
    priority: 'Critical',
    status: 'In Progress',
    deadline: 5,
    committed: 5,
    messages: [['assignee', 'Driver and cool box confirmed for a 2pm run. Starting Monday.']],
  },
  {
    to: 'Procurement',
    from: 'Graphics & Design',
    by: 'areeba.siddiqui@flowdesk.com',
    assignee: 'imran.baig@flowdesk.com',
    subject: 'Large format printer consumables',
    description: 'Ink set and two rolls of matte stock for the studio printer.',
    priority: 'Low',
    status: 'Completed',
    deadline: -6,
    committed: -7,
  },
  {
    to: 'Logistics',
    from: 'Reception',
    by: 'noor.abbas@flowdesk.com',
    assignee: 'kamran.aziz@flowdesk.com',
    subject: 'Courier for the patient records archive',
    description:
      'Eighteen boxes of closed records to go to off-site storage. They need a signed chain of custody.',
    priority: 'Medium',
    status: 'Overdue',
    deadline: -2,
  },
];

/**
 * A handover or two, so the History tab has something to show: the first
 * assignee passes it on, which is the ordinary life of a ticket.
 */
const HANDOVERS = [
  {
    subject: 'Front desk PC freezes during check-in',
    to: 'bilal.ahmed@flowdesk.com',
    by: 'sana.yousaf@flowdesk.com',
  },
  {
    subject: 'Twelve replacement laptops for the clinical teams',
    to: 'imran.baig@flowdesk.com',
    by: 'nida.sultan@flowdesk.com',
  },
];

async function reset() {
  const subjects = TICKETS.map((entry) => entry.subject);
  const made = await Ticket.find({ subject: { $in: subjects } }).select('_id number').lean();
  if (made.length === 0) {
    console.log('Nothing to reset.');
    return;
  }

  const ids = made.map((ticket) => ticket._id);
  await Message.deleteMany({ ticket: { $in: ids } });
  await TicketAssignment.deleteMany({ ticket: { $in: ids } });
  await Ticket.deleteMany({ _id: { $in: ids } });
  console.log(`Removed ${made.length} demo ticket(s) and everything hanging off them.`);
}

async function run() {
  await connectDatabase();

  if (process.argv.includes('--reset')) {
    await reset();
    await disconnectDatabase();
    return;
  }

  const departments = new Map(
    (await Department.find().select('name').lean()).map((item) => [item.name, item]),
  );
  const people = new Map(
    (await User.find().select('name email role memberships').lean()).map((item) => [
      item.email,
      item,
    ]),
  );

  /** Whether someone holds a membership in a department, by name. */
  const belongs = (person, departmentName) => {
    const department = departments.get(departmentName);
    if (!person || !department) return false;
    return (person.memberships ?? []).some(
      (membership) => String(membership.department) === String(department._id),
    );
  };

  let made = 0;
  let skipped = 0;

  for (const entry of TICKETS) {
    if (await Ticket.exists({ subject: entry.subject })) {
      skipped += 1;
      continue;
    }

    const to = departments.get(entry.to);
    const from = departments.get(entry.from);
    const raiser = people.get(entry.by);
    const assignee = people.get(entry.assignee);

    // The same three rules the API enforces. A row that breaks one is data the
    // app could never have produced, so it is reported rather than written.
    if (!to || !from || !raiser || !assignee) {
      console.warn(`Skipped "${entry.subject}": a department or person is missing.`);
      continue;
    }
    if (!belongs(raiser, entry.from)) {
      console.warn(`Skipped "${entry.subject}": ${raiser.name} is not in ${entry.from}.`);
      continue;
    }
    if (!belongs(assignee, entry.to)) {
      console.warn(`Skipped "${entry.subject}": ${assignee.name} is not in ${entry.to}.`);
      continue;
    }

    const committed = entry.committed !== undefined ? day(entry.committed) : null;

    const ticket = await Ticket.create({
      subject: entry.subject,
      description: entry.description,
      priority: entry.priority,
      status: entry.status,
      department: to._id,
      fromDepartments: [from._id],
      raisedBy: raiser._id,
      raisedByRole: raiser.role,
      assignees: [assignee._id],
      deadline: day(entry.deadline),
      committedDeadline: committed,
      committedBy: committed ? assignee._id : null,
      committedAt: committed ? day(entry.deadline - 1) : null,
      project: entry.project ?? '',
    });

    await TicketAssignment.create({
      ticket: ticket._id,
      from: [],
      to: [assignee._id],
      toNames: [assignee.name],
      by: raiser._id,
      byName: raiser.name,
      byRole: raiser.role,
      kind: 'raised',
    });

    for (const [side, body] of entry.messages ?? []) {
      const author = side === 'raiser' ? raiser : assignee;
      await Message.create({
        ticket: ticket._id,
        author: author._id,
        authorName: author.name,
        authorRole: author.role,
        side: side === 'raiser' ? 'raiser' : 'department',
        body,
      });
    }

    const count = (entry.messages ?? []).length;
    if (count > 0) {
      await Ticket.updateOne(
        { _id: ticket._id },
        { $set: { messageCount: count, lastMessageAt: new Date() } },
      );
    }

    made += 1;
    console.log(`Created ${ticket.number} ${entry.from} -> ${entry.to} (${entry.status})`);
  }

  // Handed on afterwards, so the trail reads the way a real one does.
  for (const move of HANDOVERS) {
    const ticket = await Ticket.findOne({ subject: move.subject });
    const to = people.get(move.to);
    const by = people.get(move.by);
    if (!ticket || !to || !by) continue;
    if ((ticket.assignees ?? []).some((id) => String(id) === String(to._id))) continue;

    const holders = await User.find({ _id: { $in: ticket.assignees ?? [] } })
      .select('name')
      .lean();

    await TicketAssignment.create({
      ticket: ticket._id,
      from: holders.map((person) => person._id),
      fromNames: holders.map((person) => person.name),
      to: [to._id],
      toNames: [to.name],
      by: by._id,
      byName: by.name,
      byRole: by.role,
      kind: 'reassigned',
    });

    await Ticket.updateOne({ _id: ticket._id }, { $set: { assignees: [to._id] } });
    console.log(
      `Handed ${ticket.number} from ${holders.map((p) => p.name).join(', ') || 'nobody'} to ${to.name}`,
    );
  }

  console.log(`\nDone. ${made} created, ${skipped} already there.`);
  await disconnectDatabase();
}

run().catch(async (error) => {
  console.error('Ticket seed failed:', error.message);
  await disconnectDatabase();
  process.exit(1);
});
