import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";

import { cn } from "@/lib/utils";

export function TableHead({
  children,
  sortable,
  className,
  title,
}: {
  children: React.ReactNode;
  sortable?: boolean;
  className?: string;
  /** Spelt-out version of a heading that had to be short to fit its column. */
  title?: string;
}) {
  return (
    <th
      scope="col"
      title={title}
      className={cn(
        "px-2.5 py-1.5 text-left text-[11px] font-semibold whitespace-nowrap text-ink-500",
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
    <td className={cn("px-2.5 py-1.5 text-[12px] whitespace-nowrap text-ink-600", className)}>
      {children}
    </td>
  );
}

/** More numbers than this and the control grows wider than what it pages. */
const MAX_PAGE_BUTTONS = 5;

/** The run of page numbers around the current one, clamped to what exists. */
function pageWindow(current: number, pages: number) {
  const size = Math.min(MAX_PAGE_BUTTONS, pages);
  const first = Math.max(1, Math.min(current - Math.floor(size / 2), pages - size + 1));
  return Array.from({ length: size }, (_, index) => first + index);
}

export function Pagination({
  summary,
  pages = 1,
  current = 1,
  onPage,
}: {
  summary: string;
  pages?: number;
  current?: number;
  /** Without this the control is a label: the numbers render but do nothing. */
  onPage?: (page: number) => void;
}) {
  const btn =
    "grid size-8 place-items-center rounded-lg border border-line-strong bg-surface text-ink-500 transition-colors hover:bg-ink-50 disabled:opacity-40 disabled:hover:bg-surface";

  const go = (page: number) => {
    if (onPage && page >= 1 && page <= pages && page !== current) onPage(page);
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-3 py-2">
      <p className="text-xs text-ink-500">{summary}</p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className={btn}
          disabled={current === 1}
          onClick={() => go(current - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft className="size-4" />
        </button>
        {pageWindow(current, pages).map((page) => (
          <button
            key={page}
            type="button"
            onClick={() => go(page)}
            aria-current={page === current ? "page" : undefined}
            className={cn(
              "grid size-8 place-items-center rounded-lg text-[13px] font-semibold transition-colors",
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
          onClick={() => go(current + 1)}
          aria-label="Next page"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>
    </div>
  );
}
