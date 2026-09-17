import { STATUS_SHARE } from "@/lib/dashboard-data";
import type { TicketStatus } from "@/lib/types";

/* Part-to-whole -> one stacked bar, segments separated by a 2px surface gap
   (never a stroke). Segment colours are the STATUS tokens, so a segment here
   is the same colour as that status's badge in the ticket tables. Every value
   is printed in the list below, so nothing is gated behind colour or hover. */
const SEGMENT_COLOR: Record<TicketStatus, string> = {
  New: "var(--color-status-new-fg)",
  Accepted: "var(--color-status-accepted-fg)",
  "In Progress": "var(--color-status-progress-fg)",
  Waiting: "var(--color-status-waiting-fg)",
  Completed: "var(--color-status-completed-fg)",
  Overdue: "var(--color-status-overdue-fg)",
};

export function StatusShare() {
  const total = STATUS_SHARE.reduce((sum, slice) => sum + slice.count, 0);

  return (
    <div>
      <div className="flex gap-[2px] overflow-hidden rounded-full">
        {STATUS_SHARE.map((slice) => (
          <div
            key={slice.status}
            className="h-3 first:rounded-l-full last:rounded-r-full"
            style={{
              width: `${(slice.count / total) * 100}%`,
              backgroundColor: SEGMENT_COLOR[slice.status],
            }}
            title={`${slice.status}: ${slice.count}`}
          />
        ))}
      </div>

      <ul className="mt-5 space-y-3">
        {STATUS_SHARE.map((slice) => (
          <li key={slice.status} className="flex items-center gap-3 text-sm">
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: SEGMENT_COLOR[slice.status] }}
              aria-hidden="true"
            />
            <span className="text-ink-600">{slice.status}</span>
            <span className="ml-auto font-semibold text-ink-900">{slice.count}</span>
            <span className="w-11 text-right text-ink-400">
              {Math.round((slice.count / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
