"use client";

import { ListFilter, X } from "lucide-react";

export type ActiveFilter = { key: string; label: string; clear: () => void };

/**
 * The line a narrowed list shows above its rows: that it is narrowed, how
 * much of the whole it is showing, and each filter one click from gone.
 *
 * A list that leaves things out without saying so reads as everything there
 * is - so whenever anything is narrowing it, this says what.
 */
export function FilteredStrip({
  filters,
  shown,
  total,
  noun,
  onClearAll,
}: {
  filters: ActiveFilter[];
  shown: number;
  total: number;
  /** "users", "admins", "members". */
  noun: string;
  onClearAll: () => void;
}) {
  if (filters.length === 0) return null;

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-1.5 border-b border-status-progress-fg/15 bg-status-progress-bg/70 px-2.5 py-1.5"
    >
      <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-bold text-status-progress-fg">
        <ListFilter className="size-3.5" />
        Filtered view
      </span>
      <span className="shrink-0 text-[11px] text-ink-500">
        Showing <span className="font-bold text-ink-800">{shown}</span> of{" "}
        <span className="font-bold text-ink-800">{total}</span> {noun}
      </span>

      <span aria-hidden className="h-3.5 w-px shrink-0 bg-status-progress-fg/20" />

      {filters.map((item) => (
        <span
          key={item.key}
          className="inline-flex max-w-[16rem] items-center gap-0.5 rounded-full border border-line bg-surface py-0.5 pr-0.5 pl-2 text-[11px] font-medium text-ink-700 shadow-xs"
        >
          <span className="truncate">{item.label}</span>
          <button
            type="button"
            onClick={item.clear}
            aria-label={`Remove filter: ${item.label}`}
            className="grid size-4 shrink-0 cursor-pointer place-items-center rounded-full text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}

      <button
        type="button"
        onClick={onClearAll}
        className="ml-auto inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold text-status-progress-fg transition-colors hover:bg-status-progress-fg/10"
      >
        Show all {noun}
      </button>
    </div>
  );
}
