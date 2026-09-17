import type { Stat, TicketStatus } from "./types";

export const DASHBOARD_STATS: Stat[] = [
  { label: "Total Tickets", value: 46, caption: "Across all departments", tone: "new" },
  { label: "In Progress", value: 9, caption: "Currently being worked on", tone: "progress" },
  { label: "Waiting", value: 3, caption: "Waiting for response", tone: "waiting" },
  { label: "Completed", value: 22, caption: "Successfully resolved", tone: "completed" },
  { label: "Overdue", value: 2, caption: "Past the deadline", tone: "overdue" },
];

/** Two series, one axis. Created vs resolved per month. */
export const VOLUME_SERIES = [
  { month: "Jan", created: 18, resolved: 14 },
  { month: "Feb", created: 22, resolved: 19 },
  { month: "Mar", created: 26, resolved: 21 },
  { month: "Apr", created: 21, resolved: 23 },
  { month: "May", created: 30, resolved: 25 },
  { month: "Jun", created: 34, resolved: 29 },
  { month: "Jul", created: 28, resolved: 31 },
  { month: "Aug", created: 38, resolved: 33 },
  { month: "Sep", created: 46, resolved: 38 },
];

/** Magnitude comparison, sorted high -> low so the sequential ramp reads. */
export const DEPARTMENT_LOAD = [
  { department: "Human Resources", tickets: 24 },
  { department: "IT Support", tickets: 19 },
  { department: "Development", tickets: 15 },
  { department: "Graphics & Design", tickets: 11 },
  { department: "Finance", tickets: 8 },
  { department: "Marketing", tickets: 6 },
];

/** Part-to-whole. Colours come from the STATUS tokens, matching the badges. */
export const STATUS_SHARE: { status: TicketStatus; count: number }[] = [
  { status: "Completed", count: 22 },
  { status: "In Progress", count: 9 },
  { status: "New", count: 6 },
  { status: "Accepted", count: 4 },
  { status: "Waiting", count: 3 },
  { status: "Overdue", count: 2 },
];

export const RECENT_ACTIVITY = [
  { id: "TK-0024", text: "Website Contact Form Update assigned to you", time: "12 min ago", tone: "new" as const },
  { id: "TK-0021", text: "Employee Onboarding Support is waiting on HR", time: "1 hr ago", tone: "waiting" as const },
  { id: "TK-0019", text: "CRM Access for New Team Member completed", time: "3 hrs ago", tone: "completed" as const },
  { id: "TK-0015", text: "Laptop Replacement passed its deadline", time: "Yesterday", tone: "overdue" as const },
  { id: "TK-0013", text: "CRM Access for Team Member passed its deadline", time: "2 days ago", tone: "overdue" as const },
];
