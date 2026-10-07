import mongoose from 'mongoose';

import ApiError from '../utils/ApiError.js';
import { cleanFilename } from '../utils/fileName.js';
import { timings } from '../utils/timings.js';
import {
  buildTicketKey,
  createDownloadUrl,
  createUploadUrl,
  describeObject,
  isConfigured as storageReady,
  readObject,
  StorageUnavailable,
  TICKET_FILE,
  ticketKeyPrefixFor,
  validateTicketUpload,
} from '../services/storage.js';
import { zipStore } from '../services/zip.js';
import Activity from '../models/Activity.js';
import Department from '../models/Department.js';
import Message from '../models/Message.js';
import Notification from '../models/Notification.js';
import Ticket, {
  APPROVAL_WINDOW_MS,
  APPROVAL_WINDOW_TEXT,
  CLOSED_STATUSES,
  NOT_LATE_STATUSES,
  OVERDUE,
  RESOLVED,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
} from '../models/Ticket.js';
import { pastDue, statusOf } from '../services/overdue.js';
import HandoverRequest from '../models/HandoverRequest.js';
import TicketAssignment from '../models/TicketAssignment.js';
import Unit from '../models/Unit.js';
import User, { MANAGER_ROLES } from '../models/User.js';
import { record } from '../services/activity.js';
import { recordAssignment } from '../services/assignment.js';
import { assignsDirectly } from './handover.controller.js';
import { postSystemMessage } from '../services/chat.js';
import {
  canWorkOn,
  departmentIdsOf,
  departmentsHeadedOn,
  headedDepartmentIds,
  inTicketDepartments,
  isRaiser,
  oversightFilter,
  visibilityFilter,
} from '../services/ticketAccess.js';
import { listCommitments, recordCommitment } from '../services/commitment.js';
import {
  notifyApprovalAnswered,
  notifyApprovalRequested,
  notifyEscalated,
  notifyEscalationHandled,
  notifyNewTicket,
  notifyTicketDeleted,
  notifyTicketEdited,
  notifyTicketUpdated,
} from '../services/notify.js';

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

/**
 * What a person is loaded with wherever a ticket shows them: enough to name
 * them, and their roles, so the title beside their name can be the one that
 * fits this ticket.
 */
const PERSON_FIELDS = 'name email designation memberships';

/**
 * Fills in the departments, people and units a set of tickets points at.
 *
 * Mongoose runs one query per populated path, and each of those is a separate
 * round trip to a database that is a third of a second away - so a list of
 * tickets was spending two or three seconds fetching five short lists. This
 * asks for all of them at once instead: one query for the departments, one for
 * the people, one for the units, in parallel.
 *
 * The result is shaped exactly like a populated document, so `present` cannot
 * tell the difference.
 */
async function hydrate(tickets) {
  if (tickets.length === 0) return tickets;

  const departmentIds = new Set();
  const userIds = new Set();

  for (const ticket of tickets) {
    if (ticket.department) departmentIds.add(String(ticket.department));
    for (const item of ticket.departments ?? []) departmentIds.add(String(item));
    for (const item of ticket.fromDepartments ?? []) departmentIds.add(String(item));
    if (ticket.raisedBy) userIds.add(String(ticket.raisedBy));
    for (const person of ticket.assignees ?? []) userIds.add(String(person));
    if (ticket.committedBy) userIds.add(String(ticket.committedBy));
  }

  const [departments, users, units] = await Promise.all([
    Department.find({ _id: { $in: [...departmentIds] } })
      .select('name code unit')
      .lean(),
    User.find({ _id: { $in: [...userIds] } })
      .select(PERSON_FIELDS)
      .lean(),
    // Every unit rather than the ones referenced: the collection holds a
    // handful of rows, and asking for all of them saves waiting for the
    // departments to come back first.
    Unit.find({}).select('name code').lean(),
  ]);

  const unitById = new Map(units.map((unit) => [String(unit._id), unit]));
  const departmentById = new Map(
    departments.map((department) => [
      String(department._id),
      { ...department, unit: unitById.get(String(department.unit)) ?? department.unit },
    ]),
  );
  const userById = new Map(users.map((user) => [String(user._id), user]));

  /*
   * A ticket keeps the department ids it was raised to. A department deleted
   * since - or deleted and made again under the same name - leaves those ids
   * pointing at nothing, and the people on the ticket belonging somewhere it
   * does not name. Shown as stored, that is a row of dashes with everybody
   * piled under whichever department is left.
   *
   * So what is shown is what is true now: the departments that still exist,
   * then, for anybody on it who is in none of those, the department they are
   * in today. Nothing stored changes - scripts/repair-ticket-departments.js
   * does that - so this costs one more query only when a ticket needs it.
   */
  const rolesOf = (person) => (userById.get(String(person))?.memberships ?? []).map((role) => String(role.department));
  const uncovered = new Set();
  for (const ticket of tickets) {
    const live = departmentIdsOf(ticket).filter((id) => departmentById.has(id));
    for (const person of ticket.assignees ?? []) {
      const roles = rolesOf(person);
      if (roles.some((id) => live.includes(id))) continue;
      for (const id of roles) if (!departmentById.has(id)) uncovered.add(id);
    }
  }
  if (uncovered.size > 0) {
    const more = await Department.find({ _id: { $in: [...uncovered] } })
      .select('name code unit')
      .lean();
    for (const department of more) {
      departmentById.set(String(department._id), {
        ...department,
        unit: unitById.get(String(department.unit)) ?? department.unit,
      });
    }
  }

  /** The departments to show for one ticket, the lead first. */
  const shownFor = (ticket) => {
    const shown = departmentIdsOf(ticket).filter((id) => departmentById.has(id));
    for (const person of ticket.assignees ?? []) {
      const roles = rolesOf(person);
      if (roles.length === 0 || roles.some((id) => shown.includes(id))) continue;
      const theirs = roles.find((id) => departmentById.has(id));
      if (theirs) shown.push(theirs);
    }
    // Nothing left to show at all: keep what is stored rather than nothing.
    return shown.length > 0 ? shown : departmentIdsOf(ticket);
  };

  const asDepartment = (value) => departmentById.get(String(value)) ?? value;
  const asUser = (value) => userById.get(String(value)) ?? value;

  return tickets.map((ticket) => {
    const shown = shownFor(ticket);
    const leadLives = ticket.department && departmentById.has(String(ticket.department));
    return {
    ...ticket,
    department: leadLives || !shown[0] ? (ticket.department ? asDepartment(ticket.department) : ticket.department) : asDepartment(shown[0]),
    departments: shown.map(asDepartment),
    fromDepartments: (ticket.fromDepartments ?? []).map(asDepartment),
    raisedBy: ticket.raisedBy ? asUser(ticket.raisedBy) : ticket.raisedBy,
    assignees: (ticket.assignees ?? []).map(asUser),
    committedBy: ticket.committedBy ? asUser(ticket.committedBy) : ticket.committedBy,
    };
  });
}

/** The same, for a single ticket. */
async function hydrateOne(ticket) {
  const [filled] = await hydrate([ticket]);
  return filled;
}

/**
 * A person's title, in the department this ticket asks it of.
 *
 * Designation is per role - the HR Executive in one unit is the Payroll Lead
 * in another - so there is no single answer to "what is this person". On a
 * ticket there is: the raiser is what they are in the department they raised
 * from, and whoever works it is what they are in the department working it.
 * Failing that, any title they hold says more than none; an admin, who holds
 * no roles, carries theirs on the account.
 */
function titleIn(person, departmentIds) {
  if (!person || typeof person !== 'object') return '';

  const wanted = new Set(departmentIds.filter(Boolean).map(String));
  const roles = person.memberships ?? [];

  const here = roles.find(
    (role) => wanted.has(String(role.department?._id ?? role.department)) && role.designation,
  );
  if (here) return here.designation;
  if (person.designation) return person.designation;
  return roles.find((role) => role.designation)?.designation ?? '';
}

/** A populated unit, flattened to what the client reads. */
function presentUnit(unit) {
  if (!unit) return null;
  return typeof unit === 'object' && unit.name
    ? { id: String(unit._id), name: unit.name, code: unit.code }
    : { id: String(unit) };
}

function present(ticket, { awaiting } = {}) {
  const toId = String(ticket.department?._id ?? ticket.department ?? '');
  /** Every department it is shared with, the lead first. */
  const toIds = departmentIdsOf(ticket);
  const fromIds = (ticket.fromDepartments ?? []).map((item) => String(item?._id ?? item));

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
    // What is stored is what a person last set; what is sent is that, unless
    // the deadline has since made it late.
    status: statusOf(ticket),
    /**
     * Stored as In Progress - true for a late one shown as Overdue too. Its
     * due date can then only come closer; see updateTicket.
     */
    underWay: ticket.status === 'In Progress',
    project: ticket.project,
    deadline: ticket.deadline,
    committedDeadline: ticket.committedDeadline ?? null,
    committedBy: populated(ticket.committedBy)
      ? {
          id: String(ticket.committedBy._id),
          name: ticket.committedBy.name,
          designation: titleIn(ticket.committedBy, toIds),
        }
      : null,
    committedAt: ticket.committedAt ?? null,
    /** Why the current promise is the date it is. Empty when none was made. */
    committedReason: ticket.committedReason ?? '',
    /** Why it was called off. Empty unless it is Cancelled. */
    cancelReason: ticket.cancelReason ?? '',
    cancelledByName: ticket.cancelledByName ?? '',
    cancelledAt: ticket.cancelledAt ?? null,
    /**
     * The sign-off, when there is one. `approvalDueAt` is set only while the
     * ticket is Resolved and says when it completes itself unanswered.
     */
    resolvedAt: ticket.resolvedAt ?? null,
    resolvedByName: ticket.resolvedByName ?? '',
    approvalDueAt: ticket.approvalDueAt ?? null,
    approvedByName: ticket.approvedByName ?? '',
    completedAt: ticket.completedAt ?? null,
    rejectedReason: ticket.rejectedReason ?? '',
    rejectedByName: ticket.rejectedByName ?? '',
    rejectedAt: ticket.rejectedAt ?? null,
    /** Put in front of the super admin: null when it never has been. */
    escalation: ticket.escalationStatus
      ? {
          status: ticket.escalationStatus,
          reason: ticket.escalationReason ?? '',
          byId: ticket.escalatedBy ? String(ticket.escalatedBy?._id ?? ticket.escalatedBy) : null,
          byName: ticket.escalatedByName ?? '',
          at: ticket.escalatedAt ?? null,
          handledAt: ticket.escalationHandledAt ?? null,
          handledByName: ticket.escalationHandledByName ?? '',
          note: ticket.escalationNote ?? '',
          count: ticket.escalationCount ?? 1,
        }
      : null,
    department: populated(department)
      ? {
          id: String(department._id),
          name: department.name,
          code: department.code,
          unit: presentUnit(department.unit),
        }
      : { id: String(department) },
    /**
     * Every department the ticket is shared with, the lead first. One entry
     * for a ticket that went to a single department.
     */
    departments: (ticket.departments?.length ? ticket.departments : [department])
      .filter(Boolean)
      .map((item) =>
        populated(item)
          ? { id: String(item._id), name: item.name, code: item.code, unit: presentUnit(item.unit) }
          : { id: String(item) },
      ),
    fromDepartments: (ticket.fromDepartments ?? []).map((item) =>
      populated(item)
        ? { id: String(item._id), name: item.name, code: item.code, unit: presentUnit(item.unit) }
        : { id: String(item) },
    ),
    raisedBy: populated(raisedBy)
      ? {
          id: String(raisedBy._id),
          name: raisedBy.name,
          email: raisedBy.email,
          // What they are in the department they asked from.
          designation: titleIn(raisedBy, fromIds),
        }
      : { id: String(raisedBy) },
    // What level this came from: 'superadmin', 'admin' or 'user'.
    raisedByRole: ticket.raisedByRole,
    assignees: (ticket.assignees ?? []).map((person) =>
      populated(person)
        ? {
            id: String(person._id),
            name: person.name,
            // What they are in the department doing the work.
            designation: titleIn(person, toIds),
            /** Which of the ticket's departments they hold it for. */
            departmentId:
              toIds.find((id) =>
                (person.memberships ?? []).some(
                  (role) => String(role.department?._id ?? role.department) === id,
                ),
              ) ?? toId,
          }
        : { id: String(person) },
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
    /**
     * Somebody has asked this particular reader to take it on and is waiting
     * for an answer. Per-viewer, so it is computed where the request is, not
     * stored on the ticket.
     */
    awaitingMe: Boolean(awaiting?.has(String(ticket._id))),
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

  for (const entry of input) {
    const key = entry?.key;
    if (typeof key !== 'string' || !key) throw ApiError.badRequest('An upload key is missing.');
    if (!key.startsWith(prefix)) throw ApiError.badRequest('That upload is not yours to attach.');
  }

  /**
   * Every file is inspected at once rather than one after the next.
   *
   * The bucket is a long way from this server - a single HEAD costs most of a
   * second - so three attachments used to add nearly two seconds to raising a
   * ticket, spent waiting in turn for answers that never depended on each
   * other.
   */
  const described = await Promise.all(
    input.map(async (entry) => {
      try {
        return await describeObject(entry.key);
      } catch (error) {
        if (error instanceof StorageUnavailable) throw ApiError.unavailable(error.message);
        throw ApiError.badRequest('An upload did not finish. Try attaching it again.');
      }
    }),
  );

  return input.map((entry, index) => {
    const object = described[index];
    const problem = validateTicketUpload({ contentType: object.contentType, size: object.size });
    if (problem) throw ApiError.badRequest(problem);

    return {
      key: entry.key,
      // The name it was uploaded with, not the random key it is stored under:
      // it is what the raiser will type when they come looking for it.
      filename: cleanFilename(entry.filename),
      mimeType: object.contentType,
      size: object.size,
      uploadedBy: req.user._id,
      uploadedAt: new Date(),
    };
  });
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

  const ticket = await Ticket.findOne({ _id: req.params.id, ...oversightFilter(req.user) });
  if (!ticket) throw ApiError.notFound('Ticket not found.');

  const file = (ticket.attachments ?? [])[Number(req.params.index)];
  if (!file) throw ApiError.notFound('Attachment not found.');

  if (!storageReady()) throw ApiError.unavailable('File storage is not configured yet.');

  try {
    // helmet marks every response same-origin, which stops the app - served
    // from another origin - from showing this as an <img>. The redirect only
    // hands out a link this person could already open, so it may be embedded.
    res.set('Cross-Origin-Resource-Policy', 'cross-origin');

    // ?save=1 is the download button; without it the same URL is what the
    // thumbnails and the lightbox read, and those must stay viewable.
    const saveAs = req.query.save ? file.filename || 'attachment' : undefined;
    res.redirect(await createDownloadUrl(file.key, { saveAs }));
  } catch (error) {
    if (error instanceof StorageUnavailable) throw ApiError.unavailable(error.message);
    throw error;
  }
}

/**
 * Every file on the request, as one zip.
 *
 * Downloading five photos one at a time means five clicks and five trips
 * through the lightbox. This reads the objects here and packs them, so the
 * browser is handed a single file with the ticket's number on it.
 *
 * Unlike a single attachment there is no redirect to hide behind: the bytes
 * pass through this worker. That is bounded by what a request may carry -
 * five files of 10 MB - and is why it is not offered for anything larger.
 */
export async function downloadAttachmentsArchive(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.badRequest('Invalid ticket id.');

  const ticket = await Ticket.findOne({ _id: req.params.id, ...oversightFilter(req.user) });
  if (!ticket) throw ApiError.notFound('Ticket not found.');

  const files = ticket.attachments ?? [];
  if (files.length === 0) throw ApiError.notFound('This request has no files.');

  if (!storageReady()) throw ApiError.unavailable('File storage is not configured yet.');

  let archive;
  try {
    const entries = [];
    for (const file of files) {
      // Sequential: five small objects, and a burst of parallel reads only
      // trades a few milliseconds for five times the memory in flight.
      // eslint-disable-next-line no-await-in-loop
      const body = await readObject(file.key);
      entries.push({
        name: file.filename || `attachment-${entries.length + 1}`,
        body,
        modified: file.uploadedAt,
      });
    }
    archive = zipStore(entries);
  } catch (error) {
    if (error instanceof StorageUnavailable) throw ApiError.unavailable(error.message);
    throw error;
  }

  res.set('Content-Type', 'application/zip');
  res.set('Content-Disposition', `attachment; filename="${ticket.number}-files.zip"`);
  res.set('Content-Length', String(archive.length));
  res.send(archive);
}

export async function createTicket(req, res) {
  // Reported back in Server-Timing, so a slow raise can be read off the
  // browser's own network panel rather than guessed at.
  const clock = timings(res);

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
  if (beforeToday(deadline)) throw ApiError.badRequest('The deadline cannot be in the past.');
  if (priority && !TICKET_PRIORITIES.includes(priority)) {
    throw ApiError.badRequest(`Priority must be one of: ${TICKET_PRIORITIES.join(', ')}.`);
  }

  /**
   * Everything the answer needs, asked for at once.
   *
   * The departments being asked, the departments being asked *from*, and the
   * people named on the form - three questions that do not depend on each
   * other, and used to be three waits on a database a long way away.
   */
  const wantedPeople = [
    ...new Set(
      Object.values(assignees && typeof assignees === 'object' && !Array.isArray(assignees) ? assignees : {})
        .flatMap((picked) => (Array.isArray(picked) ? picked : [picked]))
        .filter((id) => id && mongoose.isValidObjectId(id))
        .map(String),
    ),
  ];

  const fromWanted = [...new Set((fromDepartments ?? []).filter(Boolean).map(String))].filter((id) =>
    mongoose.isValidObjectId(id),
  );

  const [targets, fromDocs, namedPeople] = await Promise.all([
    // Populated here so the answer can be built without reading the rows back.
    Department.find({ _id: { $in: targetIds }, isActive: true }).populate('unit', 'name code'),
    Department.find({ _id: { $in: fromWanted } })
      .select('name code unit')
      .populate('unit', 'name code')
      .lean(),
    wantedPeople.length > 0 ? User.find({ _id: { $in: wantedPeople } }) : [],
  ]);

  const peopleById = new Map(namedPeople.map((person) => [String(person._id), person]));
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

        // Work is something somebody hands you. Putting your own name on a
        // request is not asking for it to be done - it is doing it yourself,
        // which needs no ticket.
        if (String(userId) === String(req.user._id)) {
          throw ApiError.badRequest('You cannot assign a ticket to yourself.');
        }
      }

      for (const userId of wanted) {
        const candidate = peopleById.get(String(userId));
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

  /*
   * Every department being asked has to be asked of somebody.
   *
   * A request addressed to a queue rather than a person is one everybody
   * assumes a colleague has picked up, and one submit can reach several
   * departments - so it is checked per department, not once for the batch. A
   * single name against three of them still leaves two unaddressed.
   */
  const unaddressed = targets.filter((target) => !assignedTo.has(String(target._id)));
  if (unaddressed.length > 0) {
    throw ApiError.badRequest(
      `Name somebody to pick this up in ${unaddressed.map((target) => target.name).join(', ')}.`,
    );
  }

  // You may only raise on behalf of a department you actually belong to.
  const fromIds = [...new Set((fromDepartments ?? []).filter(Boolean).map(String))];
  const mine = new Set((req.user.memberships ?? []).map((m) => String(m.department)));
  const stranger = fromIds.find((id) => !mine.has(id));
  if (stranger) throw ApiError.badRequest('You can only raise on behalf of your own departments.');

  clock.step('validate');

  // Checked against the bucket before anything is written: a ticket must not
  // end up pointing at an upload that never landed.
  const attachments = await resolveAttachments(req);
  clock.step('attachments');

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

  /*
   * One ticket, however many departments are asked: the lead is the first one
   * picked, and every department is on it. Each one's people hold it together,
   * so there is one number, one status, one thread and one sign-off - asking
   * IT and Pharmacy for the same laptop is one request, not two.
   *
   * Somebody named for two of the departments is on it once.
   */
  const everyone = [
    ...new Map(
      targets
        .flatMap((target) => assignedTo.get(String(target._id)) ?? [])
        .map((id) => [String(id), id]),
    ).values(),
  ];
  const created = [
    await Ticket.create({
      ...shared,
      department: targets[0]._id,
      departments: targets.map((target) => target._id),
      assignees: everyone,
    }),
  ];

  // One parallel step for every reference instead of a populate per path -
  // the same reason the queues stopped using them.
  clock.step('insert');

  /**
   * Built from what is already in hand rather than read back.
   *
   * Every reference a new ticket holds was fetched a moment ago to check it:
   * the department it goes to, the ones it is raised from, the people on it -
   * and the person raising it is the caller. Asking the database to hand them
   * back was a round trip spent learning nothing new.
   */
  const departmentById = new Map(targets.map((target) => [String(target._id), target]));
  // With their roles, so the title beside their name is the one they hold in
  // the department they are raising from.
  const raiser = {
    _id: req.user._id,
    name: req.user.name,
    email: req.user.email,
    designation: req.user.designation,
    memberships: req.user.memberships,
  };

  const populated = created.map((ticket) => ({
    ...ticket.toObject(),
    department: departmentById.get(String(ticket.department)) ?? ticket.department,
    departments: (ticket.departments ?? []).map((id) => departmentById.get(String(id)) ?? id),
    fromDepartments: fromDocs,
    raisedBy: raiser,
    assignees: (ticket.assignees ?? []).map((id) => peopleById.get(String(id)) ?? id),
    committedBy: null,
  }));

  clock.step('assemble');

  const tickets = populated.map(present);

  // The ticket exists now, and that is all the person raising it is waiting
  // to hear - so they are told before the bookkeeping below, not after it.
  clock.send();
  res.status(201).json({ success: true, tickets, ticket: tickets[0] });

  /**
   * The log, the assignment trail, the opening line of the thread and the
   * bells. None of them depends on another, and none of them changes the
   * answer - so they run together, after the reply has gone. Each one already
   * swallows its own failures; the catch is for anything that slips past.
   */
  Promise.all(
    populated.flatMap((ticket) => [
      record({
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
      }),
      recordAssignment({
        ticket,
        from: [],
        to: ticket.assignees ?? [],
        actor: req.user,
        kind: 'raised',
      }),
      // The thread opens with the same line a group chat opens with: who
      // started it. Everything said afterwards has something to follow.
      postSystemMessage({
        ticket,
        actor: req.user,
        event: 'raised',
        side: 'raiser',
        body: `raised this ticket to ${
          ticket.departments.length > 1
            ? `${ticket.departments
                .slice(0, -1)
                .map((item) => item.name)
                .join(', ')} and ${ticket.departments.at(-1).name}`
            : ticket.department.name
        }`,
      }),
      notifyNewTicket({ ticket, actor: req.user }),
    ]),
  ).catch((error) => console.error('After-create bookkeeping failed:', error.message));
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

/**
 * `scope=mine` for what I raised, `scope=assigned` for my departments' queue,
 * `scope=all` for the whole picture.
 *
 * The last one is a narrower audience rather than a wider filter: a manager
 * oversees the workspace and a head runs a department, so those two get a view
 * of everything in their reach. Everyone else is refused it outright rather
 * than quietly handed their own tickets back.
 */
export async function listTickets(req, res) {
  const { scope, status, department, priority } = req.query;

  let filter;

  if (scope === 'escalated') {
    // The super admin's own page: every ticket that has ever been put in front
    // of them, open or dealt with. Nobody else has one.
    if (req.user.role !== 'superadmin') {
      throw ApiError.forbidden('Only the super admin sees escalations.');
    }
    filter = { escalationStatus: { $in: ['open', 'handled'] } };
  } else if (scope === 'all') {
    if (MANAGER_ROLES.includes(req.user.role)) {
      // Nothing to narrow by: a manager already sees every department.
      filter = {};
    } else {
      const departments = (req.user.memberships ?? []).map(
        (membership) => membership.department,
      );
      const headed = headedDepartmentIds(req.user);

      /*
       * Everything the departments this person belongs to have been asked to
       * do - whoever in them holds it, so a department's two heads see each
       * other's tickets - and everything they asked of anyone themselves.
       *
       * A head also sees what their department asked of others: every ticket
       * raised from a department they run, by a fellow head or anyone on the
       * team. They answer for those requests as much as for their queue. Only
       * the departments they head - a team member elsewhere does not see that
       * team's outgoing requests. Reading only: working such a ticket still
       * belongs to the department it went to.
       *
       * Their own requests are marked as theirs on the page and can be
       * filtered in or out there, so the one list holds all of it.
       */
      filter =
        departments.length > 0
          ? {
              $or: [
                { departments: { $in: departments } },
                { department: { $in: departments } },
                { raisedBy: req.user._id },
                // On them by name, whichever department it is filed under.
                { assignees: req.user._id },
                ...(headed.length > 0 ? [{ fromDepartments: { $in: headed } }] : []),
              ],
            }
          : // Nobody's department: what is on them by name, and what they asked for.
            { $or: [{ assignees: req.user._id }, { raisedBy: req.user._id }] };
    }
  } else {
    filter = { ...visibilityFilter(req.user) };
  }

  if (scope === 'mine') filter.raisedBy = req.user._id;
  if (scope === 'assigned') {
    /*
     * What is on this person by name, plus what somebody is asking them to
     * take on.
     *
     * A department's whole queue lives on All Tickets; this page answers the
     * narrower question people actually open it for - what is on my desk. An
     * unanswered request belongs there too: it is waiting on this person, and
     * a request they cannot find is one they will not answer.
     *
     * Combined under $and so the visibility filter above keeps its own $or.
     */
    const asked = await HandoverRequest.find({
      to: req.user._id,
      status: 'pending',
    }).distinct('ticket');

    filter.$and = [
      ...(filter.$and ?? []),
      { $or: [{ assignees: req.user._id }, { _id: { $in: asked } }] },
    ];
  }

  if (status) {
    /*
     * Overdue is not in the collection, so asking for it is asking about the
     * date instead - and asking for anything else has to exclude the tickets
     * the date has taken away from it.
     */
    if (status === OVERDUE) {
      filter.$and = [...(filter.$and ?? []), { status: { $nin: NOT_LATE_STATUSES } }, pastDue()];
    } else if (NOT_LATE_STATUSES.includes(status)) {
      filter.status = status;
    } else {
      filter.$and = [...(filter.$and ?? []), { status }, pastDue(false)];
    }
  }
  if (priority) filter.priority = priority;
  if (department && mongoose.isValidObjectId(department)) {
    filter.$and = [
      ...(filter.$and ?? []),
      { $or: [{ departments: department }, { department }] },
    ];
  }

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

  const tickets = await Ticket.find(filter).sort({ createdAt: -1 }).lean();

  // Which of these are waiting on an answer from the person reading them.
  const awaiting = new Set(
    (
      await HandoverRequest.find({
        to: req.user._id,
        status: 'pending',
        ticket: { $in: tickets.map((ticket) => ticket._id) },
      }).distinct('ticket')
    ).map(String),
  );

  res.json({
    success: true,
    tickets: (await hydrate(tickets)).map((ticket) => present(ticket, { awaiting })),
  });
}

/**
 * Requests of mine that are resolved and waiting for my sign-off.
 *
 * Asked for by the banner every page carries, so it is its own small query
 * rather than a filter over everything the person can see: it has to be cheap
 * enough to ask often, and it only ever concerns their own requests.
 */
export async function listApprovals(req, res) {
  const tickets = await Ticket.find({ raisedBy: req.user._id, status: RESOLVED })
    .sort({ approvalDueAt: 1 })
    .limit(50)
    .lean();

  res.json({
    success: true,
    tickets: (await hydrate(tickets)).map((ticket) => present(ticket)),
  });
}

/** Long enough to say what is missing, short enough for a bell. */
const MAX_REJECT_REASON = 400;

/**
 * The requester's answer to a resolved ticket: done, or not yet.
 *
 * Theirs alone - they asked for the work, so they are the one who says it was
 * delivered. Approving completes it; sending it back returns it to In Progress
 * with the reason, so whoever is doing it knows what is still missing.
 *
 * The change is made only if the ticket is still Resolved at that moment, so
 * an answer racing the 48-hour sweep cannot complete a ticket twice or reopen
 * one that has just completed.
 */
export async function answerApproval(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.badRequest('Invalid ticket id.');

  const ticket = await Ticket.findOne({ _id: req.params.id, ...visibilityFilter(req.user) })
    .select('raisedBy status resolvedBy');
  if (!ticket) throw ApiError.notFound('Ticket not found.');

  if (!isRaiser(req.user, ticket)) {
    throw ApiError.forbidden('Only the person who raised this request can approve it.');
  }

  const { decision, reason } = req.body ?? {};
  if (decision !== 'approve' && decision !== 'reject') {
    throw ApiError.badRequest('Answer with approve or reject.');
  }

  const approved = decision === 'approve';
  const why = typeof reason === 'string' ? reason.trim() : '';
  if (!approved) {
    if (why.length < 3) {
      throw ApiError.badRequest('Say what is still missing, so they know what to fix.');
    }
    if (why.length > MAX_REJECT_REASON) {
      throw ApiError.badRequest(`Keep the reason under ${MAX_REJECT_REASON} characters.`);
    }
  }

  const now = new Date();
  const changes = approved
    ? {
        status: 'Completed',
        completedAt: now,
        approvedByName: req.user.name,
        approvalDueAt: null,
      }
    : {
        status: 'In Progress',
        rejectedReason: why,
        rejectedByName: req.user.name,
        rejectedAt: now,
        approvalDueAt: null,
      };

  const answered = await Ticket.findOneAndUpdate(
    { _id: ticket._id, status: RESOLVED },
    { $set: changes },
    { returnDocument: 'after' },
  ).lean();

  if (!answered) {
    const current = await Ticket.findById(ticket._id).select('status').lean();
    throw ApiError.conflict(
      current?.status === 'Completed'
        ? 'This request has already been completed.'
        : 'This request is no longer waiting for your approval.',
    );
  }

  const populated = await hydrateOne(answered);

  await postSystemMessage({
    ticket: populated,
    actor: req.user,
    event: approved ? 'approved' : 'rejected',
    side: 'raiser',
    body: approved ? 'approved the work - request completed' : `sent it back - ${why}`,
  });
  await record({
    actor: req.user,
    department: populated.department,
    action: approved ? 'ticket.approved' : 'ticket.rejected',
    summary: approved
      ? `approved ${populated.number} "${populated.subject}" - completed`
      : `sent ${populated.number} "${populated.subject}" back to In Progress - ${why}`,
    ticketNumber: populated.number,
  });
  await notifyApprovalAnswered({
    ticket: populated,
    actor: req.user,
    approved,
    reason: why,
    resolvedBy: ticket.resolvedBy,
  });

  res.json({ success: true, ticket: present(populated) });
}

/** Long enough to explain, short enough to read at a glance on the list. */
const MAX_ESCALATION_TEXT = 400;

/**
 * Puts a ticket in front of the super admin.
 *
 * Open to anybody who can see the ticket - the person who asked, or anyone in
 * the department working it - because the reason to escalate is that the
 * usual route has stopped working, and that can happen on either side. A
 * reason is required: the super admin opens this cold, and "escalated" on its
 * own tells them nothing about what is wrong.
 *
 * One open escalation at a time. Once the super admin marks it handled, it can
 * be raised again if the problem comes back.
 */
export async function escalateTicket(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.badRequest('Invalid ticket id.');

  if (req.user.role === 'superadmin') {
    throw ApiError.badRequest('You are the super admin - escalations already come to you.');
  }

  const ticket = await Ticket.findOne({ _id: req.params.id, ...visibilityFilter(req.user) })
    .select('status escalationStatus escalatedByName raisedBy')
    .lean();
  if (!ticket) throw ApiError.notFound('Ticket not found.');

  if (CLOSED_STATUSES.includes(ticket.status)) {
    throw ApiError.badRequest('This ticket is already closed, so there is nothing to escalate.');
  }
  if (ticket.escalationStatus === 'open') {
    throw ApiError.conflict(
      `Already escalated${ticket.escalatedByName ? ` by ${ticket.escalatedByName}` : ''}. The super admin has it.`,
    );
  }

  const why = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (why.length < 3) throw ApiError.badRequest('Say why this needs the super admin.');
  if (why.length > MAX_ESCALATION_TEXT) {
    throw ApiError.badRequest(`Keep the reason under ${MAX_ESCALATION_TEXT} characters.`);
  }

  // Only if nobody escalated it in the meantime: two people escalating at
  // once make one escalation, not two with one quietly overwritten.
  const escalated = await Ticket.findOneAndUpdate(
    { _id: ticket._id, escalationStatus: { $ne: 'open' } },
    {
      $set: {
        escalationStatus: 'open',
        escalatedAt: new Date(),
        escalatedBy: req.user._id,
        escalatedByName: req.user.name,
        escalationReason: why,
        escalationHandledAt: null,
        escalationHandledByName: '',
        escalationNote: '',
      },
      $inc: { escalationCount: 1 },
    },
    { returnDocument: 'after' },
  ).lean();

  if (!escalated) throw ApiError.conflict('Somebody has just escalated this. The super admin has it.');

  const populated = await hydrateOne(escalated);

  await postSystemMessage({
    ticket: populated,
    actor: req.user,
    event: 'escalated',
    side: isRaiser(req.user, ticket) ? 'raiser' : 'department',
    body: `escalated this to the super admin - ${why}`,
  });
  await record({
    actor: req.user,
    department: populated.department,
    action: 'ticket.escalated',
    summary: `escalated ${populated.number} "${populated.subject}" to the super admin - ${why}`,
    ticketNumber: populated.number,
  });
  await notifyEscalated({ ticket: populated, actor: req.user, reason: why });

  res.json({ success: true, ticket: present(populated) });
}

/**
 * The super admin closes an escalation, with an optional note saying what was
 * done. The ticket itself is left as it is - dealing with an escalation may
 * mean reassigning it, moving a date or a word with somebody, and those are
 * all done through the ticket as usual.
 */
export async function handleEscalation(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.badRequest('Invalid ticket id.');

  if (req.user.role !== 'superadmin') {
    throw ApiError.forbidden('Only the super admin can close an escalation.');
  }

  const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
  if (note.length > MAX_ESCALATION_TEXT) {
    throw ApiError.badRequest(`Keep the note under ${MAX_ESCALATION_TEXT} characters.`);
  }

  const before = await Ticket.findById(req.params.id).select('escalatedBy').lean();
  if (!before) throw ApiError.notFound('Ticket not found.');

  const handled = await Ticket.findOneAndUpdate(
    { _id: req.params.id, escalationStatus: 'open' },
    {
      $set: {
        escalationStatus: 'handled',
        escalationHandledAt: new Date(),
        escalationHandledByName: req.user.name,
        escalationNote: note,
      },
    },
    { returnDocument: 'after' },
  ).lean();

  if (!handled) throw ApiError.conflict('This escalation is not open any more.');

  const populated = await hydrateOne(handled);

  await postSystemMessage({
    ticket: populated,
    actor: req.user,
    event: 'escalation.handled',
    body: note ? `handled the escalation - ${note}` : 'handled the escalation',
  });
  await record({
    actor: req.user,
    department: populated.department,
    action: 'ticket.escalation_handled',
    summary: `handled the escalation on ${populated.number} "${populated.subject}"${note ? ` - ${note}` : ''}`,
    ticketNumber: populated.number,
  });
  await notifyEscalationHandled({
    ticket: populated,
    actor: req.user,
    escalatedBy: before.escalatedBy,
    note,
  });

  res.json({ success: true, ticket: present(populated) });
}

/** How many escalations are open: the number on the super admin's sidebar. */
export async function countEscalations(req, res) {
  if (req.user.role !== 'superadmin') {
    throw ApiError.forbidden('Only the super admin sees escalations.');
  }
  res.json({ success: true, open: await Ticket.countDocuments({ escalationStatus: 'open' }) });
}

/** An id off a field that may or may not have been populated. */
const idOf = (value) => String(value?._id ?? value ?? '');

/**
 * How a ticket touches the person reading the dashboard.
 *
 * `mine` is their own part in it - they raised it, it is on them, or somebody
 * is asking them to take it. `team` is a head's part: it sits in a queue they
 * run, or somebody in a department they run raised it. Both can hold at once,
 * and the dashboard says "yours" whenever `mine` does, because that outranks
 * being one of the team's.
 */
function relationOf(ticket, { meId, asked, headed }) {
  const mine = [];
  if (idOf(ticket.raisedBy) === meId) mine.push('raised');
  if ((ticket.assignees ?? []).some((person) => idOf(person) === meId)) mine.push('assigned');
  if (asked.has(idOf(ticket))) mine.push('asked');

  const team = [];
  if (headed.size > 0) {
    if (departmentIdsOf(ticket).some((id) => headed.has(id))) team.push('queue');
    if ((ticket.fromDepartments ?? []).some((item) => headed.has(idOf(item)))) team.push('raised');
  }

  return { mine, team };
}

/** How many lines of the feed the dashboard carries. */
const FEED_SIZE = 40;

/** How many of today's chat messages the dashboard carries. */
const TODAY_MESSAGES = 30;

/**
 * Where "today" starts for the reader. The browser sends its own midnight,
 * since the server's clock need not be in the reader's timezone; anything
 * missing or more than a day and a half off falls back to the server's.
 */
function startOfDayFrom(value) {
  const asked = value ? new Date(String(value)) : null;
  const fallback = new Date(new Date().toDateString());
  if (!asked || Number.isNaN(asked.getTime())) return fallback;
  return Math.abs(Date.now() - asked.getTime()) > 36 * 3_600_000 ? fallback : asked;
}

/** One line of a chat, short enough for a dashboard row. */
function presentChatLine(message, ticket, meId) {
  const body = message.body ?? '';
  return {
    id: String(message._id),
    ticketId: String(message.ticket),
    ticketNumber: ticket?.number ?? '',
    ticketSubject: ticket?.subject ?? '',
    author: { name: message.authorName, isMe: idOf(message.author) === meId },
    side: message.side,
    body: body.length > 160 ? `${body.slice(0, 157)}…` : body,
    attachment: message.attachment
      ? { kind: message.attachment.kind, filename: message.attachment.filename ?? '' }
      : null,
    createdAt: message.createdAt,
  };
}

/**
 * The dashboard, shaped by who is asking - one call for the whole page.
 *
 * Three readers, three reaches:
 *   - a member sees the tickets they are part of: raised, on them, or asked
 *     of them - and the updates on those, nobody else's;
 *   - a head sees all of that, plus every ticket in the queues they run and
 *     every ticket their own people raised elsewhere - their team's work in
 *     both directions - and the updates on all of it;
 *   - a manager sees the workspace.
 *
 * Each ticket says how it touches the reader (see relationOf), so the page
 * can tell a head which of their team's tickets are theirs personally.
 *
 * The same conditional-GET contract as the ticket list: a poll that finds
 * nothing moved costs a 304.
 */
export async function getDashboard(req, res) {
  const me = req.user;
  const meId = String(me._id);
  const manager = MANAGER_ROLES.includes(me.role);
  const headedIds = manager ? [] : headedDepartmentIds(me);
  const lens = manager ? 'manager' : headedIds.length > 0 ? 'head' : 'member';

  const askedIds = await HandoverRequest.find({ to: me._id, status: 'pending' }).distinct('ticket');

  let filter = {};
  if (!manager) {
    const reach = [{ raisedBy: me._id }, { assignees: me._id }, { _id: { $in: askedIds } }];
    if (headedIds.length > 0) {
      reach.push(
        { departments: { $in: headedIds } },
        { department: { $in: headedIds } },
        { fromDepartments: { $in: headedIds } },
      );
    }
    filter = { $or: reach };
  }

  // The feed follows the tickets: a line about a ticket outside this reach is
  // somebody else's business. A manager reads every ticket line there is.
  const reachIds = manager ? null : await Ticket.find(filter).distinct('_id');
  const feedFilter = manager
    ? { ticketNumber: { $ne: '' } }
    : { ticketNumber: { $in: await Ticket.find(filter).distinct('number') } };

  // Today's conversation on the same tickets: people's own lines, not the
  // system's, and not the ones taken back.
  const since = startOfDayFrom(req.query.since);
  const chatFilter = {
    // Older lines carry no kind at all, so "not a system line" rather than
    // "a text line".
    kind: { $ne: 'system' },
    deletedAt: null,
    createdAt: { $gte: since },
    ...(reachIds ? { ticket: { $in: reachIds } } : {}),
  };

  const [ticketTag, newestLine, newestMessage] = await Promise.all([
    fingerprint(filter),
    Activity.findOne(feedFilter).sort({ createdAt: -1 }).select('_id').lean(),
    Message.findOne(chatFilter).sort({ updatedAt: -1 }).select('updatedAt').lean(),
  ]);
  // Tickets, the newest line of the feed, today's chat, and the asks waiting
  // on this person: any of them moving is a different page.
  const chatTag = newestMessage ? new Date(newestMessage.updatedAt).getTime() : 0;
  const tag = `${ticketTag.slice(0, -1)}-${newestLine?._id ?? 0}-${chatTag}-${since.getTime()}-${askedIds.length}-${lens}"`;
  res.set('ETag', tag);
  res.set('Cache-Control', 'private, no-cache');

  const offered = (req.headers['if-none-match'] ?? '').split(',').map((value) => value.trim());
  if (offered.includes(tag)) {
    res.status(304).end();
    return;
  }

  const [tickets, lines, chat, headOf] = await Promise.all([
    Ticket.find(filter).sort({ createdAt: -1 }).lean(),
    Activity.find(feedFilter).sort({ createdAt: -1 }).limit(FEED_SIZE).lean(),
    Message.find(chatFilter).sort({ createdAt: -1 }).limit(TODAY_MESSAGES).lean(),
    headedIds.length > 0
      ? Department.find({ _id: { $in: headedIds } }).select('name code').lean()
      : [],
  ]);

  const asked = new Set(askedIds.map(String));
  const headed = new Set(headedIds.map(String));

  const presented = (await hydrate(tickets)).map((ticket) => ({
    ...present(ticket, { awaiting: asked }),
    relation: relationOf(ticket, { meId, asked, headed }),
  }));

  const byNumber = new Map(presented.map((ticket) => [ticket.number, ticket]));
  const byTicketId = new Map(presented.map((ticket) => [ticket.id, ticket]));

  res.json({
    success: true,
    lens,
    headOf: headOf.map((department) => ({
      id: String(department._id),
      name: department.name,
      code: department.code ?? '',
    })),
    tickets: presented,
    messages: chat.map((message) =>
      presentChatLine(message, byTicketId.get(String(message.ticket)), meId),
    ),
    activity: lines.map((line) => {
      const ticket = byNumber.get(line.ticketNumber);
      return {
        id: String(line._id),
        department: line.department
          ? { id: String(line.department), name: line.departmentName }
          : null,
        actor: { name: line.actorName, role: line.actorRole, isMe: idOf(line.actor) === meId },
        action: line.action,
        summary: line.summary,
        ticketNumber: line.ticketNumber,
        // Null once the ticket is gone: the line stays readable, not openable.
        ticketId: ticket?.id ?? null,
        mine: Boolean(ticket && ticket.relation.mine.length > 0),
        createdAt: line.createdAt,
      };
    }),
  });
}

export async function getTicket(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.badRequest('Invalid ticket id.');

  // Reading only, so a head may open what their team asked of others.
  const found = await Ticket.findOne({
    _id: req.params.id,
    ...oversightFilter(req.user),
  }).lean();

  const ticket = found ? await hydrateOne(found) : null;

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
    ...oversightFilter(req.user),
  }).select('_id');

  if (!ticket) throw ApiError.notFound('Ticket not found.');

  const [trail, events, touched, commitments] = await Promise.all([
    TicketAssignment.find({ ticket: ticket._id }).sort({ createdAt: 1 }),
    // Raising and handing over are already in the trail above, structurally
    // and with the names on them, so the lines describing those are left out
    // rather than told twice. What is left is what the trail cannot show: the
    // request itself being changed.
    Message.find({
      ticket: ticket._id,
      kind: 'system',
      event: {
        $in: [
          'edited',
          'resolved',
          'approved',
          'rejected',
          'auto-approved',
          'escalated',
          'escalation.handled',
        ],
      },
    })
      .select('event body authorName authorRole createdAt')
      .sort({ createdAt: 1 }),
    // What happened to the conversation itself. Read off the messages rather
    // than written twice: a line carries when it was corrected and when it was
    // withdrawn, so the history can be built from what is already there.
    Message.find({
      ticket: ticket._id,
      kind: { $ne: 'system' },
      $or: [{ editedAt: { $ne: null } }, { deletedAt: { $ne: null } }],
    })
      .select('authorName authorRole editedAt deletedAt deletedByName revisions')
      .sort({ createdAt: 1 }),
    // Every promise about when this will be done, and why each date was
    // given. Its own trail, so a date that moved three times reads as three
    // moves rather than one number that happens to be current.
    listCommitments(ticket._id),
  ]);

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
    commitments: commitments.map((entry) => ({
      id: String(entry._id),
      date: entry.date,
      previousDate: entry.previousDate,
      kind: entry.kind,
      reason: entry.reason,
      by: { name: entry.byName, role: entry.byRole },
      createdAt: entry.createdAt,
    })),
    /** Everything else that happened to it: raised, retitled, re-dated. */
    events: [
      ...events.map((entry) => ({
        id: String(entry._id),
        event: entry.event,
        body: entry.body,
        by: { name: entry.authorName, role: entry.authorRole },
        createdAt: entry.createdAt,
      })),
      ...touched.flatMap((message) => {
        const lines = [];

        if (message.editedAt) {
          lines.push({
            id: `${String(message._id)}-edited`,
            event: 'message.edited',
            body:
              message.revisions.length > 1
                ? `edited a message (${message.revisions.length} versions)`
                : 'edited a message',
            by: { name: message.authorName, role: message.authorRole },
            createdAt: message.editedAt,
          });
        }

        if (message.deletedAt) {
          lines.push({
            id: `${String(message._id)}-deleted`,
            event: 'message.deleted',
            body: 'withdrew a message',
            by: {
              name: message.deletedByName || message.authorName,
              role: message.authorRole,
            },
            createdAt: message.deletedAt,
          });
        }

        return lines;
      }),
    ],
  });
}

/**
 * Whether a date the client sent falls before today.
 *
 * Compared as calendar days, YYYY-MM-DD, because that is what the date pickers
 * send: a deadline of today is fine all day, whatever the hour.
 */
function beforeToday(value) {
  const day = typeof value === 'string' ? value.slice(0, 10) : new Date(value).toISOString().slice(0, 10);
  return day < new Date().toLocaleDateString('en-CA');
}

/** As many as one request may remove at once. A mistake should stay small. */
const MAX_DELETE = 200;

/**
 * How long somebody has to take back a ticket they raised.
 *
 * Long enough to undo a mistake - the wrong department, a duplicate, a subject
 * typed into the wrong window - and short enough that a department cannot have
 * built any work on it yet.
 */
export const DELETE_WINDOW_MS = 15 * 60 * 1000;

/** Whether this person may delete this particular ticket, and why not. */
export function deletableBy(user, ticket) {
  if (MANAGER_ROLES.includes(user.role)) return { allowed: true };

  const raiser = String(ticket.raisedBy?._id ?? ticket.raisedBy);
  if (raiser !== String(user._id)) {
    return { allowed: false, reason: `${ticket.number} is not yours to delete.` };
  }

  const age = Date.now() - new Date(ticket.createdAt).getTime();
  if (age > DELETE_WINDOW_MS) {
    return {
      allowed: false,
      reason: `${ticket.number} can only be taken back within ${
        DELETE_WINDOW_MS / 60000
      } minutes of raising it. Ask an admin to remove it.`,
    };
  }

  return { allowed: true };
}

/**
 * Removes tickets, and everything that only existed because of them: the
 * conversation, the assignment trail, and the bell entries pointing at them.
 *
 * The activity log is deliberately left alone and a line is added to it. It is
 * the workspace's record of what happened, and a ticket having been raised and
 * then deleted is part of what happened - erasing that would make the log lie
 * about a busy week.
 *
 * Two people may do it: a manager, at any time, and whoever raised the ticket,
 * for a short while after raising it.
 */
async function removeTickets(ids, actor, rawReason) {
  const valid = [...new Set(ids.filter((id) => mongoose.isValidObjectId(id)))];
  if (valid.length === 0) throw ApiError.badRequest('No ticket was named.');

  // Why it went is the one thing the department that was asked cannot work
  // out for themselves, so it is required and travels with the bell and the log.
  const reason = typeof rawReason === 'string' ? rawReason.trim() : '';
  if (reason.length < 3) throw ApiError.badRequest('Say why the ticket is being deleted.');
  if (reason.length > MAX_DELETE_REASON) {
    throw ApiError.badRequest(`Keep the reason under ${MAX_DELETE_REASON} characters.`);
  }
  if (valid.length > MAX_DELETE) {
    throw ApiError.badRequest(`Delete at most ${MAX_DELETE} tickets at a time.`);
  }

  const tickets = await Ticket.find({ _id: { $in: valid } })
    .populate('department', 'name')
    .select('number subject department raisedBy assignees createdAt');

  if (tickets.length === 0) throw ApiError.notFound('Ticket not found.');

  // All or nothing: a batch that would half-succeed leaves the person guessing
  // which half, so the first refusal stops the whole request.
  for (const ticket of tickets) {
    const verdict = deletableBy(actor, ticket);
    if (!verdict.allowed) throw ApiError.forbidden(verdict.reason);
  }

  const found = tickets.map((ticket) => ticket._id);

  await Message.deleteMany({ ticket: { $in: found } });
  await TicketAssignment.deleteMany({ ticket: { $in: found } });
  await Notification.deleteMany({ ticket: { $in: found } });
  await Ticket.deleteMany({ _id: { $in: found } });

  for (const ticket of tickets) {
    // eslint-disable-next-line no-await-in-loop
    await record({
      actor,
      department: ticket.department,
      action: 'ticket.deleted',
      summary: `deleted ${ticket.number} "${ticket.subject}" · reason: ${reason}`,
      ticketNumber: ticket.number,
    });
  }

  // The people who would otherwise go looking for it: whoever holds it, the
  // head of the department it was sent to, and the raiser when somebody else
  // removed it. Sent after the reply, like every other bell.
  for (const ticket of tickets) void notifyTicketDeleted({ ticket, actor, reason });

  return tickets;
}

/** Long enough for a sentence, short enough to read in a bell. */
const MAX_DELETE_REASON = 300;

/**
 * Hands a batch of tickets to the same people at once.
 *
 * Every ticket in the batch has to sit with the same department: an assignee
 * belongs to one, so "give these to Danish" only means something when all of
 * them are Danish's department's to begin with. The caller must be able to
 * work each of them, which is the same right that lets them reassign one.
 *
 * Each move is written to that ticket's own trail, so the history reads the
 * same whether the ticket was handed over on its own or as one of twenty.
 */
export async function reassignTickets(req, res) {
  const { ids, assignees, department: target } = req.body ?? {};

  if (!Array.isArray(ids)) throw ApiError.badRequest('Send the tickets as a list.');
  if (!Array.isArray(assignees)) throw ApiError.badRequest('Send the people as a list.');

  // Moving a ticket to another department is not working it: it takes it away
  // from the people who were, and hands it to people who never agreed to it.
  // That is a manager's call, not a department's.
  const moving = target !== undefined && target !== null && target !== '';
  if (moving && !MANAGER_ROLES.includes(req.user.role)) {
    throw ApiError.forbidden('Only an admin can move a ticket to another department.');
  }
  if (!moving && assignees.length === 0) {
    throw ApiError.badRequest('Choose at least one person to hand them to.');
  }

  // The same rule as a single ticket: handing work out means handing it to
  // somebody else.
  if (assignees.some((id) => String(id) === String(req.user._id))) {
    throw ApiError.badRequest('You cannot assign a ticket to yourself.');
  }

  const valid = [...new Set(ids.filter((id) => mongoose.isValidObjectId(id)))];
  if (valid.length === 0) throw ApiError.badRequest('No ticket was named.');
  if (valid.length > MAX_DELETE) {
    throw ApiError.badRequest(`Reassign at most ${MAX_DELETE} tickets at a time.`);
  }

  const tickets = await Ticket.find({ _id: { $in: valid }, ...visibilityFilter(req.user) });
  if (tickets.length === 0) throw ApiError.notFound('Ticket not found.');

  // A shared ticket has a head per department and a list per department, and
  // a batch hands everything to one set of people - so it is left out, and
  // reassigned from the ticket itself.
  const shared = tickets.find((ticket) => departmentIdsOf(ticket).length > 1);
  if (shared) {
    throw ApiError.badRequest(
      `${shared.number} is shared by several departments. Reassign it from the ticket itself.`,
    );
  }

  // All or nothing, so a half-applied batch never leaves somebody guessing
  // which half moved.
  const departments = new Set(tickets.map((ticket) => String(ticket.department)));
  if (departments.size > 1) {
    throw ApiError.badRequest(
      'These tickets sit with different departments. Reassign one department at a time.',
    );
  }

  const [fromDepartmentId] = [...departments];

  for (const ticket of tickets) {
    // The same two sides as a single ticket: the department that will do the
    // work, and the person who asked for it.
    if (!canWorkOn(req.user, ticket) && !isRaiser(req.user, ticket)) {
      throw ApiError.forbidden(`Only the receiving department can work ${ticket.number}.`);
    }
    if (!assignsDirectly(req.user, ticket)) {
      throw ApiError.forbidden(
        'Only the department head can reassign. Ask a colleague to take a ticket on instead.',
      );
    }
  }

  /**
   * Where they are going, and where the named people have to belong.
   *
   * Without a move that is simply where they already are, so the rest of this
   * reads the same either way.
   */
  let destination = null;
  if (moving) {
    if (!mongoose.isValidObjectId(target)) throw ApiError.badRequest('Invalid department.');

    destination = await Department.findOne({ _id: target, isActive: true });
    if (!destination) throw ApiError.badRequest('That department does not exist.');
  }

  const departmentId = destination ? String(destination._id) : fromDepartmentId;
  const changingDepartment = destination && String(destination._id) !== fromDepartmentId;

  const wanted = [...new Set(assignees.filter(Boolean).map(String))];
  const people = [];

  for (const userId of wanted) {
    if (!mongoose.isValidObjectId(userId)) throw ApiError.badRequest('Invalid assignee.');

    // eslint-disable-next-line no-await-in-loop
    const candidate = await User.findById(userId).select('name role memberships status');
    const belongs =
      candidate &&
      candidate.status !== 'suspended' &&
      (MANAGER_ROLES.includes(candidate.role) || candidate.roleInDepartment(departmentId));

    if (!belongs) {
      throw ApiError.badRequest(
        changingDepartment
          ? `That person is not in ${destination.name}.`
          : 'That person is not in this department.',
      );
    }
    people.push(candidate);
  }

  const held = people.map((person) => person._id);
  const named = people.map((person) => person.name).join(', ');

  const summary = changingDepartment
    ? `moved to ${destination.name}${named ? `, assigned to ${named}` : ''}`
    : `assigned to ${named}`;

  let moved = 0;

  for (const ticket of tickets) {
    const before = (ticket.assignees ?? []).map(String).sort().join(',');
    const after = held.map(String).sort().join(',');
    if (before === after && !changingDepartment) continue;

    // eslint-disable-next-line no-await-in-loop
    const from = await User.find({ _id: { $in: ticket.assignees ?? [] } }).select('name');

    // Whoever was holding it cannot keep holding it from another department,
    // so an unnamed move leaves it with the new department rather than with
    // people who can no longer see it.
    if (changingDepartment) {
      ticket.department = destination._id;
      ticket.departments = [destination._id];
    }
    ticket.assignees = held;
    // eslint-disable-next-line no-await-in-loop
    await ticket.save();
    moved += 1;

    // Only when the holders actually changed: a move with nobody named on
    // either side would otherwise leave "Nobody -> Nobody" in the history,
    // which is a line that says nothing. The system message below carries the
    // move itself.
    if (before !== after) {
      // eslint-disable-next-line no-await-in-loop
      await recordAssignment({ ticket, from, to: people, actor: req.user });
    }
    // eslint-disable-next-line no-await-in-loop
    await postSystemMessage({
      ticket,
      actor: req.user,
      event: 'assignment',
      body: changingDepartment
        ? `moved this to ${destination.name}${named ? ` and handed it to ${named}` : ''}`
        : `handed this to ${named}`,
    });

    // eslint-disable-next-line no-await-in-loop
    const populated = await Ticket.findById(ticket._id)
      .populate(WITH_DEPARTMENT)
      .populate({ ...WITH_DEPARTMENT, path: 'departments' })
      .populate('raisedBy', PERSON_FIELDS)
      .populate(WITH_FROM_DEPARTMENTS)
      .populate('assignees', PERSON_FIELDS)
      .populate('committedBy', PERSON_FIELDS);

    // eslint-disable-next-line no-await-in-loop
    await record({
      actor: req.user,
      department: populated.department,
      action: 'ticket.updated',
      summary: `updated ${populated.number}: ${summary}`,
      ticketNumber: populated.number,
    });
    // eslint-disable-next-line no-await-in-loop
    await notifyTicketUpdated({
      ticket: populated,
      actor: req.user,
      summary,
      event: changingDepartment ? 'moved' : 'assigned',
    });
  }

  res.json({
    success: true,
    reassigned: moved,
    department: destination ? { id: String(destination._id), name: destination.name } : null,
    assignees: people.map((person) => ({ id: String(person._id), name: person.name })),
  });
}

/** One ticket, by id. */
export async function deleteTicket(req, res) {
  const [ticket] = await removeTickets([req.params.id], req.user, req.body?.reason);
  res.json({ success: true, deleted: 1, numbers: [ticket.number] });
}

/** Several at once: `{ ids: [...] }`. */
export async function deleteTickets(req, res) {
  const { ids, reason } = req.body ?? {};
  if (!Array.isArray(ids)) throw ApiError.badRequest('Send the tickets to delete as a list.');

  const removed = await removeTickets(ids, req.user, reason);
  res.json({
    success: true,
    deleted: removed.length,
    numbers: removed.map((ticket) => ticket.number),
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
  const raisedByMe = isRaiser(req.user, ticket);

  if (!worksIt && !raisedByMe) {
    throw ApiError.forbidden('Only the receiving department can update this ticket.');
  }

  const {
    status,
    deadline,
    committedDeadline,
    committedReason,
    cancelReason,
    assignees,
    priority,
    subject,
    description,
    requestType,
    project,
  } = req.body ?? {};

  /**
   * Status is how a department works a ticket: theirs alone. A raiser asks for
   * things and is told when they are done; they do not declare it themselves.
   *
   * With one exception, which is not working the ticket at all: withdrawing
   * the request. What was asked for is the raiser's, so they may call it off -
   * with a reason, like anyone else - right up until the department has
   * finished it. After that there is nothing left to withdraw.
   */
  if (!worksIt && status !== undefined) {
    const withdrawing = raisedByMe && status === 'Cancelled';

    if (!withdrawing) {
      throw ApiError.forbidden('Only the receiving department can change the status.');
    }
    if (CLOSED_STATUSES.includes(ticket.status)) {
      throw ApiError.badRequest(
        ticket.status === 'Cancelled'
          ? 'This request has already been cancelled.'
          : 'This request is already finished, so there is nothing to withdraw.',
      );
    }
  }

  // Who holds it belongs to the department doing the work. Raising a request
  // says what is needed and by when; it does not say who has to do it.
  if (!worksIt && assignees !== undefined) {
    throw ApiError.forbidden('Only the receiving department can hand this ticket on.');
  }

  // The request itself is the raiser's: what they asked for, how urgent it is
  // and by when. A department answers a request, it does not rewrite it.
  const owns = raisedByMe || MANAGER_ROLES.includes(req.user.role);
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

  /** Set when the promise actually moved, so the thread can say so. */
  let movedCommitment = null;

  if (status !== undefined) {
    // The one status nobody owns. Refused by name rather than by the list
    // below, because "must be one of" reads as though it were missing.
    if (status === OVERDUE) {
      throw ApiError.badRequest(
        'Overdue is set by the deadline, not by hand. Move the date or finish the ticket.',
      );
    }

    if (!TICKET_STATUSES.includes(status)) {
      throw ApiError.badRequest(`Status must be one of: ${TICKET_STATUSES.join(', ')}.`);
    }

    // Started work does not go back to not started - for everybody. (It also
    // kept a way round the In Progress rule on dates: back to New, push the
    // date, In Progress again.)
    if (status === 'New' && ticket.status === 'In Progress') {
      throw ApiError.badRequest('This ticket is already In Progress, so it cannot go back to New.');
    }

    // Calling a ticket off always says why: the person who asked is told, and
    // "cancelled" on its own answers nothing.
    if (status === 'Cancelled' && ticket.status !== 'Cancelled') {
      const why = typeof cancelReason === 'string' ? cancelReason.trim() : '';
      if (why.length < 3) throw ApiError.badRequest('Say why the ticket is being cancelled.');
      if (why.length > 400) throw ApiError.badRequest('Keep the reason under 400 characters.');
      ticket.cancelReason = why;
      ticket.cancelledByName = req.user.name;
      ticket.cancelledAt = new Date();
    } else if (status !== 'Cancelled' && ticket.status === 'Cancelled') {
      // Reopened: the old reason no longer describes it.
      ticket.cancelReason = '';
      ticket.cancelledByName = '';
      ticket.cancelledAt = null;
    }

    /*
     * Finishing somebody else's request is a claim, not a verdict. The work is
     * marked Resolved and the person who asked decides whether it is done:
     * they approve it into Completed, or send it back to In Progress. Nobody
     * answering for 48 hours counts as yes - see services/approval.js.
     *
     * Finishing your own request needs nobody's say-so, and asking again for
     * one that is already resolved or completed changes nothing.
     */
    let next = status === RESOLVED ? 'Completed' : status;
    if (next === 'Completed') {
      if (ticket.status === RESOLVED || ticket.status === 'Completed') next = ticket.status;
      else if (!raisedByMe) next = RESOLVED;
    }

    if (next === RESOLVED && ticket.status !== RESOLVED) {
      const at = new Date();
      ticket.resolvedAt = at;
      ticket.resolvedBy = req.user._id;
      ticket.resolvedByName = req.user.name;
      ticket.approvalDueAt = new Date(at.getTime() + APPROVAL_WINDOW_MS);
      // A fresh claim: the last refusal has been answered by doing the work.
      ticket.rejectedReason = '';
      ticket.rejectedByName = '';
      ticket.rejectedAt = null;
      ticket.approvedByName = '';
    } else if (next !== RESOLVED && ticket.status === RESOLVED) {
      // Taken back, or called off, before anybody answered: nothing is waiting.
      ticket.approvalDueAt = null;
    }

    if (next === 'Completed' && ticket.status !== 'Completed') {
      ticket.completedAt = new Date();
      ticket.approvedByName = req.user.name;
      ticket.approvalDueAt = null;
    } else if (next !== 'Completed' && ticket.status === 'Completed') {
      // Reopened: whoever signed it off signed off something else.
      ticket.completedAt = null;
      ticket.approvedByName = '';
    }

    ticket.status = next;
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
    if (!raisedByMe && !MANAGER_ROLES.includes(req.user.role)) {
      throw ApiError.forbidden(
        'Only the person who raised this can change the requested deadline. Commit to a date of your own instead.',
      );
    }

    // Every ticket carries a deadline, so it can be moved but never removed.
    if (!deadline) throw ApiError.badRequest('Deadline is required.');
    const parsed = new Date(deadline);
    if (Number.isNaN(parsed.getTime())) throw ApiError.badRequest('Invalid deadline.');
    // Only a new date is judged: resending the one an old ticket already has
    // must not be refused just because that day has gone.
    if (asDay(parsed) !== asDay(ticket.deadline) && beforeToday(deadline)) {
      throw ApiError.badRequest('The deadline cannot be in the past.');
    }
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

    // Only a real move counts. The sheet sends this field on every save, so
    // resending the date already promised must not demand a fresh reason.
    const moved = asDay(parsed) !== asDay(ticket.committedDeadline);
    if (moved && parsed && beforeToday(committedDeadline)) {
      throw ApiError.badRequest('The promised date cannot be in the past.');
    }

    /*
     * Once the work is under way, the date it is due can only come closer.
     * Whoever put it In Progress took it on against the date it carried then,
     * so pushing that back is refused - for everybody, managers included -
     * whether by promising a later day or by withdrawing a promise when the
     * requested date is later still. Bringing it forward, or a first promise
     * on or before the date it already has, is still fine. "In Progress" is
     * the stored status, so a late ticket that is shown as Overdue counts,
     * and so does one being put In Progress in this same save.
     */
    const underWay = before.status === 'In Progress' || ticket.status === 'In Progress';
    if (moved && underWay) {
      const dueBefore = before.committedDeadline ?? before.deadline;
      const dueAfter = asDay(parsed) ?? asDay(ticket.deadline);
      if (dueBefore && dueAfter && dueAfter > dueBefore) {
        throw ApiError.badRequest(
          parsed
            ? 'This ticket is In Progress, so its date cannot be pushed back. You can only bring it forward.'
            : 'This ticket is In Progress, so the promised date cannot be withdrawn - that would push it back to the later requested date.',
        );
      }
    }

    if (moved) {
      const why = typeof committedReason === 'string' ? committedReason.trim() : '';
      if (!why) {
        throw ApiError.badRequest(
          ticket.committedDeadline
            ? 'Say why the date is moving. The person waiting is told, so it has to be worth reading.'
            : 'Say why you can resolve it by that date.',
        );
      }
      if (why.length < 3) throw ApiError.badRequest('That reason is too short to tell anyone anything.');
      if (why.length > 400) throw ApiError.badRequest('Keep the reason under 400 characters.');

      // The trail is written first and deliberately not swallowed: a promise
      // that cannot be explained is not recorded at all.
      await recordCommitment({
        ticket,
        previous: ticket.committedDeadline ?? null,
        next: parsed,
        reason: why,
        actor: req.user,
      });

      ticket.committedReason = parsed ? why : '';
      ticket.committedDeadline = parsed;
      ticket.committedBy = parsed ? req.user._id : null;
      ticket.committedAt = parsed ? new Date() : null;
      movedCommitment = { previous: before.committedDeadline, next: asDay(parsed), reason: why };
    }
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

    // A head hands work out; anyone else asks and waits to be taken up on it.
    if (!assignsDirectly(req.user, ticket)) {
      throw ApiError.forbidden(
        'Only the department head can reassign this. Ask a colleague to take it on instead.',
      );
    }

    const held = (ticket.assignees ?? []).map(String);
    const wanted = [...new Set(assignees.filter(Boolean).map(String))];

    // Nobody puts a ticket on their own desk: it is handed to you, or you
    // accept being asked. Somebody already holding one stays on it, so a list
    // that has you in it can still be saved - it just cannot gain you.
    const me = String(req.user._id);
    if (wanted.includes(me) && !held.includes(me)) {
      throw ApiError.badRequest('You cannot assign a ticket to yourself.');
    }

    /*
     * On a shared ticket each department's head hands out their own part. So
     * a head may add and remove people from the departments they run, and the
     * people holding it for the other departments stay on it whatever this
     * list says - a head of IT cannot take Pharmacy's name off the ticket.
     */
    const headed = new Set(departmentsHeadedOn(req.user, ticket));
    const theirs = (person) =>
      MANAGER_ROLES.includes(req.user.role) ||
      MANAGER_ROLES.includes(person.role) ||
      [...headed].some((id) => person.roleInDepartment(id));

    const heldPeople = await User.find({ _id: { $in: held } }).select('name role memberships');
    const kept = heldPeople.filter((person) => !theirs(person) && !wanted.includes(String(person._id)));

    const people = [...kept];
    for (const userId of wanted) {
      if (!mongoose.isValidObjectId(userId)) throw ApiError.badRequest('Invalid assignee.');

      // eslint-disable-next-line no-await-in-loop
      const candidate = await User.findById(userId).select('name role memberships');
      if (!candidate || !inTicketDepartments(candidate, ticket)) {
        throw ApiError.badRequest('That person is not in a department on this ticket.');
      }
      if (!held.includes(String(userId)) && !theirs(candidate)) {
        throw ApiError.forbidden(
          `${candidate.name} is in another department on this ticket - its head assigns them.`,
        );
      }
      people.push(candidate);
    }

    // Once a ticket sits with somebody it stays with somebody: it is handed
    // on, never dropped. Tickets raised before that rule can stay empty.
    if (people.length === 0 && held.length > 0) {
      throw ApiError.badRequest(
        'A ticket has to sit with someone. Hand it to another person instead.',
      );
    }

    // And on a shared ticket, each department that had somebody on it keeps
    // somebody: clearing your own part would leave that department's share of
    // the work with nobody.
    for (const departmentId of departmentIdsOf(ticket)) {
      const had = heldPeople.some((person) => person.roleInDepartment(departmentId));
      const has = people.some((person) => person.roleInDepartment(departmentId));
      if (had && !has) {
        // eslint-disable-next-line no-await-in-loop
        const named = await Department.findById(departmentId).select('name').lean();
        throw ApiError.badRequest(
          `${named?.name ?? 'That department'} needs someone on this ticket. Hand it to another person instead.`,
        );
      }
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
    await postSystemMessage({
      ticket,
      actor: req.user,
      event: 'assignment',
      body: `handed this to ${handedTo.map((person) => person.name).join(', ')}`,
    });
  }

  const populated = await Ticket.findById(ticket._id)
    .populate(WITH_DEPARTMENT)
    .populate({ ...WITH_DEPARTMENT, path: 'departments' })
    .populate('raisedBy', PERSON_FIELDS)
    .populate(WITH_FROM_DEPARTMENTS)
    .populate('assignees', PERSON_FIELDS)
    .populate('committedBy', PERSON_FIELDS);

  const changes = [];
  /** Marked done for the first time since it was last open: a question for the raiser. */
  const resolvedNow = before.status !== RESOLVED && populated.status === RESOLVED;
  if (before.status !== populated.status && !resolvedNow) {
    changes.push(
      populated.status === 'Cancelled'
        ? `cancelled the ticket - ${populated.cancelReason}`
        : `status ${before.status} -> ${populated.status}`,
    );
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
    const why = movedCommitment?.reason ? ` - ${movedCommitment.reason}` : '';
    changes.push(
      nowCommitted
        ? before.committedDeadline
          ? `moved the promised date from ${before.committedDeadline} to ${nowCommitted}${why}`
          : `promised to finish by ${nowCommitted}${why}`
        : `withdrew the promised date${why}`,
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

  /*
   * Resolving gets its own line in the thread, the log and the bell, apart
   * from anything else that moved in the same save: it is the one change that
   * asks somebody to do something, and it wears its own colour everywhere.
   */
  if (resolvedNow) {
    const raiser = populated.raisedBy?.name ?? 'the requester';
    await postSystemMessage({
      ticket: populated,
      actor: req.user,
      event: 'resolved',
      body: `marked this resolved - waiting for ${raiser} to approve`,
    });
    await record({
      actor: req.user,
      department: populated.department,
      action: 'ticket.resolved',
      summary: `resolved ${populated.number} "${populated.subject}" - waiting for ${raiser} to approve`,
      ticketNumber: populated.number,
    });
    await notifyApprovalRequested({
      ticket: populated,
      actor: req.user,
      within: APPROVAL_WINDOW_TEXT,
    });
  }

  if (changes.length > 0) {
    const summary = changes.join(', ');

    /*
     * The thread carries what happened as well as what was said: somebody
     * reading a question about a deadline should see that the deadline moved
     * without opening another tab for it.
     *
     * A handover is left out here and posted beside its own trail entry
     * below, so the history tab can show that one structurally rather than
     * twice over.
     */
    const said = changes.filter((line) => !line.startsWith('assigned to') && line !== 'unassigned');
    if (said.length > 0) {
      await postSystemMessage({
        ticket: populated,
        actor: req.user,
        event: 'edited',
        side: raisedByMe && !worksIt ? 'raiser' : 'department',
        body: said.join(', '),
      });
    }
    await record({
      actor: req.user,
      department: populated.department,
      action: 'ticket.updated',
      summary: `updated ${populated.number}: ${summary}`,
      ticketNumber: populated.number,
    });

    /**
     * The headline of what just happened, for the colour the bell wears.
     *
     * One save can move several things at once, so they are ranked by what a
     * reader would call the event: a ticket that was finished is news whatever
     * else moved with it.
     */
    const event =
      populated.status === 'Cancelled' && before.status !== 'Cancelled'
        ? 'cancelled'
        : populated.status === 'Completed' && before.status !== 'Completed'
          ? 'completed'
          : before.status !== populated.status && !resolvedNow
            ? 'status'
            : before.committedDeadline !== nowCommitted
              ? 'promise'
              : before.assignees !== nowAssignees.join(',')
                ? 'assigned'
                : 'edited';

    // Who hears about it depends on which side moved: the raiser editing their
    // own request is news for the department, not for themselves.
    if (raisedByMe && !worksIt) {
      await notifyTicketEdited({ ticket: populated, actor: req.user, summary, event });
    } else {
      await notifyTicketUpdated({ ticket: populated, actor: req.user, summary, event });
    }
  }

  // Through the same loader as the lists, so the sheet shows what they show.
  res.json({ success: true, ticket: present(await hydrateOne(await Ticket.findById(ticket._id).lean())) });
}
