import { api } from "./api";
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
  deadline: string | null;
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
  requestType: string;
  priority: TicketPriority;
  deadline?: string;
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

/** Working a ticket: only its department (or a manager) may do this. */
export function updateTicket(
  id: string,
  input: {
    status?: TicketStatus;
    priority?: TicketPriority;
    deadline?: string | null;
    assignee?: string | null;
  },
) {
  return api<{ ticket: TicketRecord }>(`/tickets/${id}`, { method: "PATCH", body: input }).then(
    (data) => data.ticket,
  );
}
