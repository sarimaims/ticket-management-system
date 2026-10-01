/**
 * Fills *today* with work, so the dashboard's Today panel has something to show:
 * tickets due today, conversation on tickets today, and today's activity feed.
 *
 *   node src/scripts/seed-today.js
 *
 * Today's data stops being today at midnight, so this is meant to be run again
 * on whichever day it is needed. Each run adds a fresh batch.
 *
 * Local databases only: it refuses to touch anything but localhost.
 */
import env from '../config/env.js';
import { connectDatabase, disconnectDatabase } from '../config/db.js';
import Activity from '../models/Activity.js';
import Department from '../models/Department.js';
import Message from '../models/Message.js';
import Ticket from '../models/Ticket.js';
import User from '../models/User.js';

const MINUTE = 60_000;

const TICKETS = [
  ['Website banner for the October campaign', 'The homepage banner still shows the summer offer. We need the October campaign artwork up before the weekend.', 'High'],
  ['Laptop not connecting to the clinic Wi-Fi', 'Since this morning my laptop drops off the network every few minutes. Other devices are fine.', 'Critical'],
  ['Payroll query for September', 'Two overtime entries are missing from my September payslip. Attaching the approved timesheet.', 'High'],
  ['Social media post for World Heart Day', 'Please prepare a post and a story for World Heart Day with the cardiology team photo.', 'Medium'],
  ['New joiner access - reception desk', 'A new receptionist starts Monday and needs access to the booking system and the shared inbox.', 'Medium'],
  ['Invoice approval for lab consumables', 'Vendor invoice for the lab consumables order needs sign-off so it can be paid this week.', 'High'],
  ['Fix broken link on the appointments page', 'The "Book now" button on the appointments page goes to a 404 on mobile.', 'Critical'],
  ['Brochure redesign - physiotherapy', 'The physiotherapy brochure needs the new price list and updated photos.', 'Low'],
  ['Expense reimbursement - conference travel', 'Submitting receipts for the Dubai conference travel; please process with this month\'s run.', 'Medium'],
  ['Printer on the second floor jammed', 'The shared printer near the nurses\' station keeps jamming and shows error 13.', 'Medium'],
  ['Landing page for the flu vaccine drive', 'We need a simple landing page with a booking form for the flu vaccine drive.', 'High'],
  ['Update staff directory photos', 'Several staff photos on the intranet directory are outdated or missing.', 'Low'],
];

const RAISER_LINES = [
  'Any update on this? It is needed by end of day.',
  'Thanks - attaching the details you asked for.',
  'Just checking this is still on track for today.',
  'Can we get a quick call on this before 4?',
  'Great, that works for us.',
];

const DEPARTMENT_LINES = [
  'Picked this up, working on it now.',
  'We have started - should be done this afternoon.',
  'Need one more detail from you before we can finish.',
  'Done on our side, please check and confirm.',
  'Looking into it, will update within the hour.',
];

/** Today's date as the frontend reads a deadline: midnight UTC of the local day. */
function dueToday(offsetDays = 0) {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + offsetDays));
}

/**
 * A moment today, before now: `fraction` of the way from midnight to now.
 * Everything lands earlier today, whatever time it is run.
 */
function earlierToday(fraction) {
  const now = Date.now();
  const midnight = new Date(new Date().toDateString()).getTime();
  return new Date(midnight + Math.min(Math.max(fraction, 0), 0.99) * (now - midnight));
}

const pick = (list, index) => list[index % list.length];

async function run() {
  if (!/\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(env.mongoUri)) {
    throw new Error(`Refusing to seed a non-local database (${env.mongoUri.replace(/\/\/[^@]*@/, '//***@')}).`);
  }

  await connectDatabase();

  const departments = await Department.find().select('name').lean();
  const users = await User.find({ status: { $ne: 'suspended' } }).lean();
  const superAdmin = users.find((user) => user.role === 'superadmin');

  // Who sits where: heads and team per department.
  const staff = new Map(departments.map((department) => [String(department._id), { heads: [], team: [] }]));
  for (const user of users) {
    for (const membership of user.memberships ?? []) {
      const entry = staff.get(String(membership.department));
      if (!entry) continue;
      (membership.role === 'head' ? entry.heads : entry.team).push(user);
    }
  }

  // Departments with somebody in them, the busiest first - the ones whose
  // heads are likely to be looking at the dashboard.
  const staffed = departments
    .map((department) => ({ department, ...staff.get(String(department._id)) }))
    .filter((entry) => entry.heads.length + entry.team.length > 0)
    .sort((a, b) => b.heads.length + b.team.length - (a.heads.length + a.team.length));

  if (staffed.length < 2) throw new Error('Need at least two departments with members.');

  // The work lands on the three busiest, so their heads' Today panels fill up
  // rather than every department getting one ticket each.
  const focus = staffed.slice(0, 3);

  const departmentOf = (user) => (user.memberships ?? [])[0]?.department ?? null;
  const nameOf = new Map(departments.map((department) => [String(department._id), department.name]));

  const created = [];

  for (const [index, [subject, description, priority]] of TICKETS.entries()) {
    const target = pick(focus, index);
    const source = pick(
      staffed.filter((entry) => entry !== target),
      index,
    );
    // Every fourth one comes from the super admin, the rest from a colleague
    // in another department.
    const raiser =
      index % 4 === 3 && superAdmin
        ? superAdmin
        : pick([...source.team, ...source.heads], index);
    const assignee = pick([...target.team, ...target.heads], index);
    const inProgress = index % 3 !== 0;

    const raisedAt = earlierToday(0.3 + (index / TICKETS.length) * 0.4);
    // Most are due today; a few were only raised today and are due later.
    const dueOffset = index % 5 === 4 ? 2 : 0;

    const ticket = await Ticket.create({
      subject,
      description,
      priority,
      status: inProgress ? 'In Progress' : 'New',
      department: target.department._id,
      departments: [target.department._id],
      raisedBy: raiser._id,
      raisedByRole: raiser.role,
      fromDepartments: raiser.role === 'user' && departmentOf(raiser) ? [departmentOf(raiser)] : [],
      assignees: inProgress ? [assignee._id] : [],
      deadline: dueToday(dueOffset),
      // Some carry a date the department promised, also today.
      committedDeadline: inProgress && index % 2 === 0 ? dueToday(dueOffset) : null,
      committedBy: inProgress && index % 2 === 0 ? assignee._id : null,
      committedAt: inProgress && index % 2 === 0 ? new Date(raisedAt.getTime() + 25 * MINUTE) : null,
    });

    await Ticket.updateOne(
      { _id: ticket._id },
      { $set: { createdAt: raisedAt, updatedAt: raisedAt } },
      { timestamps: false },
    );

    created.push({ ticket, raiser, assignee, target, raisedAt, inProgress });

    // The feed: raised, then picked up.
    const lines = [
      {
        department: target.department._id,
        departmentName: target.department.name,
        actor: raiser._id,
        actorName: raiser.name,
        actorRole: raiser.role,
        action: 'ticket.created',
        summary: inProgress
          ? `raised ${ticket.number} "${subject}" for ${assignee.name}`
          : `raised ${ticket.number} "${subject}"`,
        ticketNumber: ticket.number,
        createdAt: raisedAt,
      },
    ];
    if (inProgress) {
      lines.push({
        department: target.department._id,
        departmentName: target.department.name,
        actor: assignee._id,
        actorName: assignee.name,
        actorRole: assignee.role,
        action: 'ticket.updated',
        summary: `updated ${ticket.number}: status New → In Progress`,
        ticketNumber: ticket.number,
        createdAt: new Date(raisedAt.getTime() + 20 * MINUTE),
      });
    }
    await Activity.insertMany(lines.filter((line) => line.createdAt.getTime() < Date.now()));

    console.log(
      `${ticket.number}  ${subject}  ->  ${nameOf.get(String(target.department._id))}` +
        `  (by ${raiser.name}${inProgress ? `, on ${assignee.name}` : ''}, due ${dueOffset ? 'in 2 days' : 'today'})`,
    );
  }

  // Today's conversation: a few lines back and forth on most of them.
  let messages = 0;
  for (const [index, entry] of created.entries()) {
    if (index % 4 === 2) continue;
    const { ticket, raiser, assignee, target, raisedAt } = entry;
    const departmentVoice = assignee ?? target.heads[0] ?? target.team[0];
    const count = 2 + (index % 3);
    const docs = [];

    for (let turn = 0; turn < count; turn += 1) {
      const fromRaiser = turn % 2 === 1;
      const author = fromRaiser ? raiser : departmentVoice;
      const span = Date.now() - raisedAt.getTime();
      const at = new Date(raisedAt.getTime() + span * ((turn + 1) / (count + 1)));
      docs.push({
        ticket: ticket._id,
        author: author._id,
        authorName: author.name,
        authorRole: author.role,
        kind: 'text',
        side: fromRaiser ? 'raiser' : 'department',
        body: fromRaiser ? pick(RAISER_LINES, index + turn) : pick(DEPARTMENT_LINES, index + turn),
        createdAt: at,
        updatedAt: at,
      });
    }

    await Message.insertMany(docs);
    await Ticket.updateOne(
      { _id: ticket._id },
      { $inc: { messageCount: docs.length }, $set: { lastMessageAt: docs.at(-1).createdAt } },
      { timestamps: false },
    );
    messages += docs.length;
  }

  // One finished today, waiting on its raiser - so the feed has more than one kind of line.
  const done = created.find((entry) => entry.inProgress);
  if (done) {
    const at = earlierToday(0.95);
    await Ticket.updateOne(
      { _id: done.ticket._id },
      { $set: { status: 'Resolved', resolvedAt: at, approvalDueAt: new Date(at.getTime() + 48 * 60 * MINUTE) } },
      { timestamps: false },
    );
    await Activity.create({
      department: done.target.department._id,
      departmentName: done.target.department.name,
      actor: done.assignee._id,
      actorName: done.assignee.name,
      actorRole: done.assignee.role,
      action: 'ticket.resolved',
      summary: `resolved ${done.ticket.number} "${done.ticket.subject}" - waiting for ${done.raiser.name} to approve`,
      ticketNumber: done.ticket.number,
      createdAt: at,
    });
  }

  console.log(`\nDone. ${created.length} tickets, ${messages} messages, today's activity added.`);
}

run()
  .catch((error) => {
    console.error('Seed failed:', error.message);
    process.exitCode = 1;
  })
  .finally(disconnectDatabase);
