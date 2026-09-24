import type { TicketStatus } from "@/lib/types";

export type StatusPoint = { status: TicketStatus; count: number };

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

export function StatusShare({ data }: { data: StatusPoint[] }) {
  const total = data.reduce((sum, slice) => sum + slice.count, 0);

  if (total === 0) {
    return (
      <div className="grid min-h-56 place-items-center rounded-xl bg-ink-50 text-center">
        <div>
          <p className="text-sm font-bold text-ink-700">No status data yet</p>
          <p className="mt-1 text-xs text-ink-400">The breakdown will fill as tickets arrive.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex gap-[2px] overflow-hidden rounded-full">
        {data.map((slice) => (
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
        {data.map((slice) => (
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
