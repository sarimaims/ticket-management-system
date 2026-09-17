import mongoose from 'mongoose';

import ApiError from '../utils/ApiError.js';
import Department from '../models/Department.js';
import Ticket, { TICKET_PRIORITIES, TICKET_STATUSES } from '../models/Ticket.js';
import User, { MANAGER_ROLES } from '../models/User.js';

function present(ticket) {
  const department = ticket.department;
  const raisedBy = ticket.raisedBy;
  const populated = (value) => value && typeof value === 'object' && !(value instanceof mongoose.Types.ObjectId);

  return {
    id: String(ticket._id),
    number: ticket.number,
    subject: ticket.subject,
    description: ticket.description,
    requestType: ticket.requestType,
    priority: ticket.priority,
    status: ticket.status,
    project: ticket.project,
    deadline: ticket.deadline,
    department: populated(department)
      ? { id: String(department._id), name: department.name, code: department.code }
      : { id: String(department) },
    raisedBy: populated(raisedBy)
      ? { id: String(raisedBy._id), name: raisedBy.name, email: raisedBy.email }
      : { id: String(raisedBy) },
    // What level this came from: 'superadmin', 'admin' or 'user'.
    raisedByRole: ticket.raisedByRole,
    assignee: populated(ticket.assignee)
      ? { id: String(ticket.assignee._id), name: ticket.assignee.name }
      : null,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
  };
}

/**
 * A raised ticket belongs to one department: its head and its team see it, and
 * so does whoever raised it. Admins see everything. This is the only place
 * that decides who may read a ticket.
 */
function visibilityFilter(user) {
  if (MANAGER_ROLES.includes(user.role)) return {};

  const departmentIds = (user.memberships ?? []).map((membership) => membership.department);

  return {
    $or: [{ raisedBy: user._id }, { department: { $in: departmentIds } }],
  };
}

export async function createTicket(req, res) {
  const { department, subject, description, requestType, priority, deadline, project } =
    req.body ?? {};

  if (!mongoose.isValidObjectId(department)) throw ApiError.badRequest('Pick a department.');
  if (!subject?.trim()) throw ApiError.badRequest('Subject is required.');
  if (!description?.trim()) throw ApiError.badRequest('Description is required.');
  if (!requestType?.trim()) throw ApiError.badRequest('Request type is required.');
  if (priority && !TICKET_PRIORITIES.includes(priority)) {
    throw ApiError.badRequest(`Priority must be one of: ${TICKET_PRIORITIES.join(', ')}.`);
  }

  const target = await Department.findOne({ _id: department, isActive: true });
  if (!target) throw ApiError.badRequest('That department does not exist.');

  const ticket = await Ticket.create({
    subject: subject.trim(),
    description: description.trim(),
    requestType: requestType.trim(),
    priority: priority || 'Medium',
    department: target._id,
    raisedBy: req.user._id,
    raisedByRole: req.user.role,
    deadline: deadline ? new Date(deadline) : null,
    project: project?.trim() ?? '',
  });

  const populated = await Ticket.findById(ticket._id)
    .populate('department', 'name code')
    .populate('raisedBy', 'name email')
    .populate('assignee', 'name email');

  res.status(201).json({ success: true, ticket: present(populated) });
}

/** `scope=mine` for what I raised, `scope=assigned` for my departments' queue. */
export async function listTickets(req, res) {
  const { scope, status, department, priority } = req.query;

  const filter = { ...visibilityFilter(req.user) };

  if (scope === 'mine') filter.raisedBy = req.user._id;
  if (scope === 'assigned') {
    const departmentIds = (req.user.memberships ?? []).map((membership) => membership.department);
    filter.department = { $in: departmentIds };
    filter.raisedBy = { $ne: req.user._id };
  }

  if (status) filter.status = status;
  if (priority) filter.priority = priority;
  if (department && mongoose.isValidObjectId(department)) filter.department = department;

  const tickets = await Ticket.find(filter)
    .sort({ createdAt: -1 })
    .populate('department', 'name code')
    .populate('raisedBy', 'name email')
    .populate('assignee', 'name email');

  res.json({ success: true, tickets: tickets.map(present) });
}

export async function getTicket(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.badRequest('Invalid ticket id.');

  const ticket = await Ticket.findOne({
    _id: req.params.id,
    ...visibilityFilter(req.user),
  })
    .populate('department', 'name code')
    .populate('raisedBy', 'name email')
    .populate('assignee', 'name email');

  // Not found and not allowed answer the same, so the endpoint cannot be used
  // to discover which ticket ids exist.
  if (!ticket) throw ApiError.notFound('Ticket not found.');

  res.json({ success: true, ticket: present(ticket) });
}

/** Who may work a ticket: its department's head and team, plus any manager. */
function canWorkOn(user, ticket) {
  if (MANAGER_ROLES.includes(user.role)) return true;

  const departmentId = String(ticket.department?._id ?? ticket.department);
  return (user.memberships ?? []).some(
    (membership) => String(membership.department) === departmentId,
  );
}

/**
 * Works a ticket: status, deadline, assignee. Raising a ticket and resolving
 * it are different rights - the raiser cannot mark their own request done.
 */
export async function updateTicket(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.badRequest('Invalid ticket id.');

  const ticket = await Ticket.findOne({ _id: req.params.id, ...visibilityFilter(req.user) });
  if (!ticket) throw ApiError.notFound('Ticket not found.');

  if (!canWorkOn(req.user, ticket)) {
    throw ApiError.forbidden('Only the receiving department can update this ticket.');
  }

  const { status, deadline, assignee, priority } = req.body ?? {};

  if (status !== undefined) {
    if (!TICKET_STATUSES.includes(status)) {
      throw ApiError.badRequest(`Status must be one of: ${TICKET_STATUSES.join(', ')}.`);
    }
    ticket.status = status;
  }

  if (priority !== undefined) {
    if (!TICKET_PRIORITIES.includes(priority)) {
      throw ApiError.badRequest(`Priority must be one of: ${TICKET_PRIORITIES.join(', ')}.`);
    }
    ticket.priority = priority;
  }

  if (deadline !== undefined) {
    ticket.deadline = deadline ? new Date(deadline) : null;
  }

  if (assignee !== undefined) {
    if (assignee === null || assignee === '') {
      ticket.assignee = null;
    } else {
      if (!mongoose.isValidObjectId(assignee)) throw ApiError.badRequest('Invalid assignee.');

      const candidate = await User.findById(assignee);
      const belongs =
        candidate &&
        (MANAGER_ROLES.includes(candidate.role) ||
          candidate.roleInDepartment(ticket.department));

      if (!belongs) throw ApiError.badRequest('That person is not in this department.');
      ticket.assignee = candidate._id;
    }
  }

  await ticket.save();

  const populated = await Ticket.findById(ticket._id)
    .populate('department', 'name code')
    .populate('raisedBy', 'name email')
    .populate('assignee', 'name email');

  res.json({ success: true, ticket: present(populated) });
}
