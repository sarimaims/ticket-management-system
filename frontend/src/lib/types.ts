export type TicketStatus =
  | "New"
  | "Accepted"
  | "In Progress"
  | "Waiting"
  | "Completed"
  | "Overdue";

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
