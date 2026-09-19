import { api, apiRevalidate } from "./api";
import type { TicketPriority, TicketStatus } from "./types";

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
  department: { id: string; name?: string; code?: string };
  fromDepartments: { id: string; name?: string; code?: string }[];
  raisedBy: { id: string; name?: string; email?: string };
  /** The raiser's standing when the ticket was raised, not their standing now. */
  raisedByRole: "superadmin" | "admin" | "user";
  assignee: { id: string; name?: string } | null;
  createdAt: string;
  updatedAt: string;
};

/** One submit can target several departments; each gets its own ticket. */
export function createTicket(input: {
  departments: string[];
  fromDepartments?: string[];
  subject: string;
  description: string;
  /** Optional: the form no longer asks, older tickets still carry one. */
  requestType?: string;
  priority: TicketPriority;
  deadline: string;
  project?: string;
}) {
  return api<{ tickets: TicketRecord[] }>("/tickets", { method: "POST", body: input }).then(
    (data) => data.tickets,
  );
}

/** `mine` = raised by me, `assigned` = my departments' queue, omitted = both. */
export function listTickets(
  filters: { scope?: "mine" | "assigned"; status?: string; priority?: string } = {},
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
export function revalidateTickets(
  scope: "mine" | "assigned",
  etag: string | null,
  signal?: AbortSignal,
) {
  return apiRevalidate<{ tickets: TicketRecord[] }>(`/tickets?scope=${scope}`, etag, signal);
}

/**
 * Two sides send this. The department works the ticket - status, assignee,
 * the date it commits to - and the person who raised it edits the request
 * itself. The server enforces which fields belong to whom.
 */
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
    assignee?: string | null;
  },
) {
  return api<{ ticket: TicketRecord }>(`/tickets/${id}`, { method: "PATCH", body: input }).then(
    (data) => data.ticket,
  );
}
