import { api, apiRevalidate, BASE } from "./api";
import { isSettled, type TicketPriority, type TicketStatus } from "./types";

/** The unit a department sits under, as the ticket carries it. */
export type TicketUnit = { id: string; name?: string; code?: string } | null;

/** A department a ticket was raised to. */
export type TicketDepartment = { id: string; name?: string; code?: string; unit?: TicketUnit };

/**
 * Every department a ticket is shared with, the lead first - read off the
 * list, or off the lead alone for a ticket from before tickets could be shared.
 */
export function departmentsOf(ticket: Pick<TicketRecord, "department" | "departments">) {
  return ticket.departments?.length ? ticket.departments : [ticket.department];
}

/** One ticket asked of more than one department. */
export const isShared = (ticket: Pick<TicketRecord, "department" | "departments">) =>
  departmentsOf(ticket).length > 1;

/** The units a ticket's departments sit under, each named once. */
export function unitsOf(ticket: Pick<TicketRecord, "department" | "departments">) {
  const byId = new Map<string, string>();
  for (const department of departmentsOf(ticket)) {
    if (department.unit?.id) byId.set(department.unit.id, department.unit.name ?? "Unit");
  }
  return [...byId].map(([id, name]) => ({ id, name }));
}

/**
 * One file attached to the request itself. No URL: a signed link expires
 * within the hour and a cached list would hand out dead ones, so the link is
 * asked for at the moment it is followed - see {@link attachmentHref}.
 */
export type TicketAttachment = {
  index: number;
  filename: string;
  mimeType: string;
  size: number;
  uploadedAt: string | null;
};

const startOfToday = () => new Date(new Date().toDateString()).getTime();

/**
 * A stored date as the reader's own midnight.
 *
 * `new Date("2026-09-26")` is midnight UTC, while today's midnight is local -
 * so east of Greenwich the two never met and "due today" counted nothing at
 * all. Built from the parts instead, which is local by definition.
 */
const dayOf = (value: string | null) => {
  if (!value) return null;
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day).getTime();
};

/** Past its date and not finished - whatever the status column happens to say. */
export function isOverdue(ticket: TicketRecord) {
  if (isSettled(ticket.status)) return false;
  if (ticket.status === "Overdue") return true;

  const due = dayOf(ticket.committedDeadline ?? ticket.deadline);
  return due !== null && due < startOfToday();
}

/** Open and due today, by the promised date where there is one. */
export function isDueToday(ticket: TicketRecord) {
  if (isSettled(ticket.status)) return false;
  return dayOf(ticket.committedDeadline ?? ticket.deadline) === startOfToday();
}

/** Due today and not already counted as late: what "Due today" means on a card. */
export const isDueTodayOnly = (ticket: TicketRecord) => isDueToday(ticket) && !isOverdue(ticket);

/**
 * Open and due inside the coming week, today excluded.
 *
 * Today has a tile of its own, so leaving it out here keeps the two counts
 * from claiming the same ticket - "due today" and "due this week" adding up
 * to more tickets than exist reads as a bug in the numbers.
 */
export function isDueThisWeek(ticket: TicketRecord) {
  if (isSettled(ticket.status) || isOverdue(ticket)) return false;

  const due = dayOf(ticket.committedDeadline ?? ticket.deadline);
  if (due === null) return false;

  const start = startOfToday();
  return due > start && due <= start + 7 * 24 * 60 * 60 * 1000;
}

/**
 * Open and marked High or Critical: what to chase before anything else.
 *
 * The questions below skip a resolved ticket: the work is in, and it is
 * waiting on the requester's sign-off rather than on anybody's effort.
 */
export const isUrgent = (ticket: TicketRecord) =>
  !isSettled(ticket.status) && (ticket.priority === "High" || ticket.priority === "Critical");

/** Raised since midnight, wherever the reader is: what came in today. */
export const isNewToday = (ticket: TicketRecord) =>
  new Date(ticket.createdAt).getTime() >= startOfToday();

/** Open, and nobody has promised a date back yet. */
export const hasNoCommitment = (ticket: TicketRecord) =>
  !isSettled(ticket.status) && !ticket.committedDeadline;

/** How long a live ticket may sit untouched before it counts as gone quiet. */
const QUIET_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Open with nothing happening on it for three days - no edit, no status
 * change, no message. The ticket nobody is chasing and nobody is working,
 * which is exactly the one a list sorted by date buries.
 */
export function isQuiet(ticket: TicketRecord) {
  // A resolved ticket is waiting on a clock of its own, not gone quiet.
  if (isSettled(ticket.status)) return false;
  const touched = Math.max(
    Date.parse(ticket.updatedAt) || 0,
    ticket.lastMessageAt ? Date.parse(ticket.lastMessageAt) || 0 : 0,
  );
  return touched > 0 && Date.now() - touched > QUIET_MS;
}

/** Done by the department and waiting for the requester to sign it off. */
export const isAwaitingApproval = (ticket: TicketRecord) => ticket.status === "Resolved";

/**
 * How long the requester has to answer before a resolved ticket completes on
 * its own, in words. Must match APPROVAL_WINDOW_MS on the server.
 */
export const APPROVAL_WINDOW_TEXT = "48 hours";

/** Open with nobody on it. */
export const isUnassigned = (ticket: TicketRecord) =>
  !isSettled(ticket.status) && ticket.assignees.length === 0;

/**
 * Asks a ticket list already on screen to open one ticket's sheet.
 *
 * A link to the page you are already on changes nothing React can see when it
 * names the same ticket twice, so a banner or a notification on that page
 * says it this way instead. `detail` is the ticket's id.
 */
export const OPEN_TICKET = "flowdesk:open-ticket";

export const openTicketHere = (id: string) =>
  window.dispatchEvent(new CustomEvent<string>(OPEN_TICKET, { detail: id }));

export type TicketRecord = {
  id: string;
  number: string;
  subject: string;
  description: string;
  requestType: string;
  priority: TicketPriority;
  status: TicketStatus;
  project: string;
  /** What the raiser asked for. Only the raiser can move it. */
  deadline: string | null;
  /** What the receiving department promised back. */
  committedDeadline: string | null;
  /** `designation` is their title in the department working the ticket. */
  committedBy: { id: string; name?: string; designation?: string } | null;
  committedAt: string | null;
  /** Why the current promise is that date. Empty when nothing is promised. */
  committedReason: string;
  /** Why it was called off, by whom and when. Empty unless it is Cancelled. */
  cancelReason?: string;
  cancelledByName?: string;
  cancelledAt?: string | null;
  /**
   * The sign-off. Resolved means the department says it is done; the person
   * who asked approves it (Completed) or sends it back (In Progress), and
   * unanswered it completes itself at `approvalDueAt`.
   */
  resolvedAt: string | null;
  resolvedByName: string;
  approvalDueAt: string | null;
  /** A name, or "Auto-approved" when the 48 hours ran out. */
  approvedByName: string;
  completedAt: string | null;
  /** The last time it was sent back, and why. Cleared when it is resolved again. */
  rejectedReason: string;
  rejectedByName: string;
  rejectedAt: string | null;
  /** Null when nobody has ever escalated it. */
  escalation: TicketEscalation | null;
  /** The unit rides along, so a list can be scoped without a second request. */
  /** The lead department: the first one asked. */
  department: TicketDepartment;
  /**
   * Every department this one ticket is shared with, the lead first. A single
   * entry for a ticket that went to one department.
   */
  departments: TicketDepartment[];
  fromDepartments: { id: string; name?: string; code?: string; unit?: TicketUnit }[];
  /** `designation` is their title in the department they raised it from. */
  raisedBy: { id: string; name?: string; email?: string; designation?: string };
  /** The raiser's standing when the ticket was raised, not their standing now. */
  raisedByRole: "superadmin" | "admin" | "user";
  /** Who is handling it. A department can put more than one person on it. */
  /** Each `designation` is that person's title in the department working it. */
  assignees: {
    id: string;
    name?: string;
    designation?: string;
    /** Which of the ticket's departments they hold it for. */
    departmentId?: string;
  }[];
  /** The paperwork that came with the request. */
  attachments: TicketAttachment[];
  /**
   * Somebody has asked you to take this on and is waiting for an answer. Per
   * viewer, so two people reading the same ticket see different values.
   */
  awaitingMe: boolean;
  /** How long the conversation on this ticket is, without loading any of it. */
  messageCount: number;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * The requester's answer to a resolved ticket. Approving completes it;
 * rejecting sends it back to In Progress and needs a reason, so whoever is
 * doing the work knows what is still missing.
 */
export function answerApproval(
  ticketId: string,
  decision: "approve" | "reject",
  reason?: string,
) {
  return api<{ ticket: TicketRecord }>(`/tickets/${ticketId}/approval`, {
    method: "POST",
    body: { decision, reason },
  }).then((data) => data.ticket);
}

/**
 * Puts a ticket in front of the super admin. The reason is required: they open
 * it cold, and "escalated" alone tells them nothing about what is wrong.
 */
export function escalateTicket(ticketId: string, reason: string) {
  return api<{ ticket: TicketRecord }>(`/tickets/${ticketId}/escalate`, {
    method: "POST",
    body: { reason },
  }).then((data) => data.ticket);
}

/** The super admin closes an escalation, saying what was done if they like. */
export function handleEscalation(ticketId: string, note?: string) {
  return api<{ ticket: TicketRecord }>(`/tickets/${ticketId}/escalation/handle`, {
    method: "POST",
    body: { note },
  }).then((data) => data.ticket);
}

/** How many escalations are open. Super admin only. */
export function countEscalations(signal?: AbortSignal) {
  return api<{ open: number }>("/tickets/escalations/count", { signal }).then((data) => data.open);
}

/** My requests that are resolved and waiting on my sign-off, soonest deadline first. */
export function listApprovals(signal?: AbortSignal) {
  return api<{ tickets: TicketRecord[] }>("/tickets/approvals", { signal }).then(
    (data) => data.tickets,
  );
}

/** One submit can target several departments; each gets its own ticket. */
export function createTicket(input: {
  departments: string[];
  fromDepartments?: string[];
  /** Who should pick it up, per department: `{ departmentId: [userId, ...] }`. */
  assignees?: Record<string, string[]>;
  subject: string;
  description: string;
  /** Optional: the form no longer asks, older tickets still carry one. */
  requestType?: string;
  priority: TicketPriority;
  deadline: string;
  project?: string;
  /** Files already uploaded to storage, named by the key the API handed out. */
  attachments?: { key: string; filename?: string }[];
}) {
  return api<{ tickets: TicketRecord[] }>("/tickets", { method: "POST", body: input }).then(
    (data) => data.tickets,
  );
}

/** Which slice of the workspace a list is asking for. */
/**
 * `escalated` is the super admin's own page: every ticket somebody has put in
 * front of them. The API refuses it for anyone else.
 */
export type TicketScope = "mine" | "assigned" | "all" | "escalated";

/** A ticket put in front of the super admin, and how that ended. */
export type TicketEscalation = {
  status: "open" | "handled";
  reason: string;
  byId: string | null;
  byName: string;
  at: string | null;
  handledAt: string | null;
  handledByName: string;
  note: string;
  /** How many times it has been escalated, all told. */
  count: number;
};

/**
 * Where one attachment is read from. The API answers with a redirect to a
 * freshly signed link, so this can be the href of an ordinary anchor.
 */
export function attachmentHref(ticketId: string, index: number, save?: boolean) {
  // `save` asks the API for a link that arrives as a download rather than
  // opening in a tab. Left off for thumbnails and the lightbox, which have to
  // stay viewable.
  return `${BASE}/tickets/${ticketId}/attachments/${index}${save ? "?save=1" : ""}`;
}

/**
 * Every file on the request, zipped by the API.
 *
 * The response carries `Content-Disposition: attachment`, which is what makes
 * it save rather than open - the `download` attribute on an anchor is ignored
 * when the API sits on another origin, as it does behind a tunnel.
 */
export function attachmentsArchiveHref(ticketId: string) {
  return `${BASE}/tickets/${ticketId}/attachments.zip`;
}

/** `mine` = raised by me, `assigned` = my departments' queue, omitted = both. */
export function listTickets(
  filters: { scope?: TicketScope; status?: string; priority?: string } = {},
  signal?: AbortSignal,
) {
  const query = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value) query.set(key, value);
  });
  const suffix = query.toString() ? `?${query}` : "";

  return api<{ tickets: TicketRecord[] }>(`/tickets${suffix}`, { signal }).then(
    (data) => data.tickets,
  );
}

/**
 * The same list, asked for repeatedly. `etag` is whatever the last answer
 * carried; when the queue has not moved the reply is 304 and `changed` is
 * false, which costs one small request and no re-render.
 */
export function revalidateTickets(scope: TicketScope, etag: string | null, signal?: AbortSignal) {
  return apiRevalidate<{ tickets: TicketRecord[] }>(`/tickets?scope=${scope}`, etag, signal);
}

/* ---------------------------------------------------------------- dashboard */

/** Whose dashboard it is: someone on tickets, someone running a team, or a manager. */
export type DashboardLens = "member" | "head" | "manager";

/**
 * How a ticket touches the reader. `mine` is their own part in it; `team` is
 * a head's - it sits in a queue they run, or one of their people raised it.
 */
export type TicketRelation = {
  mine: ("raised" | "assigned" | "asked")[];
  team: ("queue" | "raised")[];
};

export type DashboardTicket = TicketRecord & { relation: TicketRelation };

/** One line of the feed, scoped by the server to the reader's reach. */
export type DashboardUpdate = {
  id: string;
  department: { id: string; name: string } | null;
  actor: { name: string; role: "superadmin" | "admin" | "user"; isMe: boolean };
  action: string;
  summary: string;
  ticketNumber: string;
  /** Null once the ticket is gone: still readable, no longer openable. */
  ticketId: string | null;
  /** About a ticket that is the reader's own, not just their team's. */
  mine: boolean;
  createdAt: string;
};

/** One of today's chat lines on a ticket in the reader's reach. */
export type DashboardMessage = {
  id: string;
  ticketId: string;
  ticketNumber: string;
  ticketSubject: string;
  author: { name: string; isMe: boolean };
  side: "raiser" | "department";
  /** Cut to a row's length. Empty for a line that is only an attachment. */
  body: string;
  attachment: { kind: "image" | "video" | "file" | "voice"; filename: string } | null;
  createdAt: string;
};

export type DashboardData = {
  lens: DashboardLens;
  /** The departments the reader runs. Empty unless they are a head. */
  headOf: { id: string; name: string; code: string }[];
  tickets: DashboardTicket[];
  /** Today's chat, newest first. */
  messages: DashboardMessage[];
  activity: DashboardUpdate[];
};

/** The dashboard, conditionally: an unchanged page answers 304. */
export function revalidateDashboard(etag: string | null, signal?: AbortSignal) {
  // "Today" is the reader's day, so their own midnight goes up with the ask.
  const since = new Date(new Date().toDateString()).toISOString();
  return apiRevalidate<DashboardData>(
    `/tickets/dashboard?since=${encodeURIComponent(since)}`,
    etag,
    signal,
  );
}

/**
 * Two sides send this. The department works the ticket - status, assignee,
 * the date it commits to - and the person who raised it edits the request
 * itself. The server enforces which fields belong to whom.
 */
/**
 * Removes tickets and everything that only existed because of them - the
 * conversation, the assignment trail, the bell entries. Managers only, which
 * the API enforces.
 */
export function deleteTickets(ids: string[], reason: string) {
  return api<{ deleted: number; numbers: string[] }>("/tickets", {
    method: "DELETE",
    body: { ids, reason },
  });
}

/**
 * Hands a batch of tickets to the same people. They must all sit with one
 * department, because an assignee belongs to one - the API refuses a mixed
 * batch rather than half-applying it.
 */
/**
 * Hands a batch to other people, and - for an admin - to another department
 * entirely. `department` is the id to move them to; leave it out to keep them
 * where they are.
 */
export function reassignTickets(ids: string[], assignees: string[], department?: string) {
  return api<{
    reassigned: number;
    department: { id: string; name: string } | null;
    assignees: { id: string; name: string }[];
  }>("/tickets", {
    method: "PATCH",
    body: { ids, assignees, ...(department ? { department } : {}) },
  });
}

export function updateTicket(
  id: string,
  input: {
    status?: TicketStatus;
    priority?: TicketPriority;
    subject?: string;
    description?: string;
    requestType?: string;
    project?: string;
    deadline?: string | null;
    committedDeadline?: string | null;
    /** Required by the API whenever the promised date actually moves. */
    committedReason?: string;
    cancelReason?: string;
    assignees?: string[];
  },
) {
  return api<{ ticket: TicketRecord }>(`/tickets/${id}`, { method: "PATCH", body: input }).then(
    (data) => data.ticket,
  );
}
