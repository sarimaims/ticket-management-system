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

/**
 * A department's own people see that department's log and nothing else.
 * Managers see every department, and may narrow with ?department=.
 */
export async function listActivity(req, res) {
  const { department, limit } = req.query;

  let filter;
  if (isManager(req.user)) {
    filter =
      department && mongoose.isValidObjectId(department) ? { department } : {};
  } else {
    const mine = (req.user.memberships ?? []).map((membership) => membership.department);
    if (mine.length === 0) return res.json({ success: true, activity: [] });

    filter =
      department && mine.some((id) => String(id) === String(department))
        ? { department }
        : { department: { $in: mine } };
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
