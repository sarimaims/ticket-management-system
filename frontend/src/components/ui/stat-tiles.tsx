import { cn } from "@/lib/utils";
import type { Stat } from "@/lib/types";

/* One tinted tile per number. Colour carries the meaning - green reads as
   healthy, red as needing attention - so the row is scannable without being
   read. Tones come from the global status/role tokens; only the admin violet
   is specific to these tiles. */
const TILE_TONES: Record<Stat["tone"], string> = {
  new: "bg-role-team-bg text-role-team-fg",
  progress: "bg-status-progress-bg text-status-progress-fg",
  waiting: "bg-status-waiting-bg text-status-waiting-fg",
  completed: "bg-status-completed-bg text-status-completed-fg",
  overdue: "bg-status-overdue-bg text-status-overdue-fg",
  due: "bg-status-accepted-bg text-status-accepted-fg",
  admin: "bg-tile-admin-bg text-tile-admin-fg",
};

/** Tailwind needs whole class names, so the column counts are spelled out. */
const COLUMNS: Record<number, string> = {
  1: "lg:grid-cols-1",
  2: "lg:grid-cols-2",
  3: "lg:grid-cols-3",
  4: "lg:grid-cols-4",
  5: "lg:grid-cols-5",
  6: "lg:grid-cols-6",
};

export function StatTiles({
  stats,
  loading,
  className,
}: {
  stats: Stat[];
  /** Counts of nothing are indistinguishable from real zeros, so say so. */
  loading?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("grid grid-cols-2 gap-3", COLUMNS[stats.length] ?? "lg:grid-cols-4", className)}>
      {stats.map((stat) => (
        <div key={stat.label} className={cn("rounded-xl px-4 py-3", TILE_TONES[stat.tone])}>
          <p className="text-xs font-semibold opacity-80">{stat.label}</p>
          {loading ? (
            <span className="mt-1.5 block h-6 w-10 animate-pulse rounded-md bg-current opacity-20" />
          ) : (
            <p className="mt-1 text-2xl leading-none font-bold tabular-nums">{stat.value}</p>
          )}
        </div>
      ))}
    </div>
  );
}
