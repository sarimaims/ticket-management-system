import { api, apiRevalidate, BASE } from "./api";
import type { TicketPriority, TicketStatus } from "./types";

/** The unit a department sits under, as the ticket carries it. */
export type TicketUnit = { id: string; name?: string; code?: string } | null;

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
  committedBy: { id: string; name?: string } | null;
  committedAt: string | null;
  /** Why the current promise is that date. Empty when nothing is promised. */
  committedReason: string;
  /** The unit rides along, so a list can be scoped without a second request. */
  department: { id: string; name?: string; code?: string; unit?: TicketUnit };
  fromDepartments: { id: string; name?: string; code?: string; unit?: TicketUnit }[];
  raisedBy: { id: string; name?: string; email?: string };
  /** The raiser's standing when the ticket was raised, not their standing now. */
  raisedByRole: "superadmin" | "admin" | "user";
  /** Who is handling it. A department can put more than one person on it. */
  assignees: { id: string; name?: string }[];
  /** The paperwork that came with the request. */
  attachments: TicketAttachment[];
  /** How long the conversation on this ticket is, without loading any of it. */
  messageCount: number;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
};

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
export type TicketScope = "mine" | "assigned" | "all";

/**
 * Where one attachment is read from. The API answers with a redirect to a
 * freshly signed link, so this can be the href of an ordinary anchor.
 */
export function attachmentHref(ticketId: string, index: number) {
  return `${BASE}/tickets/${ticketId}/attachments/${index}`;
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
export function deleteTickets(ids: string[]) {
  return api<{ deleted: number; numbers: string[] }>("/tickets", {
    method: "DELETE",
    body: { ids },
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
    assignees?: string[];
  },
) {
  return api<{ ticket: TicketRecord }>(`/tickets/${id}`, { method: "PATCH", body: input }).then(
    (data) => data.ticket,
  );
}
