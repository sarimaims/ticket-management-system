import { cn } from "@/lib/utils";
import type { TicketPriority, TicketStatus } from "@/lib/types";

/* Status + priority colours come straight from the global colour system in
   globals.css, so a badge here and a donut slice on the dashboard are the
   same colour by construction. */

const STATUS_STYLES: Record<TicketStatus, string> = {
  New: "bg-status-new-bg text-status-new-fg",
  Accepted: "bg-status-accepted-bg text-status-accepted-fg",
  "In Progress": "bg-status-progress-bg text-status-progress-fg",
  Waiting: "bg-status-waiting-bg text-status-waiting-fg",
  Completed: "bg-status-completed-bg text-status-completed-fg",
  Overdue: "bg-status-overdue-bg text-status-overdue-fg",
};

const PRIORITY_STYLES: Record<TicketPriority, { chip: string; dot: string }> = {
  Low: { chip: "bg-priority-low-bg text-priority-low-fg", dot: "bg-priority-low-dot" },
  Medium: { chip: "bg-priority-medium-bg text-priority-medium-fg", dot: "bg-priority-medium-dot" },
  High: { chip: "bg-priority-high-bg text-priority-high-fg", dot: "bg-priority-high-dot" },
  Critical: { chip: "bg-priority-critical-bg text-priority-critical-fg", dot: "bg-priority-critical-dot" },
};

/** The same status colours, for a control the user can change. */
export function statusToneClasses(status: TicketStatus) {
  return STATUS_STYLES[status];
}

export function StatusBadge({ status, className }: { status: TicketStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap",
        STATUS_STYLES[status],
        className,
      )}
    >
      {status}
    </span>
  );
}

export function PriorityBadge({ priority, className }: { priority: TicketPriority; className?: string }) {
  const style = PRIORITY_STYLES[priority];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap",
        style.chip,
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", style.dot)} />
      {priority}
    </span>
  );
}

const ROLE_STYLES: Record<"head" | "team", string> = {
  head: "bg-role-head-bg text-role-head-fg",
  team: "bg-role-team-bg text-role-team-fg",
};

/** Who someone is inside a department. */
export function RoleTag({ role, className }: { role: "head" | "team"; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold capitalize",
        ROLE_STYLES[role],
        className,
      )}
    >
      {role}
    </span>
  );
}

/**
 * Where a ticket came from. A department only ever sees this on tickets raised
 * above it, so an empty result for a normal request is the point.
 */
export function OriginTag({ role, className }: { role: string; className?: string }) {
  if (role !== "admin" && role !== "superadmin") return null;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold whitespace-nowrap uppercase",
        role === "superadmin"
          ? "bg-brand-50 text-brand-700"
          : "bg-tile-admin-bg text-tile-admin-fg",
        className,
      )}
    >
      {role === "superadmin" ? "Super Admin" : "Admin"}
    </span>
  );
}
