/**
 * Who may read a ticket, and who may work it.
 *
 * Both questions are asked from more than one place now - the ticket itself
 * and its chat thread - so they live here rather than in one controller. This
 * is the only place either is decided.
 */
import { MANAGER_ROLES } from '../models/User.js';

/**
 * Every department a ticket is shared with, as ids - its lead one first.
 *
 * Read off `departments` when it is there, and off the lead alone for a ticket
 * saved before tickets could be shared.
 */
export function departmentIdsOf(ticket) {
  const lead = ticket.department?._id ?? ticket.department;
  const all = (ticket.departments ?? []).map((item) => item?._id ?? item);
  return [...new Set([lead, ...all].filter(Boolean).map(String))];
}

/**
 * A ticket belongs to the departments it was raised to: their heads and teams
 * see it, and so does whoever raised it. Admins see everything.
 *
 * Asked of `departments` and of the lead both, so a ticket from before tickets
 * could be shared is still found before the backfill has reached it.
 */
export function visibilityFilter(user) {
  if (MANAGER_ROLES.includes(user.role)) return {};

  const departmentIds = (user.memberships ?? []).map((membership) => membership.department);

  return {
    $or: [
      { raisedBy: user._id },
      { departments: { $in: departmentIds } },
      { department: { $in: departmentIds } },
    ],
  };
}

/** The departments this person runs, as ids. */
export function headedDepartmentIds(user) {
  return (user.memberships ?? [])
    .filter((membership) => membership.role === 'head')
    .map((membership) => membership.department);
}

/**
 * Reading, with a head's oversight added: everything `visibilityFilter`
 * allows, plus whatever their own team has asked of other departments.
 *
 * A head answers for their people's requests as much as for their own queue,
 * so they may follow those tickets - the details, the conversation, the
 * history - without being part of them. It is a reading right only: every
 * write still asks `visibilityFilter`, `canWorkOn` or `isRaiser`, so a head
 * cannot reply on, edit or move a ticket that is not theirs or their
 * department's to work.
 */
export function oversightFilter(user) {
  const base = visibilityFilter(user);
  const headed = headedDepartmentIds(user);
  if (!base.$or || headed.length === 0) return base;

  return { $or: [...base.$or, { fromDepartments: { $in: headed } }] };
}

/** Who may work a ticket: the heads and teams of any of its departments, plus any manager. */
export function canWorkOn(user, ticket) {
  if (MANAGER_ROLES.includes(user.role)) return true;

  const here = new Set(departmentIdsOf(ticket));
  return (user.memberships ?? []).some((membership) => here.has(String(membership.department)));
}

/** Which of a ticket's departments this person runs. Every one of them, for a manager. */
export function departmentsHeadedOn(user, ticket) {
  const ids = departmentIdsOf(ticket);
  if (MANAGER_ROLES.includes(user.role)) return ids;
  return ids.filter((id) => user.roleInDepartment?.(id) === 'head');
}

/** Whether this person belongs to any of a ticket's departments (a manager counts as in all). */
export function inTicketDepartments(person, ticket) {
  if (!person) return false;
  if (MANAGER_ROLES.includes(person.role)) return true;
  return departmentIdsOf(ticket).some((id) => person.roleInDepartment?.(id));
}

/** Whether this person is the one who asked for the ticket. */
export function isRaiser(user, ticket) {
  return String(ticket.raisedBy?._id ?? ticket.raisedBy) === String(user._id);
}
