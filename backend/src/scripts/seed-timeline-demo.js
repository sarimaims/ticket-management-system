/**
 * Six demo tickets with long, realistic histories, each shared by two or three
 * departments and handled by several people - for checking how the ticket
 * sheet, the chat and the Timeline read when a lot has happened on one:
 *
 *   1  waiting on its 3rd approval: promised, extended, brought forward,
 *      withdrawn and promised again; sent back, approved, reopened, retitled;
 *      escalated and handled; handed over directly and by request
 *   2  completed by the 48-hour auto-approval, after being cancelled by
 *      mistake and reopened
 *   3  cancelled for good, after a declined handover request and two
 *      priority changes
 *   4  overdue, its promise missed, escalated twice - the second still open
 *   5  raised by the super admin, signed off first time, across three teams
 *   6  sent back twice, still in progress, with a handover request waiting
 *
 * Every line is written the way the server itself writes it - the thread's
 * system lines, the assignment and promise trails, handover requests, the
 * activity log - only with the times spread over the last twelve days. The
 * people are whoever is in the database: departments are matched by size and
 * people by order, heads first, so it works on any workspace with at least
 * two departments.
 *
 *   node src/scripts/seed-timeline-demo.js              dry run: who and what, writes nothing
 *   node src/scripts/seed-timeline-demo.js --apply      write the six tickets
 *   node src/scripts/seed-timeline-demo.js --remove     dry run of the clean-up
 *   node src/scripts/seed-timeline-demo.js --remove --apply
 *
 *   --live   required as well as --apply when the database is not on this machine
 *
 * Nobody is notified: no bell lines are written, and everybody involved is
 * marked as having seen the threads. Three things do behave like live data
 * afterwards: ticket 1 is waiting for approval, so 48 hours after this runs
 * the approval sweep completes it and tells the raiser; ticket 4's escalation
 * is open on the super admin's escalations page; ticket 6 has a handover
 * request waiting on the person it asks.
 *
 * The tickets carry MARKER in their description; --remove takes those and
 * every line hanging off them, and nothing else.
 */
import mongoose from 'mongoose';

import env from '../config/env.js';
import { connectDatabase, disconnectDatabase } from '../config/db.js';
import Activity from '../models/Activity.js';
import Department from '../models/Department.js';
import HandoverRequest from '../models/HandoverRequest.js';
import Message from '../models/Message.js';
import Notification from '../models/Notification.js';
import ThreadRead from '../models/ThreadRead.js';
import Ticket, { APPROVAL_WINDOW_MS, APPROVAL_WINDOW_TEXT } from '../models/Ticket.js';
import TicketAssignment from '../models/TicketAssignment.js';
import TicketCommitment from '../models/TicketCommitment.js';
import User from '../models/User.js';

const MARKER = '(Demo ticket for checking the timeline - safe to delete.)';
const PREFIX = '[Demo] ';
const MINUTE = 60_000;
const SLOTS = ['A', 'B', 'C'];

/** What the auto-approval signs as, the same as services/approval.js. */
const WORKSPACE = { _id: null, name: 'FlowDesk', role: 'user' };

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);

const local = /\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(env.mongoUri);
const where = local ? env.mongoUri : env.mongoUri.replace(/\/\/[^@]*@/, '//***@');

// --- time -------------------------------------------------------------------------

/** A wall-clock moment `daysAgo` days back, in this machine's time zone. */
function at(daysAgo, hhmm) {
  const [hours, minutes] = hhmm.split(':').map(Number);
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, hours, minutes);
}

/** `minutes` before now - for the lines that happened today. */
const ago = (minutes) => new Date(Date.now() - minutes * MINUTE);

/** A calendar day as the app stores one: midnight UTC of the local date. */
function day(offset) {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + offset));
}

const asDay = (value) => (value ? value.toISOString().slice(0, 10) : null);

/** The edit line a promise writes, worded as the server words it. */
const promise = {
  first: (date, reason) => ({
    body: `promised to finish by ${asDay(date)} - ${reason}`,
    commit: { date, reason },
  }),
  move: (from, to, reason) => ({
    body: `moved the promised date from ${asDay(from)} to ${asDay(to)} - ${reason}`,
    commit: { date: to, previous: from, reason },
  }),
  withdraw: (from, reason) => ({
    body: `withdrew the promised date - ${reason}`,
    commit: { date: null, previous: from, reason },
  }),
};

// --- the stories --------------------------------------------------------------------
//
// People are named by slot: "R" raised it, "boss" is the super admin, and "A0"
// is the first person of the ticket's first department, "B1" the second of its
// second, and so on. A small department lends the same person again; a step that
// would then change nothing (a handover to the person already holding it) is
// left out. "{A0}" in a line is that person's name, "@{A0}" mentions them, and
// "{A}" is the name of the ticket's first department.

const STORIES = [
  {
    key: 1,
    raiser: 'team',
    departments: 3,
    subject: 'New starter setup - laptop, accounts and payroll',
    finalSubject: 'New starter setup - laptop, accounts, payroll and Office licence',
    description:
      'A new developer joins on Sunday. {A}: laptop (16 GB RAM minimum), docking station and two monitors. {B}: email, VPN and the HR portal. {C}: add him to payroll from this month.',
    finalDescription:
      'A new developer joins on Sunday. {A}: laptop (16 GB RAM minimum, 512 GB SSD), docking station with charger, two 24" monitors and an Office licence. {B}: email, VPN and the HR portal. {C}: add him to payroll from this month. Desk 3.14, third floor.',
    requestType: 'Onboarding',
    priority: 'Medium',
    deadline: -5,
    steps: () => {
      const [p1, p2, p3, p4] = [day(-6), day(-2), day(-4), day(1)];
      return [
        { at: at(12, '09:12'), kind: 'raised', to: ['A0', 'B0', 'C0'] },
        { at: at(12, '09:14'), kind: 'say', by: 'R', body: 'Hi all - details are in the description. He starts Sunday, so anything before then helps.' },
        { at: at(12, '09:41'), kind: 'say', by: 'A0', body: 'Got it. Checking laptop stock with the vendor and I will come back with a date.' },
        { at: at(12, '09:55'), kind: 'say', by: 'B0', body: 'I will set up email and VPN as soon as HR sends his details.' },
        { at: at(12, '10:05'), kind: 'edit', by: 'A0', status: 'In Progress', ...promise.first(p1, 'The vendor delivers laptops within five working days.') },
        { at: at(12, '11:30'), kind: 'say', by: 'C0', id: 'ask-docs', body: 'Payroll needs his contract and bank letter. @{R} can you send them?' },
        { at: at(12, '11:45'), kind: 'say', by: 'R', reply: 'ask-docs', body: 'Sent to your email just now.' },
        { at: at(11, '14:30'), kind: 'edit', by: 'R', body: 'priority Medium -> High, description edited' },
        { at: at(11, '15:02'), kind: 'say', by: 'A0', body: 'The vendor has the laptops in stock, delivery on Thursday.', edited: { at: at(11, '15:06'), was: 'The vendor has the laptops in stock, delivery on Thrusday.' } },
        { at: at(10, '11:20'), kind: 'hand', by: 'A0', dept: 'A', to: ['A0', 'A1'] },
        { at: at(10, '11:26'), kind: 'say', by: 'A1', body: 'Joining on this one - I will take the docking station and the monitors.' },
        { at: at(10, '16:00'), kind: 'ask', by: 'B0', to: ['B1'], note: 'I am on leave from tomorrow - can you finish our part?', answer: { at: at(10, '17:10'), outcome: 'accepted' } },
        { at: at(9, '16:40'), kind: 'say', by: 'R', body: 'Two days without an update and he starts on Sunday. Escalating so it does not slip.' },
        { at: at(9, '16:45'), kind: 'escalate', by: 'R', reason: 'No update for two days and the new starter joins on Sunday.' },
        { at: at(9, '18:10'), kind: 'handle', note: 'Spoke to the team: the vendor delay is real. A new date is agreed below.' },
        { at: at(9, '18:20'), kind: 'edit', by: 'A1', ...promise.move(p1, p2, 'The vendor moved the delivery; the docking stations ship separately.') },
        { at: at(8, '10:00'), kind: 'edit', by: 'R', body: `requested deadline set to ${asDay(day(3))}`, deadline: day(3) },
        { at: at(8, '12:00'), kind: 'say', by: 'B1', body: 'Email, VPN and HR portal are ready. Login details are with HR.' },
        { at: at(7, '13:15'), kind: 'resolve', by: 'A1' },
        { at: at(7, '13:16'), kind: 'say', by: 'A1', body: 'Laptop and monitors are set up at the desk. Please check and approve.' },
        { at: at(7, '17:40'), kind: 'reject', reason: 'The laptop came without the docking station and the charger.' },
        { at: at(6, '09:30'), kind: 'say', by: 'R', body: 'Can you also order a second charger for home?', withdrawn: at(6, '09:32') },
        { at: at(5, '12:00'), kind: 'hand', by: 'A1', dept: 'A', to: ['A2'] },
        { at: at(5, '12:30'), kind: 'edit', by: 'A2', ...promise.move(p2, p3, 'The docking stations arrived early; setting it up today.') },
        { at: at(4, '15:20'), kind: 'resolve', by: 'A2' },
        { at: at(4, '19:05'), kind: 'approve' },
        { at: at(3, '10:10'), kind: 'edit', by: 'R', status: 'In Progress', body: 'priority High -> Critical' },
        { at: at(3, '10:11'), kind: 'say', by: 'R', body: 'Reopening - Office asks for a licence key every time it starts.' },
        { at: at(3, '11:00'), kind: 'edit', by: 'A2', ...promise.withdraw(p3, 'Waiting for the licence key from Microsoft; no date until it arrives.') },
        { at: at(2, '09:00'), kind: 'edit', by: 'R', retitle: true, body: 'subject changed to "{subject}", project set to Onboarding 2026' },
        { at: at(2, '14:00'), kind: 'edit', by: 'A2', ...promise.first(p4, 'Licence key received; installing it tomorrow morning.') },
        { at: at(2, '14:05'), kind: 'say', by: 'A2', body: 'Licence key is in. I will install it first thing tomorrow.' },
        { at: at(2, '16:30'), kind: 'say', by: 'C0', body: 'Payroll is set up from this month. Nothing else needed from {C}.' },
        { at: ago(160), kind: 'resolve', by: 'A2' },
        { at: ago(158), kind: 'say', by: 'A2', body: 'Office is activated and the laptop is ready at the desk.' },
        { at: ago(115), kind: 'say', by: 'R', body: 'Thanks - I will check it with him this afternoon.' },
      ];
    },
  },
  {
    key: 2,
    raiser: 'head',
    departments: 2,
    subject: 'Shared drive access for the external auditors',
    description:
      'The external auditors need read access to the Audit 2026 folder for two weeks, and guest accounts for three people. Names are below.\n\nAisha Rahman, Daniel Cho, Priya Menon.',
    requestType: 'Access',
    priority: 'High',
    deadline: -5,
    steps: () => {
      const p1 = day(-6);
      return [
        { at: at(10, '10:00'), kind: 'raised', to: ['A0', 'B0'] },
        { at: at(10, '10:05'), kind: 'say', by: 'R', body: 'The auditors arrive on Monday, so this needs to be ready by Sunday evening.' },
        { at: at(10, '10:30'), kind: 'edit', by: 'A0', status: 'In Progress' },
        { at: at(10, '10:45'), kind: 'say', by: 'B0', id: 'names', body: 'I need the auditors’ names to create their guest accounts.' },
        { at: at(10, '11:00'), kind: 'say', by: 'R', reply: 'names', body: '@{B0} the names are at the bottom of the description.' },
        { at: at(9, '09:15'), kind: 'edit', by: 'R', cancel: 'Raised twice by mistake.' },
        { at: at(9, '11:40'), kind: 'edit', by: 'R', status: 'In Progress' },
        { at: at(9, '11:41'), kind: 'say', by: 'R', body: 'Sorry - this one is needed after all. The other request was for a different folder.' },
        { at: at(8, '09:00'), kind: 'edit', by: 'A0', ...promise.first(p1, 'The guest accounts have to be approved before the folder can be shared.') },
        { at: at(8, '09:30'), kind: 'hand', by: 'B0', dept: 'B', to: ['B0', 'B1'] },
        { at: at(8, '15:00'), kind: 'say', by: 'B1', body: 'Guest accounts are created; passwords went out by SMS.' },
        { at: at(7, '16:00'), kind: 'resolve', by: 'A0' },
        { at: at(7, '16:02'), kind: 'say', by: 'A0', body: 'Access is set up until the end of the month. Please confirm it works.' },
        // 48 hours on, nobody had answered.
        { at: at(5, '16:05'), kind: 'auto' },
      ];
    },
  },
  {
    key: 3,
    raiser: 'team',
    departments: 2,
    subject: 'Replace the meeting room projector',
    description: 'The projector in meeting room 2 flickers and switches itself off after ten minutes. We have the board presentation there next week.',
    requestType: 'Facilities',
    priority: 'Low',
    deadline: 4,
    steps: () => [
      { at: at(6, '13:00'), kind: 'raised', to: ['A0', 'B0'] },
      { at: at(6, '13:05'), kind: 'say', by: 'R', body: 'It started last week and is getting worse.' },
      { at: at(6, '13:20'), kind: 'edit', by: 'R', body: 'priority Low -> Medium' },
      { at: at(6, '14:00'), kind: 'ask', by: 'A0', to: ['A1'], note: 'Can you take this? I am on site all week.', answer: { at: at(6, '15:10'), outcome: 'declined' } },
      { at: at(5, '10:00'), kind: 'hand', by: 'A0', dept: 'A', to: ['A2'] },
      { at: at(5, '10:30'), kind: 'edit', by: 'A2', status: 'In Progress' },
      { at: at(5, '10:32'), kind: 'say', by: 'A2', body: 'Looking at it this afternoon.' },
      { at: at(5, '16:00'), kind: 'say', by: 'B0', body: '{B} can approve a replacement up to AED 3,000 if it comes to that.' },
      { at: at(4, '09:00'), kind: 'edit', by: 'A2', ...promise.first(day(1), 'A replacement lamp is on order.') },
      { at: at(4, '11:00'), kind: 'edit', by: 'R', body: 'priority Medium -> High' },
      { at: at(3, '15:00'), kind: 'say', by: 'R', body: 'Facilities say the projector is still under its warranty.' },
      { at: at(3, '15:05'), kind: 'edit', by: 'R', cancel: 'Facilities are replacing it under the warranty instead.' },
      { at: at(3, '15:20'), kind: 'say', by: 'A2', body: 'Makes sense - closing it on our side.' },
    ],
  },
  {
    key: 4,
    raiser: 'head',
    departments: 3,
    subject: 'Network outage on the third floor',
    description:
      'Since this morning nobody on the third floor can reach the network - wired or Wi-Fi. Clinics on that floor are working on paper.',
    requestType: 'Incident',
    priority: 'Critical',
    deadline: -2,
    steps: () => {
      const [p1, p2] = [day(-6), day(-3)];
      return [
        { at: at(8, '08:05'), kind: 'raised', to: ['A0', 'B0', 'C0'] },
        { at: at(8, '08:06'), kind: 'say', by: 'R', body: 'Nothing on the third floor connects. Please treat this as urgent.' },
        { at: at(8, '08:20'), kind: 'edit', by: 'A0', status: 'In Progress' },
        { at: at(8, '08:40'), kind: 'say', by: 'A0', body: 'The switch in the comms room is down. Replacing it with the spare.' },
        { at: at(8, '09:10'), kind: 'edit', by: 'A0', ...promise.first(p1, 'A spare switch is on site.') },
        { at: at(8, '13:00'), kind: 'say', by: 'C0', body: 'The purchase order for a new switch is approved, in case the spare fails.' },
        { at: at(7, '10:00'), kind: 'hand', by: 'A0', dept: 'A', to: ['A0', 'A1'] },
        { at: at(7, '17:00'), kind: 'edit', by: 'A1', ...promise.move(p1, p2, 'The spare switch was faulty; a new one is on order.') },
        { at: at(6, '09:00'), kind: 'escalate', by: 'R', reason: 'The third floor has been offline for two days; clinics are on paper.' },
        { at: at(6, '11:30'), kind: 'handle', note: 'Spoke to the vendor: a replacement switch arrives in three days.' },
        { at: at(5, '10:00'), kind: 'say', by: 'B0', body: 'Temporary hotspot is up in the third-floor meeting room.' },
        { at: at(4, '14:00'), kind: 'ask', by: 'A1', to: ['A2'], note: 'Please take this over - I am on the data centre move.', answer: { at: at(4, '14:40'), outcome: 'accepted' } },
        { at: at(3, '18:00'), kind: 'say', by: 'A2', body: 'The new switch arrived but needs a firmware update from the vendor.' },
        { at: at(2, '09:15'), kind: 'say', by: 'R', body: 'Our deadline is today. Where are we?' },
        { at: at(1, '10:00'), kind: 'escalate', by: 'R', reason: 'Still offline after a week, and the promised date has passed.' },
        { at: at(1, '10:05'), kind: 'say', by: 'A2', body: 'Waiting on the vendor’s engineer, booked for tomorrow morning.' },
        { at: ago(300), kind: 'say', by: 'B1', body: 'The vendor’s engineer is on site now.' },
      ];
    },
  },
  {
    key: 5,
    raiser: 'boss',
    departments: 3,
    subject: 'Annual budget pack for the board',
    description:
      'The board meets on the 1st. {A}: the budget summary. {B}: system and licence costs for next year. {C}: the infrastructure plan with costs.',
    requestType: 'Report',
    priority: 'High',
    deadline: -2,
    steps: () => [
      { at: at(11, '09:00'), kind: 'raised', to: ['A0', 'B0', 'C0'] },
      { at: at(11, '09:02'), kind: 'say', by: 'R', body: 'One pack please, not three. {A} to pull it together.' },
      { at: at(11, '10:00'), kind: 'edit', by: 'A0', status: 'In Progress', ...promise.first(day(-4), 'Three days for the numbers, two to put the pack together.') },
      { at: at(11, '10:30'), kind: 'say', by: 'B0', body: 'We will pull the system and licence costs.' },
      { at: at(10, '14:00'), kind: 'say', by: 'C0', body: 'The infrastructure plan will be with you by Thursday.' },
      { at: at(9, '11:00'), kind: 'hand', by: 'A0', dept: 'A', to: ['A0', 'A1'] },
      { at: at(9, '11:30'), kind: 'say', by: 'A1', id: 'licences', body: '@{B0} can you send the licence renewal figures?' },
      { at: at(9, '12:10'), kind: 'say', by: 'B0', reply: 'licences', body: 'Sent - 14 licences renew in January.' },
      { at: at(8, '09:00'), kind: 'edit', by: 'R', body: 'priority High -> Critical' },
      { at: at(7, '15:00'), kind: 'hand', by: 'B0', dept: 'B', to: ['B1'] },
      { at: at(7, '15:30'), kind: 'say', by: 'B1', body: 'Picked this up - the cost sheet is in the shared folder.' },
      { at: at(6, '10:00'), kind: 'edit', by: 'A1', ...promise.move(day(-4), day(-5), 'The numbers came in early.') },
      { at: at(5, '17:30'), kind: 'resolve', by: 'A1' },
      { at: at(5, '17:32'), kind: 'say', by: 'A1', body: 'The pack is ready for review.' },
      { at: at(4, '09:00'), kind: 'approve' },
      { at: at(4, '09:05'), kind: 'say', by: 'R', body: 'Thank you all - clear and on time.' },
    ],
  },
  {
    key: 6,
    raiser: 'team',
    departments: 2,
    subject: 'Patient portal password reset not working',
    description:
      'Patients who reset their password on the portal never get the email, or the link says it has expired. Front desk has had 20 calls about it this week.',
    requestType: 'Bug',
    priority: 'High',
    deadline: 2,
    steps: () => {
      const [p1, p2, p3] = [day(-2), day(0), day(1)];
      return [
        { at: at(5, '09:00'), kind: 'raised', to: ['A0', 'A1', 'B0'] },
        { at: at(5, '09:05'), kind: 'say', by: 'R', body: 'Screenshots of the error are with the front desk if you need them.' },
        { at: at(5, '09:30'), kind: 'edit', by: 'A0', status: 'In Progress', ...promise.first(p1, 'The fix needs a release.') },
        { at: at(5, '10:00'), kind: 'say', by: 'A1', body: 'Reproduced - the reset link is built with the wrong expiry.' },
        { at: at(4, '15:00'), kind: 'resolve', by: 'A0' },
        { at: at(4, '15:02'), kind: 'say', by: 'A0', body: 'The fix is live.' },
        { at: at(4, '16:20'), kind: 'reject', reason: 'Still failing on iPhone Safari.' },
        { at: at(3, '11:00'), kind: 'say', by: 'B0', body: 'The logs show the token expiring early on Safari only.' },
        { at: at(3, '12:00'), kind: 'edit', by: 'A1', ...promise.move(p1, p2, 'Safari needs a separate fix.') },
        { at: at(2, '14:00'), kind: 'resolve', by: 'A1' },
        { at: at(2, '18:00'), kind: 'reject', reason: 'Safari works now, but the reset email lands in spam.' },
        { at: at(1, '10:00'), kind: 'hand', by: 'B0', dept: 'B', to: ['B0', 'B1'] },
        { at: at(1, '10:30'), kind: 'say', by: 'B1', body: 'The spam issue is our mail server’s SPF record. Fixing it today.' },
        { at: at(1, '11:00'), kind: 'edit', by: 'A1', ...promise.move(p2, p3, 'Waiting for the SPF change to spread.') },
        { at: ago(240), kind: 'ask', by: 'A0', to: ['A2'], note: 'I am on another release today - can you watch this one?' },
        { at: ago(200), kind: 'say', by: 'R', id: 'news', body: '@{A1} any news?' },
        { at: ago(90), kind: 'say', by: 'A1', reply: 'news', body: 'SPF record is updated; checking again in an hour.' },
      ];
    },
  },
];

// --- who --------------------------------------------------------------------------

const membership = (user, departmentId) =>
  (user.memberships ?? []).find((m) => String(m.department) === String(departmentId));

/**
 * Who plays each part. Raisers take turns so the six tickets come from
 * different people; each ticket goes to the departments
 * with the most people to work it first - their own included, when somebody
 * else there can pick it up.
 */
async function pickCast() {
  const people = await User.find({ status: 'active' }).select('name email role memberships').lean();
  const departments = await Department.find({ isActive: { $ne: false } }).select('name').lean();
  const byId = new Map(departments.map((d) => [String(d._id), d]));

  const boss = people.find((p) => p.role === 'superadmin') ?? people.find((p) => p.role === 'admin');
  if (!boss) throw new Error('No super admin or admin to handle escalations.');

  const members = (d) => people.filter((p) => membership(p, d._id));
  const sized = departments.filter((d) => members(d).length > 0).sort((a, b) => members(b).length - members(a).length);
  if (sized.length < 2) throw new Error('The demo needs at least two departments with people in them.');

  const workers = people.filter((p) => p.role === 'user' && p.memberships?.length > 0);
  const isHead = (p) => p.memberships.some((m) => m.role === 'head');
  const used = new Map();

  return STORIES.map((story) => {
    let raiser = boss;
    if (story.raiser !== 'boss') {
      // The least used first; a head or a team member as the story asks, when there is one.
      const pool = [...workers].sort(
        (a, b) =>
          (used.get(String(a._id)) ?? 0) - (used.get(String(b._id)) ?? 0) ||
          Number(isHead(a) !== (story.raiser === 'head')) - Number(isHead(b) !== (story.raiser === 'head')),
      );
      raiser = pool[0];
      if (!raiser) throw new Error('Nobody in a department to raise the tickets.');
      used.set(String(raiser._id), (used.get(String(raiser._id)) ?? 0) + 1);
    }

    const crewOf = (d) =>
      members(d)
        .filter((p) => String(p._id) !== String(raiser._id))
        .sort((a, b) => Number(membership(a, d._id).role !== 'head') - Number(membership(b, d._id).role !== 'head') || a.name.localeCompare(b.name));
    // The department doing most of the work leads, so the handovers have
    // people to move between; the raiser's own comes after an equal other.
    const theirs = (d) => Boolean(membership(raiser, d._id));
    const targets = sized
      .filter((d) => crewOf(d).length > 0)
      .sort((a, b) => crewOf(b).length - crewOf(a).length || Number(theirs(a)) - Number(theirs(b)))
      .slice(0, story.departments);

    return {
      story,
      raiser,
      boss,
      from: (raiser.memberships ?? []).map((m) => byId.get(String(m.department))).filter(Boolean),
      slots: targets.map((d) => ({ department: d, crew: crewOf(d) })),
    };
  });
}

/** "A1" -> the second person of the first department; "R" and "boss" as they say. */
function resolver(cast) {
  return (ref) => {
    if (ref === 'R') return cast.raiser;
    if (ref === 'boss') return cast.boss;
    const slot = cast.slots[SLOTS.indexOf(ref[0]) % cast.slots.length];
    return slot.crew[Number(ref.slice(1)) % slot.crew.length];
  };
}

/** The slot a person is held in for this ticket - by reference, so a person in two departments stays put. */
const slotOf = (cast, ref) => SLOTS.indexOf(ref[0]) % cast.slots.length;

// --- writing ----------------------------------------------------------------------

const idOf = (person) => String(person._id);
const names = (people) => people.map((p) => p.name).join(', ');
const unique = (people) => [...new Map(people.map((p) => [idOf(p), p])).values()];

/** Saves a document exactly as given, timestamps included. */
const keep = (Model, doc) => new Model(doc).save({ timestamps: false });

async function write(cast) {
  const { story, raiser: R, boss } = cast;
  const who = resolver(cast);
  const steps = story.steps();
  const raisedAt = steps[0].at;
  const fill = (text) =>
    text
      .replace(/\{(R|boss|[ABC]\d)\}/g, (_, ref) => who(ref).name)
      .replace(/\{([ABC])\}/g, (_, ref) => cast.slots[SLOTS.indexOf(ref) % cast.slots.length].department.name)
      .replace('{subject}', PREFIX + story.finalSubject);

  // Who holds it, department by department.
  const holders = cast.slots.map(() => []);
  for (const ref of steps[0].to) {
    const slot = holders[slotOf(cast, ref)];
    if (!slot.some((p) => idOf(p) === idOf(who(ref)))) slot.push(who(ref));
  }
  const everyone = () => unique(holders.flat());

  const ticket = new Ticket({
    subject: PREFIX + story.subject,
    description: `${fill(story.description)}\n\n${MARKER}`,
    requestType: story.requestType,
    priority: story.priority,
    status: 'New',
    department: cast.slots[0].department._id,
    departments: cast.slots.map((s) => s.department._id),
    raisedBy: R._id,
    fromDepartments: cast.from.map((d) => d._id),
    raisedByRole: R.role,
    assignees: everyone().map((p) => p._id),
    deadline: day(story.deadline),
    createdAt: raisedAt,
    updatedAt: raisedAt,
  });
  await ticket.save({ timestamps: false });

  const number = ticket.number;
  const lead = cast.slots[0].department;
  const side = (person) => (idOf(person) === idOf(R) ? 'raiser' : 'department');
  const system = (when, actor, event, body, sideOf = 'department') =>
    keep(Message, {
      ticket: ticket._id,
      kind: 'system',
      event,
      author: actor._id ?? null,
      authorName: actor.name,
      authorRole: actor.role ?? 'user',
      side: sideOf,
      body,
      createdAt: when,
      updatedAt: when,
    });
  const log = (when, actor, action, summary) =>
    keep(Activity, {
      department: lead._id,
      departmentName: lead.name,
      actor: actor._id ?? null,
      actorName: actor.name,
      actorRole: actor.role ?? 'user',
      action,
      summary,
      ticketNumber: number,
      createdAt: when,
    });
  const trail = (when, actor, from, to, kind = 'reassigned') =>
    keep(TicketAssignment, {
      ticket: ticket._id,
      from: from.map((p) => p._id),
      fromNames: from.map((p) => p.name),
      to: to.map((p) => p._id),
      toNames: to.map((p) => p.name),
      by: actor._id,
      byName: actor.name,
      byRole: actor.role,
      kind,
      createdAt: when,
    });

  let messages = 0;
  let lastMessageAt = null;
  let written = 0;
  const said = new Map();
  const seen = new Map([[idOf(R), R]]);

  for (const step of steps) {
    const when = step.at;
    const by = step.by ? who(step.by) : null;
    if (by) seen.set(idOf(by), by);

    switch (step.kind) {
      case 'raised': {
        const to = everyone();
        const list = cast.slots.map((s) => s.department.name);
        const toWhere = list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list.at(-1)}` : list[0];
        await trail(when, R, [], to, 'raised');
        await system(when, R, 'raised', `raised this ticket to ${toWhere}`, 'raiser');
        await log(when, R, 'ticket.created', `raised ${number} "${ticket.subject}" for ${names(to)}`);
        break;
      }

      case 'say': {
        const body = fill(step.body);
        const mentions = [...step.body.matchAll(/@\{(R|boss|[ABC]\d)\}/g)].map(([, ref]) => ({
          user: who(ref)._id,
          name: who(ref).name,
        }));
        const doc = {
          ticket: ticket._id,
          kind: 'text',
          author: by._id,
          authorName: by.name,
          authorRole: by.role,
          side: side(by),
          body,
          mentions,
          replyTo: step.reply ? said.get(step.reply) : null,
          createdAt: when,
          updatedAt: when,
        };
        if (step.edited) {
          doc.editedAt = step.edited.at;
          doc.revisions = [{ body: step.edited.was, replacedAt: step.edited.at }];
          doc.updatedAt = step.edited.at;
        }
        if (step.withdrawn) {
          doc.deletedAt = step.withdrawn;
          doc.deletedBy = by._id;
          doc.deletedByName = by.name;
          doc.updatedAt = step.withdrawn;
        } else {
          messages += 1;
        }
        lastMessageAt = when;
        const message = await keep(Message, doc);
        if (step.id) said.set(step.id, message._id);
        if (step.edited) await log(step.edited.at, by, 'message.edited', `edited a message on ${number}`);
        if (step.withdrawn) await log(step.withdrawn, by, 'message.deleted', `deleted a message on ${number}`);
        break;
      }

      case 'edit': {
        // Status first, then the rest, as one save writes them.
        const parts = [];
        if (step.cancel) {
          parts.push(`cancelled the ticket - ${step.cancel}`);
          ticket.status = 'Cancelled';
          ticket.cancelReason = step.cancel;
          ticket.cancelledByName = by.name;
          ticket.cancelledAt = when;
          ticket.approvalDueAt = null;
        } else if (step.status) {
          parts.push(`status ${ticket.status} -> ${step.status}`);
          if (ticket.status === 'Cancelled') {
            ticket.cancelReason = '';
            ticket.cancelledByName = '';
            ticket.cancelledAt = null;
          }
          if (ticket.status === 'Completed') {
            ticket.completedAt = null;
            ticket.approvedByName = '';
          }
          ticket.status = step.status;
        }
        if (step.body) {
          const body = fill(step.body);
          parts.push(body);
          const priority = body.match(/priority \w+ -> (\w+)/);
          if (priority) ticket.priority = priority[1];
          if (/description edited/.test(body) && story.finalDescription) {
            ticket.description = `${fill(story.finalDescription)}\n\n${MARKER}`;
          }
        }
        if (step.deadline) ticket.deadline = step.deadline;
        if (step.retitle) {
          ticket.subject = PREFIX + story.finalSubject;
          ticket.project = 'Onboarding 2026';
        }
        if (step.commit) {
          const { date, previous = null, reason } = step.commit;
          await keep(TicketCommitment, {
            ticket: ticket._id,
            date,
            previousDate: previous,
            kind: !date ? 'withdrawn' : !previous ? 'promised' : date > previous ? 'extended' : 'pulled-in',
            reason,
            by: by._id,
            byName: by.name,
            byRole: by.role,
            createdAt: when,
          });
          ticket.committedDeadline = date;
          ticket.committedReason = date ? reason : '';
          ticket.committedBy = date ? by._id : null;
          ticket.committedAt = date ? when : null;
        }
        const body = parts.join(', ');
        await system(when, by, 'edited', body, side(by));
        await log(when, by, 'ticket.updated', `updated ${number}: ${body}`);
        break;
      }

      case 'hand': {
        const slot = slotOf(cast, step.dept);
        const before = everyone();
        const previous = holders[slot];
        holders[slot] = unique(step.to.map(who));
        const after = everyone();
        // A small department handing to the person already holding it: nothing moved.
        if (before.map(idOf).sort().join() === after.map(idOf).sort().join()) {
          holders[slot] = previous;
          continue;
        }
        ticket.assignees = after.map((p) => p._id);
        await trail(when, by, before, after);
        await system(when, by, 'assignment', `handed this to ${names(after)}`);
        await log(when, by, 'ticket.updated', `updated ${number}: assigned to ${names(after)}`);
        break;
      }

      case 'ask': {
        const asked = unique(step.to.map(who)).filter((p) => idOf(p) !== idOf(by));
        if (asked.length === 0) continue;
        const outcome = step.answer?.outcome ?? 'pending';
        const answerer = asked[0];
        const decided = step.answer?.at ?? null;
        await keep(HandoverRequest, {
          ticket: ticket._id,
          requestedBy: by._id,
          requestedByName: by.name,
          to: asked.map((p) => p._id),
          toNames: asked.map((p) => p.name),
          note: step.note,
          status: outcome,
          decidedBy: decided ? answerer._id : null,
          decidedByName: decided ? answerer.name : '',
          decidedAt: decided,
          declinedBy: outcome === 'declined' ? [answerer._id] : [],
          createdAt: when,
          updatedAt: decided ?? when,
        });
        await system(when, by, 'assignment', `asked ${names(asked)} to take this on`);
        if (outcome === 'declined') {
          seen.set(idOf(answerer), answerer);
          await system(decided, answerer, 'assignment', `turned down ${by.name}'s request to take this on`);
        }
        if (outcome === 'accepted') {
          seen.set(idOf(answerer), answerer);
          const before = everyone();
          const slot = slotOf(cast, step.by);
          holders[slot] = unique([...holders[slot].filter((p) => idOf(p) !== idOf(by)), answerer]);
          const after = everyone();
          ticket.assignees = after.map((p) => p._id);
          await trail(decided, answerer, before, after);
          await system(decided, answerer, 'assignment', `took this on from ${by.name}`);
          await log(decided, answerer, 'ticket.updated', `updated ${number}: assigned to ${names(after)}`);
        }
        break;
      }

      case 'resolve':
        ticket.status = 'Resolved';
        ticket.resolvedAt = when;
        ticket.resolvedBy = by._id;
        ticket.resolvedByName = by.name;
        ticket.approvalDueAt = new Date(when.getTime() + APPROVAL_WINDOW_MS);
        ticket.rejectedReason = '';
        ticket.rejectedByName = '';
        ticket.rejectedAt = null;
        ticket.approvedByName = '';
        await system(when, by, 'resolved', `marked this resolved - waiting for ${R.name} to approve`);
        await log(when, by, 'ticket.resolved', `resolved ${number} "${ticket.subject}" - waiting for ${R.name} to approve`);
        break;

      case 'reject':
        ticket.status = 'In Progress';
        ticket.rejectedReason = step.reason;
        ticket.rejectedByName = R.name;
        ticket.rejectedAt = when;
        ticket.approvalDueAt = null;
        await system(when, R, 'rejected', `sent it back - ${step.reason}`, 'raiser');
        await log(when, R, 'ticket.rejected', `sent ${number} "${ticket.subject}" back - ${step.reason}`);
        break;

      case 'approve':
        ticket.status = 'Completed';
        ticket.completedAt = when;
        ticket.approvedByName = R.name;
        ticket.approvalDueAt = null;
        await system(when, R, 'approved', 'approved the work - request completed', 'raiser');
        await log(when, R, 'ticket.approved', `approved ${number} "${ticket.subject}" - request completed`);
        break;

      case 'auto':
        ticket.status = 'Completed';
        ticket.completedAt = when;
        ticket.approvedByName = 'Auto-approved';
        ticket.approvalDueAt = null;
        await system(when, WORKSPACE, 'auto-approved', `completed this automatically - ${R.name} did not answer within ${APPROVAL_WINDOW_TEXT}`, 'raiser');
        await log(when, WORKSPACE, 'ticket.auto_approved', `completed ${number} "${ticket.subject}" automatically - no answer from ${R.name} within ${APPROVAL_WINDOW_TEXT}`);
        break;

      case 'escalate':
        ticket.escalationStatus = 'open';
        ticket.escalatedAt = when;
        ticket.escalatedBy = by._id;
        ticket.escalatedByName = by.name;
        ticket.escalationReason = step.reason;
        ticket.escalationHandledAt = null;
        ticket.escalationHandledByName = '';
        ticket.escalationNote = '';
        ticket.escalationCount = (ticket.escalationCount ?? 0) + 1;
        await system(when, by, 'escalated', `escalated this to the super admin - ${step.reason}`, side(by));
        await log(when, by, 'ticket.escalated', `escalated ${number} "${ticket.subject}" to the super admin - ${step.reason}`);
        break;

      case 'handle':
        seen.set(idOf(boss), boss);
        ticket.escalationStatus = 'handled';
        ticket.escalationHandledAt = when;
        ticket.escalationHandledByName = boss.name;
        ticket.escalationNote = step.note;
        await system(when, boss, 'escalation.handled', `handled the escalation - ${step.note}`);
        await log(when, boss, 'ticket.escalation_handled', `handled the escalation on ${number} "${ticket.subject}" - ${step.note}`);
        break;

      default:
        throw new Error(`Unknown step ${step.kind}`);
    }
    written += 1;
  }

  ticket.messageCount = messages;
  ticket.lastMessageAt = lastMessageAt;
  ticket.updatedAt = steps.at(-1).at;
  await ticket.save({ timestamps: false });

  // Everyone on it has seen the thread: a demo should not light up badges.
  for (const person of holders.flat()) seen.set(idOf(person), person);
  const now = new Date();
  await ThreadRead.insertMany(
    [...seen.values()].map((person) => ({ ticket: ticket._id, user: person._id, userName: person.name, lastSeenAt: now })),
  );

  return { ticket, written };
}

// --- main -------------------------------------------------------------------------

async function remove(apply) {
  const escaped = MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tickets = await Ticket.find({ description: { $regex: escaped } }).select('number subject').lean();
  const ids = tickets.map((t) => t._id);
  console.log(tickets.length ? tickets.map((t) => `  ${t.number}  ${t.subject}`).join('\n') : '  (none found)');
  if (!apply || ids.length === 0) {
    if (ids.length) console.log('\nDry run. Add --apply to delete these and every line hanging off them.');
    return;
  }
  const [m, a, c, h, r, n, l, t] = await Promise.all([
    Message.deleteMany({ ticket: { $in: ids } }),
    TicketAssignment.deleteMany({ ticket: { $in: ids } }),
    TicketCommitment.deleteMany({ ticket: { $in: ids } }),
    HandoverRequest.deleteMany({ ticket: { $in: ids } }),
    ThreadRead.deleteMany({ ticket: { $in: ids } }),
    Notification.deleteMany({ ticket: { $in: ids } }),
    Activity.deleteMany({ ticketNumber: { $in: tickets.map((t) => t.number) } }),
    Ticket.deleteMany({ _id: { $in: ids } }),
  ]);
  console.log(
    `\nRemoved ${t.deletedCount} tickets, ${m.deletedCount} messages, ${a.deletedCount} handovers, ` +
      `${h.deletedCount} handover requests, ${c.deletedCount} promises, ${r.deletedCount} read marks, ` +
      `${n.deletedCount} notifications, ${l.deletedCount} log lines.`,
  );
}

async function main() {
  const apply = flag('--apply');
  if (apply && !local && !flag('--live')) {
    throw new Error(`${where} is not on this machine. Add --live as well if you mean to write there.`);
  }

  await connectDatabase();
  try {
    console.log(`Database: ${where}${local ? '' : '   <-- NOT LOCAL'}\n`);

    if (flag('--remove')) {
      await remove(apply);
      return;
    }

    const already = await Ticket.countDocuments({ description: { $regex: MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') } });
    if (already > 0) {
      throw new Error(`${already} demo tickets are already here. Run with --remove --apply first.`);
    }

    const casts = await pickCast();
    for (const cast of casts) {
      const who = resolver(cast);
      const refs = [...new Set(cast.story.steps().flatMap((s) => [s.by, ...(s.to ?? [])]).filter((r) => r && r !== 'R'))];
      const people = unique(refs.map(who)).map((p) => p.name);
      console.log(`${cast.story.key}. ${cast.story.finalSubject ?? cast.story.subject}`);
      console.log(`   raised by  ${cast.raiser.name}${cast.from.length ? ` (${cast.from.map((d) => d.name).join(', ')})` : ` (${cast.raiser.role})`}`);
      console.log(`   sent to    ${cast.slots.map((s) => s.department.name).join(', ')}`);
      console.log(`   people     ${people.join(', ')}`);
    }

    if (!apply) {
      console.log('\nDry run. Nothing written. Add --apply to create these.');
      return;
    }

    console.log('');
    // Oldest first, so the numbers run in the order they were raised.
    const ordered = [...casts].sort((a, b) => a.story.steps()[0].at - b.story.steps()[0].at);
    for (const cast of ordered) {
      // eslint-disable-next-line no-await-in-loop
      const { ticket, written } = await write(cast);
      console.log(`Created ${ticket.number}  ${written} steps  ${ticket.status.padEnd(11)} ${ticket.subject}`);
    }
  } finally {
    await disconnectDatabase();
  }
}

main().catch(async (error) => {
  console.error(error.message);
  if (mongoose.connection.readyState) await disconnectDatabase();
  process.exit(1);
});
