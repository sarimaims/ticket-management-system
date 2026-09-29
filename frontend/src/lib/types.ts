/**
 * Where a ticket stands.
 *
 * The first three are somebody's decision. Overdue is not: the API works it
 * out from the deadline on the way out, so it arrives on a ticket that nobody
 * touched and cannot be chosen from any menu.
 */
export type TicketStatus =
  | "New"
  | "In Progress"
  | "Resolved"
  | "Completed"
  | "Cancelled"
  | "Overdue";

/**
 * What a status is called on screen, where that is not its stored name.
 *
 * Resolved is the department saying "done" and waiting for the person who
 * asked to agree - so it reads as what it is waiting for.
 */
export const STATUS_LABEL: Record<TicketStatus, string> = {
  New: "New",
  "In Progress": "In Progress",
  Resolved: "Awaiting Approval",
  Completed: "Completed",
  Cancelled: "Cancelled",
  Overdue: "Overdue",
};

/** The ones a person can actually put a ticket in. */
export const SETTABLE_STATUSES: TicketStatus[] = ["New", "In Progress", "Completed", "Cancelled"];

/** Finished one way or the other: never late, never waiting on anybody. */
export const isClosed = (status: TicketStatus) => status === "Completed" || status === "Cancelled";

/**
 * Left alone by the calendar: finished, called off, or done and waiting for
 * sign-off. A resolved ticket is not closed - it can be sent back - but the
 * work is in, so it is never counted late or due.
 */
export const isSettled = (status: TicketStatus) => isClosed(status) || status === "Resolved";

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
  tone:
    | "new"
    | "progress"
    | "waiting"
    | "completed"
    | "cancelled"
    | "overdue"
    | "due"
    | "admin"
    | "approval";
  /** What a click on this tile filters by, where the label is not enough. */
  key?: string;
};
