import { cn } from "@/lib/utils";

/**
 * A placeholder the shape of the thing that is coming. Shown instead of an
 * empty state while the first fetch is in flight, so a slow database reads as
 * "loading" rather than "there is nothing here".
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("block animate-pulse rounded-md bg-ink-100", className)}
    />
  );
}

/** Rows of grey bars in the shape of a table body. */
export function TableSkeleton({
  rows = 5,
  columns,
  className,
}: {
  rows?: number;
  columns: number;
  className?: string;
}) {
  return (
    <>
      {Array.from({ length: rows }).map((_, row) => (
        <tr key={row} className={cn("border-b border-line last:border-0", className)}>
          {Array.from({ length: columns }).map((_, column) => (
            <td key={column} className="px-3 py-3.5">
              <Skeleton
                className={cn(
                  "h-4",
                  // The first column is the name; the rest are narrower, and a
                  // little variation stops it looking like graph paper.
                  column === 0 ? "w-40" : column % 3 === 0 ? "w-14" : "w-24",
                )}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/** A block of stacked bars, for lists that are not tables. */
export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <ul className="divide-y divide-line">
      {Array.from({ length: rows }).map((_, row) => (
        <li key={row} className="flex items-start gap-3 px-4 py-3.5">
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <span className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3.5 w-3/5" />
            <Skeleton className="h-3 w-2/5" />
          </span>
        </li>
      ))}
    </ul>
  );
}
