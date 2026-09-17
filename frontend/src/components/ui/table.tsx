import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";

import { cn } from "@/lib/utils";

export function TableHead({
  children,
  sortable,
  className,
}: {
  children: React.ReactNode;
  sortable?: boolean;
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={cn(
        "px-2.5 py-2.5 text-left text-xs font-semibold whitespace-nowrap text-ink-600",
        className,
      )}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        {sortable && (
          <span className="flex flex-col text-ink-300">
            <ChevronUp className="size-3 -mb-1" strokeWidth={2.5} />
            <ChevronDown className="size-3" strokeWidth={2.5} />
          </span>
        )}
      </span>
    </th>
  );
}

export function TableCell({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <td className={cn("px-2.5 py-2.5 text-[13px] whitespace-nowrap text-ink-600", className)}>
      {children}
    </td>
  );
}

export function Pagination({
  summary,
  pages = 1,
  current = 1,
}: {
  summary: string;
  pages?: number;
  current?: number;
}) {
  const btn =
    "grid size-9 place-items-center rounded-lg border border-line-strong bg-surface text-ink-500 transition-colors hover:bg-ink-50 disabled:opacity-40 disabled:hover:bg-surface";

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-2.5">
      <p className="text-sm text-ink-500">{summary}</p>
      <div className="flex items-center gap-2">
        <button type="button" className={btn} disabled={current === 1} aria-label="Previous page">
          <ChevronLeft className="size-4" />
        </button>
        {Array.from({ length: pages }, (_, i) => i + 1).map((page) => (
          <button
            key={page}
            type="button"
            aria-current={page === current ? "page" : undefined}
            className={cn(
              "grid size-9 place-items-center rounded-lg text-sm font-semibold transition-colors",
              page === current
                ? "bg-brand-600 text-white"
                : "border border-line-strong bg-surface text-ink-600 hover:bg-ink-50",
            )}
          >
            {page}
          </button>
        ))}
        <button
          type="button"
          className={btn}
          disabled={current === pages}
          aria-label="Next page"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>
    </div>
  );
}
