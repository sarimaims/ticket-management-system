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
  // Called off is not a failure and not a success, so it stays out of the
  // traffic lights entirely - the same neutral the badge wears.
  cancelled: "bg-ink-100 text-ink-500",
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

/** What a tile answers to when clicked: its own key, or its label. */
export const statKey = (stat: Stat) => stat.key ?? stat.label;

export function StatTiles({
  stats,
  loading,
  className,
  active,
  onSelect,
}: {
  stats: Stat[];
  /** Counts of nothing are indistinguishable from real zeros, so say so. */
  loading?: boolean;
  className?: string;
  /** The tile whose filter is on, outlined so the list below reads as its answer. */
  active?: string | null;
  /**
   * Makes the tiles a filter: a click narrows the list to what the number
   * counts. The page decides what that means, and clicking the lit tile again
   * is its cue to clear it.
   */
  onSelect?: (key: string) => void;
}) {
  return (
    <div
      className={cn("grid grid-cols-2 gap-2", COLUMNS[stats.length] ?? "lg:grid-cols-4", className)}
    >
      {stats.map((stat) => {
        const key = statKey(stat);
        const lit = active === key;
        const body = (
          <>
            <p className="text-[10px] font-semibold opacity-80">{stat.label}</p>
            {loading ? (
              <span className="mt-1 block h-4 w-8 animate-pulse rounded bg-current opacity-20" />
            ) : (
              <p className="mt-0.5 text-base leading-none font-bold tabular-nums">{stat.value}</p>
            )}
          </>
        );
        const tile = cn("rounded-lg px-2.5 py-1.5", TILE_TONES[stat.tone]);

        return onSelect ? (
          <button
            key={stat.label}
            type="button"
            aria-pressed={lit}
            title={lit ? "Show all" : `Show ${stat.label.toLowerCase()}`}
            onClick={() => onSelect(key)}
            // No rings, lifts or shadows: hover and the lit tile only deepen
            // the tile's own tint. The wash is the tile's text colour at low
            // opacity, laid under the content, so every tone darkens in its
            // own hue in either theme.
            className={cn(
              tile,
              "relative isolate text-left focus-visible:outline-none",
              "before:absolute before:inset-0 before:-z-10 before:rounded-[inherit] before:bg-current",
              "before:opacity-0 before:transition-opacity before:duration-150",
              "hover:before:opacity-[0.08] focus-visible:before:opacity-[0.1]",
              "active:before:opacity-[0.16]",
              // On: the one tile the list below is answering.
              lit && "before:opacity-[0.14] hover:before:opacity-[0.18]",
            )}
          >
            {body}
          </button>
        ) : (
          <div key={stat.label} className={tile}>
            {body}
          </div>
        );
      })}
    </div>
  );
}
