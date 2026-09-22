import mongoose from 'mongoose';

import Activity from '../models/Activity.js';
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
 * A department's own people see their departments' log and nothing else.
 * Managers see every department. Either may narrow with ?department=, which
 * takes several ids - "Finance and IT Support" is one question.
 */
export async function listActivity(req, res) {
  const { department, limit } = req.query;
  const asked = askedFor(department);

  let filter;
  if (isManager(req.user)) {
    filter = asked.length > 0 ? { department: { $in: asked } } : {};
  } else {
    const mine = (req.user.memberships ?? []).map((membership) => String(membership.department));
    if (mine.length === 0) return res.json({ success: true, activity: [] });

    // Narrowing can only ever shrink what they were already allowed to see:
    // anything asked for outside their own departments is dropped.
    const allowed = asked.filter((id) => mine.includes(id));
    filter = { department: { $in: allowed.length > 0 ? allowed : mine } };
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
