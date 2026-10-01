import type { DashboardTicket } from "@/lib/tickets";
import { isClosed, type TicketStatus } from "@/lib/types";

/*
 * What every part of the dashboard shares: how a date is read, what "open"
 * means, how a ticket names its people and places, and the one shape a list
 * of tickets takes when a number is clicked.
 */

export const DAY = 86_400_000;

/** Midnight today, so "due today" means the day rather than the next 24 hours. */
export const startOfToday = () => new Date(new Date().toDateString()).getTime();

/**
 * A stored date as the reader's own midnight. `new Date("2026-10-01")` is
 * midnight UTC, so it is built from the parts instead, which is local.
 */
export function dayOf(value: string | null | undefined) {
  if (!value) return null;
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day).getTime();
}

/** A local calendar day as YYYY-MM-DD, which also sorts as a string. */
export function dayKey(time: number | Date) {
  const date = new Date(time);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export const isOpen = (ticket: DashboardTicket) => !isClosed(ticket.status);

/** The date that counts: what the department promised, or else what was asked for. */
export const dueOf = (ticket: DashboardTicket) => ticket.committedDeadline ?? ticket.deadline;

export const departmentsOf = (ticket: DashboardTicket) =>
  ticket.departments?.length ? ticket.departments : [ticket.department];

export const departmentNames = (ticket: DashboardTicket) =>
  departmentsOf(ticket)
    .map((department) => department.name ?? department.code ?? "")
    .filter(Boolean)
    .join(", ") || "Department";

export const firstName = (name?: string) => (name ?? "").trim().split(/\s+/)[0] || "Someone";

/** Who holds it, by first name - or that nobody does yet. */
export const holders = (ticket: DashboardTicket) =>
  ticket.assignees.length > 0
    ? ticket.assignees.map((person) => firstName(person.name)).join(", ")
    : "not picked up";

export const byUpdated = (left: DashboardTicket, right: DashboardTicket) =>
  Date.parse(right.updatedAt) - Date.parse(left.updatedAt);

/** Open first, newest activity first within each half. */
export const openFirst = (tickets: DashboardTicket[]) => {
  const sorted = [...tickets].sort(byUpdated);
  return [...sorted.filter(isOpen), ...sorted.filter((ticket) => !isOpen(ticket))];
};

/** "due today", "2 days late" - the thing being asked of a date on a queue. */
export function when(value: string | null) {
  const due = dayOf(value);
  if (due === null) return "no date";

  const days = Math.round((due - startOfToday()) / DAY);
  if (days === 0) return "due today";
  if (days === 1) return "due tomorrow";
  if (days > 1) return `due in ${days} days`;
  if (days === -1) return "1 day late";
  return `${Math.abs(days)} days late`;
}

/** "just now", "3h ago", "2d ago", then the date. */
export function relativeTime(value: string | number, now: number | null) {
  if (!now) return "";

  const seconds = Math.max(0, Math.floor((now - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(value).toLocaleDateString("en", { day: "numeric", month: "short" });
}

/** A due date as "1 Oct", read as the local day it names. */
export function shortDay(value: string | null) {
  const day = dayOf(value);
  return day === null
    ? ""
    : new Date(day).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/* ------------------------------------------------------------------ lists */

/** One tint per list, from the same status tokens the ticket pages use. */
export type Tone =
  | "rose"
  | "amber"
  | "slate"
  | "royal"
  | "violet"
  | "progress"
  | "completed"
  | "due"
  | "admin";

export const TONES: Record<Tone, string> = {
  rose: "bg-status-overdue-bg text-status-overdue-fg",
  amber: "bg-status-waiting-bg text-status-waiting-fg",
  slate: "bg-ink-100 text-ink-600",
  royal: "bg-royal-50 text-royal-700",
  violet: "bg-status-resolved-bg text-status-resolved-fg",
  progress: "bg-status-progress-bg text-status-progress-fg",
  completed: "bg-status-completed-bg text-status-completed-fg",
  due: "bg-status-accepted-bg text-status-accepted-fg",
  admin: "bg-tile-admin-bg text-tile-admin-fg",
};

/** A status's colour, carried into the list it opens. */
export const STATUS_TONE: Record<TicketStatus, Tone> = {
  New: "slate",
  "In Progress": "progress",
  Resolved: "violet",
  Overdue: "rose",
  Completed: "completed",
  Cancelled: "slate",
};

/** One tab over a list: its own tickets, a dot and a tint in its colour. */
export type ListTab = {
  key: string;
  label: string;
  dot: string;
  tint: string;
  list: DashboardTicket[];
};

/**
 * Everything the ticket list window needs: a title, a count, a line under it,
 * and either one list or a few tabs of lists. Where a page lists the same
 * tickets with more filters, `href` offers it.
 */
export type ListSpec = {
  label: string;
  value: number;
  caption: string;
  href?: string;
  list?: DashboardTicket[];
  filters?: ListTab[];
  initialFilter?: string;
  tone: Tone;
};

/** The tab colours used across the dashboard, so a slice looks the same everywhere. */
export const TAB = {
  open: { dot: "bg-royal-500", tint: "bg-royal-50 text-royal-700 ring-royal-200" },
  today: { dot: "bg-status-waiting-fg", tint: "bg-status-waiting-bg text-status-waiting-fg ring-status-waiting-fg/20" },
  late: { dot: "bg-status-overdue-fg", tint: "bg-status-overdue-bg text-status-overdue-fg ring-status-overdue-fg/20" },
  approval: { dot: "bg-status-resolved-fg", tint: "bg-status-resolved-bg text-status-resolved-fg ring-status-resolved-fg/20" },
  waiting: { dot: "bg-ink-400", tint: "bg-ink-100 text-ink-700 ring-ink-200" },
  done: { dot: "bg-status-completed-fg", tint: "bg-status-completed-bg text-status-completed-fg ring-status-completed-fg/20" },
  progress: { dot: "bg-status-progress-fg", tint: "bg-status-progress-bg text-status-progress-fg ring-status-progress-fg/20" },
  new: { dot: "bg-status-new-fg", tint: "bg-status-new-bg text-status-new-fg ring-ink-200" },
} as const;
