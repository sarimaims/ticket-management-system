import mongoose from 'mongoose';

import Activity from '../models/Activity.js';
import Ticket from '../models/Ticket.js';
import { MANAGER_ROLES } from '../models/User.js';

const isManager = (user) => MANAGER_ROLES.includes(user.role);

function present(entry) {
  return {
    id: String(entry._id),
    department: entry.department
      ? { id: String(entry.department), name: entry.departmentName }
      : null,
    actor: { name: entry.actorName, role: entry.actorRole },
    action: entry.action,
    summary: entry.summary,
    ticketNumber: entry.ticketNumber,
    createdAt: entry.createdAt,
  };
}

/** `?department=` takes one id or a comma-separated list of them. */
function askedFor(department) {
  return String(department ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => mongoose.isValidObjectId(id));
}

/**
 * Who reads what.
 *
 * A manager reads everything. A head reads the departments they run, all of
 * it, because running a queue means knowing what is happening in it. Everyone
 * else reads their own work: the tickets on their desk and the ones they
 * raised, and nothing about what their colleagues are doing.
 *
 * Somebody can be both - a head of one department and an ordinary member of
 * another - so the two are combined rather than chosen between.
 *
 * Either may narrow with ?department=, which takes several ids ("Finance and
 * IT Support" is one question) and can only ever shrink what they could
 * already see.
 */
export async function listActivity(req, res) {
  const { department, limit } = req.query;
  const asked = askedFor(department);

  let filter;
  if (isManager(req.user)) {
    filter = asked.length > 0 ? { department: { $in: asked } } : {};
  } else {
    const runs = (req.user.memberships ?? [])
      .filter((membership) => membership.role === 'head')
      .map((membership) => membership.department);

    /*
     * Matched by ticket number rather than by id: a log line is written for
     * people to read and carries the number they would recognise, and adding
     * a reference to every historical row would be a migration for a join
     * that this answers without one.
     */
    const mine = await Ticket.find({
      $or: [{ assignees: req.user._id }, { raisedBy: req.user._id }],
    }).distinct('number');

    const reach = [];
    if (runs.length > 0) reach.push({ department: { $in: runs } });
    if (mine.length > 0) reach.push({ ticketNumber: { $in: mine } });

    // Neither a head of anything nor on any ticket: there is nothing of
    // theirs to read.
    if (reach.length === 0) return res.json({ success: true, activity: [] });

    filter = reach.length === 1 ? reach[0] : { $or: reach };
    if (asked.length > 0) filter = { $and: [filter, { department: { $in: asked } }] };
  }

  const entries = await Activity.find(filter)
    .sort({ createdAt: -1 })
    .limit(Math.min(Number(limit) || 100, 300));

  res.json({ success: true, activity: entries.map(present) });
}

/** Managers only - see the route. Clears one department or the whole log. */
export async function clearActivity(req, res) {
  const { department } = req.query;

  const filter =
    department && mongoose.isValidObjectId(department) ? { department } : {};

  const result = await Activity.deleteMany(filter);
  res.json({ success: true, cleared: result.deletedCount });
}
