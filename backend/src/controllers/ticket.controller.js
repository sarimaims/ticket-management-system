import mongoose from 'mongoose';

import ApiError from '../utils/ApiError.js';
import {
  buildTicketKey,
  createDownloadUrl,
  createUploadUrl,
  describeObject,
  isConfigured as storageReady,
  StorageUnavailable,
  TICKET_FILE,
  ticketKeyPrefixFor,
  validateTicketUpload,
} from '../services/storage.js';
import Department from '../models/Department.js';
import Ticket, { TICKET_PRIORITIES, TICKET_STATUSES } from '../models/Ticket.js';
import TicketAssignment from '../models/TicketAssignment.js';
import User, { MANAGER_ROLES } from '../models/User.js';
import { record } from '../services/activity.js';
import { recordAssignment } from '../services/assignment.js';
import { canWorkOn, visibilityFilter } from '../services/ticketAccess.js';
import { notifyNewTicket, notifyTicketEdited, notifyTicketUpdated } from '../services/notify.js';

/**
 * The department a ticket sits with, and the unit above it.
 *
 * The unit rides along because a person works in one at a time: their lists
 * are scoped by it, and a ticket that does not know its own unit cannot be
 * filtered without a second round trip for every row.
 */
const WITH_DEPARTMENT = {
  path: 'department',
  select: 'name code unit',
  populate: { path: 'unit', select: 'name code' },
};

/** The same, for the departments a request was raised on behalf of. */
const WITH_FROM_DEPARTMENTS = { ...WITH_DEPARTMENT, path: 'fromDepartments' };

/** A populated unit, flattened to what the client reads. */
function presentUnit(unit) {
  if (!unit) return null;
  return typeof unit === 'object' && unit.name
    ? { id: String(unit._id), name: unit.name, code: unit.code }
    : { id: String(unit) };
}

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
      ? {
          id: String(department._id),
          name: department.name,
          code: department.code,
          unit: presentUnit(department.unit),
        }
      : { id: String(department) },
    fromDepartments: (ticket.fromDepartments ?? []).map((item) =>
      populated(item)
        ? { id: String(item._id), name: item.name, code: item.code, unit: presentUnit(item.unit) }
        : { id: String(item) },
    ),
    raisedBy: populated(raisedBy)
      ? { id: String(raisedBy._id), name: raisedBy.name, email: raisedBy.email }
      : { id: String(raisedBy) },
    // What level this came from: 'superadmin', 'admin' or 'user'.
    raisedByRole: ticket.raisedByRole,
    assignees: (ticket.assignees ?? []).map((person) =>
      populated(person) ? { id: String(person._id), name: person.name } : { id: String(person) },
    ),
    /**
     * What was attached to the request. No URLs here: a signed link expires
     * within the hour and a list is cached for longer than that, so the link
     * is fetched at the moment it is followed instead.
     */
    attachments: (ticket.attachments ?? []).map((file, index) => ({
      index,
      filename: file.filename || 'Attachment',
      mimeType: file.mimeType,
      size: file.size,
      uploadedAt: file.uploadedAt ?? null,
    })),
    // How much has been said on it, so a row can show there is a conversation
    // without the list loading a single message.
    messageCount: ticket.messageCount ?? 0,
    lastMessageAt: ticket.lastMessageAt ?? null,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
  };
}

/**
 * Hands back a URL the browser may PUT one file to.
 *
 * Asked for while the form is still being filled in, so there is no ticket to
 * name yet: the key is owned by the person uploading, and checked against them
 * again when the ticket that refers to it is written.
 */
export async function createTicketUploadTarget(req, res) {
  if (!storageReady()) {
    throw ApiError.unavailable('File storage is not configured yet, so files cannot be attached.');
  }

  const { contentType, size, filename } = req.body ?? {};

  const problem = validateTicketUpload({ contentType, size });
  if (problem) throw ApiError.badRequest(problem);

  const key = buildTicketKey({ ownerId: String(req.user._id), filename, contentType });

  let target;
  try {
    target = await createUploadUrl({ key, contentType, size: Number(size) });
  } catch (error) {
    if (error instanceof StorageUnavailable) throw ApiError.unavailable(error.message);
    throw error;
  }

  res.json({ success: true, key, ...target });
}

/**
 * Turns the keys the browser uploaded to into something worth storing.
 *
 * Each object is inspected in the bucket first: that proves the upload
 * finished, and means the size and type recorded are S3's own rather than
 * whatever the client claimed. The key must carry the caller's own prefix, so
 * one person cannot attach another's file to their request.
 */
async function resolveAttachments(req) {
  const input = req.body?.attachments;
  if (!Array.isArray(input) || input.length === 0) return [];

  if (!storageReady()) throw ApiError.unavailable('File storage is not configured yet.');
  if (input.length > TICKET_FILE.maxCount) {
    throw ApiError.badRequest(`A request can carry at most ${TICKET_FILE.maxCount} files.`);
  }

  const prefix = ticketKeyPrefixFor(String(req.user._id));
  const files = [];

  for (const entry of input) {
    const key = entry?.key;
    if (typeof key !== 'string' || !key) throw ApiError.badRequest('An upload key is missing.');
    if (!key.startsWith(prefix)) throw ApiError.badRequest('That upload is not yours to attach.');

    let object;
    try {
      // eslint-disable-next-line no-await-in-loop
      object = await describeObject(key);
    } catch (error) {
      if (error instanceof StorageUnavailable) throw ApiError.unavailable(error.message);
      throw ApiError.badRequest('An upload did not finish. Try attaching it again.');
    }

    const problem = validateTicketUpload({ contentType: object.contentType, size: object.size });
    if (problem) throw ApiError.badRequest(problem);

    files.push({
      key,
      filename: typeof entry.filename === 'string' ? entry.filename.slice(0, 160) : '',
      mimeType: object.contentType,
      size: object.size,
      uploadedBy: req.user._id,
      uploadedAt: new Date(),
    });
  }

  return files;
}

/**
 * Sends the reader to one attachment.
 *
 * A redirect rather than a URL in the ticket's JSON: the signature expires
 * within the hour, and a list that was cached before lunch would otherwise
 * hand out dead links. Reading a file is exactly the right to read its ticket.
 */
export async function downloadAttachment(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.badRequest('Invalid ticket id.');

  const ticket = await Ticket.findOne({ _id: req.params.id, ...visibilityFilter(req.user) });
  if (!ticket) throw ApiError.notFound('Ticket not found.');

  const file = (ticket.attachments ?? [])[Number(req.params.index)];
  if (!file) throw ApiError.notFound('Attachment not found.');

  if (!storageReady()) throw ApiError.unavailable('File storage is not configured yet.');

  try {
    res.redirect(await createDownloadUrl(file.key));
  } catch (error) {
    if (error instanceof StorageUnavailable) throw ApiError.unavailable(error.message);
    throw error;
  }
}

export async function createTicket(req, res) {
  const {
    department,
    departments,
    fromDepartments,
    assignees,
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

  /**
   * Who should pick it up, per department: `{ departmentId: [userId, ...] }`.
   *
   * Each target gets its own ticket, so each gets its own names - somebody in
   * Finance cannot hold the copy that went to IT - and a department can put
   * more than one person on the same request rather than splitting it in two.
   *
   * The names are a starting point, not a claim on anyone's time: the
   * receiving department can reassign it like any other ticket.
   */
  const assignedTo = new Map();
  if (assignees && typeof assignees === 'object' && !Array.isArray(assignees)) {
    const nameOf = new Map(targets.map((target) => [String(target._id), target.name]));

    for (const [departmentId, picked] of Object.entries(assignees)) {
      const wanted = [...new Set((Array.isArray(picked) ? picked : [picked]).filter(Boolean))];
      if (wanted.length === 0) continue;

      const key = String(departmentId);
      if (!nameOf.has(key)) {
        throw ApiError.badRequest('You can only name someone in a department you are asking.');
      }

      const held = [];
      for (const userId of wanted) {
        if (!mongoose.isValidObjectId(userId)) throw ApiError.badRequest('Invalid assignee.');

        // eslint-disable-next-line no-await-in-loop
        const candidate = await User.findById(userId);
        const belongs =
          candidate &&
          candidate.status !== 'suspended' &&
          (MANAGER_ROLES.includes(candidate.role) || candidate.roleInDepartment(key));

        if (!belongs) throw ApiError.badRequest(`That person is not in ${nameOf.get(key)}.`);
        held.push(candidate._id);
      }

      assignedTo.set(key, held);
    }
  }

  // Naming somebody is optional. A ticket with no name on it still reaches the
  // department's head and team, who can pick it up or hand it on; requiring a
  // name would mean knowing who works there before you are allowed to ask.

  // You may only raise on behalf of a department you actually belong to.
  const fromIds = [...new Set((fromDepartments ?? []).filter(Boolean).map(String))];
  const mine = new Set((req.user.memberships ?? []).map((m) => String(m.department)));
  const stranger = fromIds.find((id) => !mine.has(id));
  if (stranger) throw ApiError.badRequest('You can only raise on behalf of your own departments.');

  // Checked against the bucket before anything is written: a ticket must not
  // end up pointing at an upload that never landed.
  const attachments = await resolveAttachments(req);

  const shared = {
    subject: subject.trim(),
    description: description.trim(),
    requestType: requestType?.trim() ?? '',
    priority: priority || 'Medium',
    raisedBy: req.user._id,
    raisedByRole: req.user.role,
    fromDepartments: fromIds,
    deadline: dueDate,
    project: project?.trim() ?? '',
    // The same files on each ticket when several departments are asked: one
    // upload, one copy in the bucket, referred to by each request.
    attachments,
  };

  // One ticket per receiving department: each owns its own number, status and
  // assignee, so one department resolving does not close it for the others.
  const created = [];
  for (const target of targets) {
    // Sequential rather than Promise.all: the ticket number comes from a
    // shared counter, and this keeps the numbering in a predictable order.
    // eslint-disable-next-line no-await-in-loop
    created.push(
      await Ticket.create({
        ...shared,
        department: target._id,
        assignees: assignedTo.get(String(target._id)) ?? [],
      }),
    );
  }

  const populated = await Ticket.find({ _id: { $in: created.map((item) => item._id) } })
    .sort({ number: 1 })
    .populate(WITH_DEPARTMENT)
    .populate('raisedBy', 'name email')
    .populate(WITH_FROM_DEPARTMENTS)
    .populate('assignees', 'name email')
    .populate('committedBy', 'name email');

  const tickets = populated.map(present);

  for (const ticket of populated) {
    // eslint-disable-next-line no-await-in-loop
    await record({
      actor: req.user,
      department: ticket.department,
      action: 'ticket.created',
      summary:
        (ticket.assignees ?? []).length > 0
          ? `raised ${ticket.number} "${ticket.subject}" for ${ticket.assignees
              .map((person) => person.name)
              .join(', ')}`
          : `raised ${ticket.number} "${ticket.subject}"`,
      ticketNumber: ticket.number,
    });
    // eslint-disable-next-line no-await-in-loop
    await recordAssignment({
      ticket,
      from: [],
      to: ticket.assignees ?? [],
      actor: req.user,
      kind: 'raised',
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
  if (scope === 'assigned' && !MANAGER_ROLES.includes(req.user.role)) {
    // Everything my departments have been asked to do, including what I asked
    // them myself: someone in two departments raises from one to the other,
    // and that ticket is still their department's work to pick up.
    //
    // A manager belongs to no department but oversees all of them, so their
    // queue is every department's - otherwise it would always be empty and an
    // admin could not open any thread at all.
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
    .populate(WITH_DEPARTMENT)
    .populate('raisedBy', 'name email')
    .populate(WITH_FROM_DEPARTMENTS)
    .populate('assignees', 'name email')
    .populate('committedBy', 'name email');

  res.json({ success: true, tickets: tickets.map(present) });
}

export async function getTicket(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.badRequest('Invalid ticket id.');

  const ticket = await Ticket.findOne({
    _id: req.params.id,
    ...visibilityFilter(req.user),
  })
    .populate(WITH_DEPARTMENT)
    .populate('raisedBy', 'name email')
    .populate(WITH_FROM_DEPARTMENTS)
    .populate('assignees', 'name email')
    .populate('committedBy', 'name email');

  // Not found and not allowed answer the same, so the endpoint cannot be used
  // to discover which ticket ids exist.
  if (!ticket) throw ApiError.notFound('Ticket not found.');

  res.json({ success: true, ticket: present(ticket) });
}

/**
 * The assignment trail for one ticket, oldest first.
 *
 * Reading it is exactly the right to read the ticket, so there is no second
 * rule to keep in step - and nothing in it is anything the reader could not
 * already see on the ticket itself.
 */
export async function listAssignments(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.badRequest('Invalid ticket id.');

  const ticket = await Ticket.findOne({
    _id: req.params.id,
    ...visibilityFilter(req.user),
  }).select('_id');

  if (!ticket) throw ApiError.notFound('Ticket not found.');

  const trail = await TicketAssignment.find({ ticket: ticket._id }).sort({ createdAt: 1 });

  res.json({
    success: true,
    assignments: trail.map((entry) => ({
      id: String(entry._id),
      // Paired by position: the ids and the names were written together.
      from: (entry.from ?? []).map((id, index) => ({
        id: String(id),
        name: entry.fromNames?.[index] ?? '',
      })),
      to: (entry.to ?? []).map((id, index) => ({
        id: String(id),
        name: entry.toNames?.[index] ?? '',
      })),
      // What the mover was at the time, not what they are now.
      by: { id: entry.by ? String(entry.by) : null, name: entry.byName, role: entry.byRole },
      kind: entry.kind,
      createdAt: entry.createdAt,
    })),
  });
}

/**
 * Works a ticket: status, who holds it, and the two dates.
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
    assignees,
    priority,
    subject,
    description,
    requestType,
    project,
  } = req.body ?? {};

  // Status and who holds it are how a department works a ticket: theirs alone.
  if (!worksIt && (status !== undefined || assignees !== undefined)) {
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
    assignees: (ticket.assignees ?? []).map(String).sort().join(','),
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

  if (requestType !== undefined) ticket.requestType = requestType?.trim() ?? '';

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

  /**
   * Handing it on. Whoever works the ticket may pass it to anyone else in the
   * department, and so may the people they pass it to - the right comes from
   * working the ticket, not from being one of its holders, so a head is not a
   * bottleneck and a queue does not stall on one person's absence.
   *
   * Remembered here rather than read back afterwards, because the trail needs
   * the names of whoever it moved away from.
   */
  let handedFrom = null;
  let handedTo = null;

  if (assignees !== undefined) {
    if (!Array.isArray(assignees)) throw ApiError.badRequest('Assignees must be a list.');

    const held = (ticket.assignees ?? []).map(String);
    const wanted = [...new Set(assignees.filter(Boolean).map(String))];

    // Once a ticket sits with somebody it stays with somebody: it is handed
    // on, never dropped. Tickets raised before that rule can stay empty.
    if (wanted.length === 0 && held.length > 0) {
      throw ApiError.badRequest(
        'A ticket has to sit with someone. Hand it to another person instead.',
      );
    }

    const people = [];
    for (const userId of wanted) {
      if (!mongoose.isValidObjectId(userId)) throw ApiError.badRequest('Invalid assignee.');

      // eslint-disable-next-line no-await-in-loop
      const candidate = await User.findById(userId).select('name role memberships');
      const belongs =
        candidate &&
        (MANAGER_ROLES.includes(candidate.role) ||
          candidate.roleInDepartment(ticket.department));

      if (!belongs) throw ApiError.badRequest('That person is not in this department.');
      people.push(candidate);
    }

    const moved = held.join(',') !== people.map((person) => String(person._id)).sort().join(',');
    if (moved) {
      handedFrom = await User.find({ _id: { $in: ticket.assignees ?? [] } }).select('name');
      handedTo = people;
    }
    ticket.assignees = people.map((person) => person._id);
  }

  await ticket.save();

  if (handedTo) {
    await recordAssignment({ ticket, from: handedFrom ?? [], to: handedTo, actor: req.user });
  }

  const populated = await Ticket.findById(ticket._id)
    .populate(WITH_DEPARTMENT)
    .populate('raisedBy', 'name email')
    .populate(WITH_FROM_DEPARTMENTS)
    .populate('assignees', 'name email')
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
  const nowAssignees = (populated.assignees ?? []).map((person) => String(person._id)).sort();
  if (before.assignees !== nowAssignees.join(',')) {
    changes.push(
      nowAssignees.length > 0
        ? `assigned to ${populated.assignees.map((person) => person.name).join(', ')}`
        : 'unassigned',
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
