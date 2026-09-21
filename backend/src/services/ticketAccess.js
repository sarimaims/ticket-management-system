/**
 * Who may read a ticket, and who may work it.
 *
 * Both questions are asked from more than one place now - the ticket itself
 * and its chat thread - so they live here rather than in one controller. This
 * is the only place either is decided.
 */
import { MANAGER_ROLES } from '../models/User.js';

/**
 * A raised ticket belongs to one department: its head and its team see it, and
 * so does whoever raised it. Admins see everything.
 */
export function visibilityFilter(user) {
  if (MANAGER_ROLES.includes(user.role)) return {};

  const departmentIds = (user.memberships ?? []).map((membership) => membership.department);

  return {
    $or: [{ raisedBy: user._id }, { department: { $in: departmentIds } }],
  };
}

/** Who may work a ticket: its department's head and team, plus any manager. */
export function canWorkOn(user, ticket) {
  if (MANAGER_ROLES.includes(user.role)) return true;

  const departmentId = String(ticket.department?._id ?? ticket.department);
  return (user.memberships ?? []).some(
    (membership) => String(membership.department) === departmentId,
  );
}

/** Whether this person is the one who asked for the ticket. */
export function isRaiser(user, ticket) {
  return String(ticket.raisedBy?._id ?? ticket.raisedBy) === String(user._id);
}
