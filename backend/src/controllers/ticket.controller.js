import mongoose from 'mongoose';

import ApiError from '../utils/ApiError.js';
import Department from '../models/Department.js';
import Ticket, { TICKET_PRIORITIES, TICKET_STATUSES } from '../models/Ticket.js';
import User, { MANAGER_ROLES } from '../models/User.js';
import { record } from '../services/activity.js';
import { notifyNewTicket, notifyTicketEdited, notifyTicketUpdated } from '../services/notify.js';

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
    committedDeadline: ticket.committedDeadline ?? null,
    committedBy: populated(ticket.committedBy)
      ? { id: String(ticket.committedBy._id), name: ticket.committedBy.name }
      : null,
    committedAt: ticket.committedAt ?? null,
    department: populated(department)
      ? { id: String(department._id), name: department.name, code: department.code }
      : { id: String(department) },
    fromDepartments: (ticket.fromDepartments ?? []).map((item) =>
      populated(item)
        ? { id: String(item._id), name: item.name, code: item.code }
        : { id: String(item) },
    ),
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
  const {
    department,
    departments,
    fromDepartments,
    subject,
    description,
    requestType,
    priority,
    deadline,
    project,
  } = req.body ?? {};

  // Accepts one department or several; a single id stays valid.
  const targetIds = [...new Set((departments ?? [department]).filter(Boolean).map(String))];

  if (targetIds.length === 0) throw ApiError.badRequest('Pick at least one department.');
  if (targetIds.some((id) => !mongoose.isValidObjectId(id))) {
    throw ApiError.badRequest('One or more departments are invalid.');
  }
  if (!subject?.trim()) throw ApiError.badRequest('Subject is required.');
  if (!description?.trim()) throw ApiError.badRequest('Description is required.');
  if (!requestType?.trim()) throw ApiError.badRequest('Request type is required.');
  if (!deadline) throw ApiError.badRequest('Deadline is required.');
  const dueDate = new Date(deadline);
  if (Number.isNaN(dueDate.getTime())) throw ApiError.badRequest('Invalid deadline.');
  if (priority && !TICKET_PRIORITIES.includes(priority)) {
    throw ApiError.badRequest(`Priority must be one of: ${TICKET_PRIORITIES.join(', ')}.`);
  }

  const targets = await Department.find({ _id: { $in: targetIds }, isActive: true });
  if (targets.length !== targetIds.length) {
    throw ApiError.badRequest('One or more departments do not exist.');
  }

  // You may only raise on behalf of a department you actually belong to.
  const fromIds = [...new Set((fromDepartments ?? []).filter(Boolean).map(String))];
  const mine = new Set((req.user.memberships ?? []).map((m) => String(m.department)));
  const stranger = fromIds.find((id) => !mine.has(id));
  if (stranger) throw ApiError.badRequest('You can only raise on behalf of your own departments.');

  const shared = {
    subject: subject.trim(),
    description: description.trim(),
    requestType: requestType.trim(),
    priority: priority || 'Medium',
    raisedBy: req.user._id,
    raisedByRole: req.user.role,
    fromDepartments: fromIds,
    deadline: dueDate,
    project: project?.trim() ?? '',
  };

  // One ticket per receiving department: each owns its own number, status and
  // assignee, so one department resolving does not close it for the others.
  const created = [];
  for (const target of targets) {
    // Sequential rather than Promise.all: the ticket number comes from a
    // shared counter, and this keeps the numbering in a predictable order.
    // eslint-disable-next-line no-await-in-loop
    created.push(await Ticket.create({ ...shared, department: target._id }));
  }

  const populated = await Ticket.find({ _id: { $in: created.map((item) => item._id) } })
    .sort({ number: 1 })
    .populate('department', 'name code')
    .populate('raisedBy', 'name email')
    .populate('fromDepartments', 'name code')
    .populate('assignee', 'name email')
    .populate('committedBy', 'name email');

  const tickets = populated.map(present);

  for (const ticket of populated) {
    // eslint-disable-next-line no-await-in-loop
    await record({
      actor: req.user,
      department: ticket.department,
      action: 'ticket.created',
      summary: `raised ${ticket.number} "${ticket.subject}"`,
      ticketNumber: ticket.number,
    });
    // eslint-disable-next-line no-await-in-loop
    await notifyNewTicket({ ticket, actor: req.user });
  }

  res.status(201).json({ success: true, tickets, ticket: tickets[0] });
}

/**
 * A cheap stand-in for the whole list: how many tickets match, and when the
 * newest of them last moved. Two covered queries answer it, so a client that
 * polls costs a fraction of building and sending the list again.
 *
 * It tracks the tickets themselves, not the departments and people they point
 * at - renaming a department does not change the tag, and that name reaches
 * the client on the next real change.
 */
async function fingerprint(filter) {
  const [count, newest] = await Promise.all([
    Ticket.countDocuments(filter),
    Ticket.findOne(filter).sort({ updatedAt: -1 }).select('updatedAt').lean(),
  ]);

  const moved = newest?.updatedAt ? new Date(newest.updatedAt).getTime() : 0;
  return `W/"tk-${count}-${moved}"`;
}

/** `scope=mine` for what I raised, `scope=assigned` for my departments' queue. */
export async function listTickets(req, res) {
  const { scope, status, department, priority } = req.query;

  const filter = { ...visibilityFilter(req.user) };

  if (scope === 'mine') filter.raisedBy = req.user._id;
  if (scope === 'assigned') {
    // Everything my departments have been asked to do, including what I asked
    // them myself: someone in two departments raises from one to the other,
    // and that ticket is still their department's work to pick up.
    const departmentIds = (req.user.memberships ?? []).map((membership) => membership.department);
    filter.department = { $in: departmentIds };
  }

  if (status) filter.status = status;
  if (priority) filter.priority = priority;
  if (department && mongoose.isValidObjectId(department)) filter.department = department;

  // A polling client sends back the tag it already holds. When nothing has
  // moved the answer is 304 with no body, and the five populate lookups below
  // never run.
  const tag = await fingerprint(filter);
  res.set('ETag', tag);
  res.set('Cache-Control', 'private, no-cache');

  const offered = (req.headers['if-none-match'] ?? '')
    .split(',')
    .map((value) => value.trim());

  if (offered.includes(tag)) {
    res.status(304).end();
    return;
  }

  const tickets = await Ticket.find(filter)
    .sort({ createdAt: -1 })
    .populate('department', 'name code')
    .populate('raisedBy', 'name email')
    .populate('fromDepartments', 'name code')
    .populate('assignee', 'name email')
    .populate('committedBy', 'name email');

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
    .populate('fromDepartments', 'name code')
    .populate('assignee', 'name email')
    .populate('committedBy', 'name email');

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
 * Works a ticket: status, assignee, and the two dates.
 *
 * The dates belong to different people and are enforced that way:
 *   deadline          - what the raiser asked for. Only they, or an admin,
 *                       may move it; the receiving department cannot.
 *   committedDeadline - what the receiving department promises back. Only
 *                       someone who works the ticket may set it.
 *
 * Raising a ticket and resolving it are still different rights: the raiser
 * cannot mark their own request done.
 */
export async function updateTicket(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.badRequest('Invalid ticket id.');

  const ticket = await Ticket.findOne({ _id: req.params.id, ...visibilityFilter(req.user) });
  if (!ticket) throw ApiError.notFound('Ticket not found.');

  const worksIt = canWorkOn(req.user, ticket);
  const isRaiser = String(ticket.raisedBy?._id ?? ticket.raisedBy) === String(req.user._id);

  if (!worksIt && !isRaiser) {
    throw ApiError.forbidden('Only the receiving department can update this ticket.');
  }

  const {
    status,
    deadline,
    committedDeadline,
    assignee,
    priority,
    subject,
    description,
    requestType,
    project,
  } = req.body ?? {};

  // Status and assignee are how a department works a ticket: theirs alone.
  if (!worksIt && (status !== undefined || assignee !== undefined)) {
    throw ApiError.forbidden('Only the receiving department can work this ticket.');
  }

  // The request itself is the raiser's: what they asked for, how urgent it is
  // and by when. A department answers a request, it does not rewrite it.
  const owns = isRaiser || MANAGER_ROLES.includes(req.user.role);
  const editsRequest =
    subject !== undefined ||
    description !== undefined ||
    requestType !== undefined ||
    project !== undefined ||
    priority !== undefined;

  if (editsRequest && !owns) {
    throw ApiError.forbidden('Only the person who raised this can edit the request.');
  }

  // Remember what it looked like, so the log can say what actually changed.
  const asDay = (value) => (value ? value.toISOString().slice(0, 10) : null);
  const before = {
    status: ticket.status,
    priority: ticket.priority,
    subject: ticket.subject,
    description: ticket.description,
    requestType: ticket.requestType,
    project: ticket.project,
    deadline: asDay(ticket.deadline),
    committedDeadline: asDay(ticket.committedDeadline),
    assignee: ticket.assignee ? String(ticket.assignee) : null,
  };

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

  if (subject !== undefined) {
    if (!subject?.trim()) throw ApiError.badRequest('Subject is required.');
    ticket.subject = subject.trim();
  }

  if (description !== undefined) {
    if (!description?.trim()) throw ApiError.badRequest('Description is required.');
    ticket.description = description.trim();
  }

  if (requestType !== undefined) {
    if (!requestType?.trim()) throw ApiError.badRequest('Request type is required.');
    ticket.requestType = requestType.trim();
  }

  // The only one of these that may be emptied: it is optional to begin with.
  if (project !== undefined) ticket.project = project?.trim() ?? '';

  if (deadline !== undefined) {
    // The ask is the raiser's to move. A department that cannot meet it
    // commits to its own date instead, below.
    if (!isRaiser && !MANAGER_ROLES.includes(req.user.role)) {
      throw ApiError.forbidden(
        'Only the person who raised this can change the requested deadline. Commit to a date of your own instead.',
      );
    }

    // Every ticket carries a deadline, so it can be moved but never removed.
    if (!deadline) throw ApiError.badRequest('Deadline is required.');
    const parsed = new Date(deadline);
    if (Number.isNaN(parsed.getTime())) throw ApiError.badRequest('Invalid deadline.');
    ticket.deadline = parsed;
  }

  if (committedDeadline !== undefined) {
    if (!worksIt) {
      throw ApiError.forbidden('Only the receiving department can commit to a date.');
    }

    const parsed = committedDeadline ? new Date(committedDeadline) : null;
    if (parsed && Number.isNaN(parsed.getTime())) {
      throw ApiError.badRequest('Invalid committed deadline.');
    }

    ticket.committedDeadline = parsed;
    ticket.committedBy = parsed ? req.user._id : null;
    ticket.committedAt = parsed ? new Date() : null;
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
    .populate('fromDepartments', 'name code')
    .populate('assignee', 'name email')
    .populate('committedBy', 'name email');

  const changes = [];
  if (before.status !== populated.status) {
    changes.push(`status ${before.status} -> ${populated.status}`);
  }
  if (before.priority !== populated.priority) {
    changes.push(`priority ${before.priority} -> ${populated.priority}`);
  }
  if (before.subject !== populated.subject) {
    changes.push(`subject changed to "${populated.subject}"`);
  }
  if (before.description !== populated.description) changes.push('description edited');
  if (before.requestType !== populated.requestType) {
    changes.push(`request type ${before.requestType} -> ${populated.requestType}`);
  }
  if (before.project !== populated.project) {
    changes.push(populated.project ? `project set to ${populated.project}` : 'project cleared');
  }
  const nowDeadline = asDay(populated.deadline);
  if (before.deadline !== nowDeadline) {
    changes.push(
      nowDeadline ? `requested deadline set to ${nowDeadline}` : 'requested deadline cleared',
    );
  }
  const nowCommitted = asDay(populated.committedDeadline);
  if (before.committedDeadline !== nowCommitted) {
    changes.push(
      nowCommitted ? `committed to finish by ${nowCommitted}` : 'withdrew the committed date',
    );
  }
  const nowAssignee = populated.assignee ? String(populated.assignee._id) : null;
  if (before.assignee !== nowAssignee) {
    changes.push(
      populated.assignee ? `assigned to ${populated.assignee.name}` : 'unassigned',
    );
  }

  if (changes.length > 0) {
    const summary = changes.join(', ');
    await record({
      actor: req.user,
      department: populated.department,
      action: 'ticket.updated',
      summary: `updated ${populated.number}: ${summary}`,
      ticketNumber: populated.number,
    });

    // Who hears about it depends on which side moved: the raiser editing their
    // own request is news for the department, not for themselves.
    if (isRaiser && !worksIt) {
      await notifyTicketEdited({ ticket: populated, actor: req.user, summary });
    } else {
      await notifyTicketUpdated({ ticket: populated, actor: req.user, summary });
    }
  }

  res.json({ success: true, ticket: present(populated) });
}
