/**
 * Where a ticket stands.
 *
 * The first three are somebody's decision. Overdue is not: the API works it
 * out from the deadline on the way out, so it arrives on a ticket that nobody
 * touched and cannot be chosen from any menu.
 */
export type TicketStatus = "New" | "In Progress" | "Completed" | "Cancelled" | "Overdue";

/** The ones a person can actually put a ticket in. */
export const SETTABLE_STATUSES: TicketStatus[] = ["New", "In Progress", "Completed", "Cancelled"];

/** Finished one way or the other: never late, never waiting on anybody. */
export const isClosed = (status: TicketStatus) => status === "Completed" || status === "Cancelled";

export type TicketPriority = "Low" | "Medium" | "High" | "Critical";

export type Ticket = {
  id: string;
  subject: string;
  department: string;
  requestType: string;
  priority: TicketPriority;
  status: TicketStatus;
  createdOn: string;
  deadline: string;
  assignee?: string;
};

export type Stat = {
  label: string;
  value: number;
  caption: string;
  tone: "new" | "progress" | "waiting" | "completed" | "cancelled" | "overdue" | "due" | "admin";
  /** What a click on this tile filters by, where the label is not enough. */
  key?: string;
};
