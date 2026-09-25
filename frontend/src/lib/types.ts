/**
 * Where a ticket stands.
 *
 * The first three are somebody's decision. Overdue is not: the API works it
 * out from the deadline on the way out, so it arrives on a ticket that nobody
 * touched and cannot be chosen from any menu.
 */
export type TicketStatus = "New" | "In Progress" | "Completed" | "Overdue";

/** The ones a person can actually put a ticket in. */
export const SETTABLE_STATUSES: TicketStatus[] = ["New", "In Progress", "Completed"];

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
  tone: "new" | "progress" | "waiting" | "completed" | "overdue" | "due" | "admin";
};
