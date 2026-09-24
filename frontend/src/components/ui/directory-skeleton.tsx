import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * The shape of a directory page before it has anything to put in it: four
 * tiles, a filter bar, and a table of rows.
 *
 * Shaped like the page rather than a spinner in the middle of one, so the
 * layout does not jump when the answer arrives - what is already drawn stays
 * where it is and only fills in. Used while the route loads and while the
 * session is still being checked, which are the two moments the page cannot
 * draw itself yet.
 */
export function DirectorySkeleton({ columns = 6 }: { columns?: number }) {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, tile) => (
          <div key={tile} className="rounded-lg bg-ink-100/70 px-2.5 py-1.5">
            <Skeleton className="h-2.5 w-16 bg-ink-200/80" />
            <Skeleton className="mt-1.5 h-4 w-8 bg-ink-200/80" />
          </div>
        ))}
      </div>

      <Card className="mt-3 overflow-hidden">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line p-1.5">
          <Skeleton className="h-8 min-w-44 flex-1" />
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-8 w-32" />
          <Skeleton className="ml-auto h-8 w-24" />
        </div>

        <table className="w-full border-collapse">
          <tbody>
            {Array.from({ length: 6 }).map((_, row) => (
              <tr key={row} className="border-b border-line last:border-0">
                {Array.from({ length: columns }).map((_, column) => (
                  <td key={column} className="px-3 py-3.5">
                    <Skeleton
                      className={cn(
                        "h-4",
                        // The first column carries a name and an email; the
                        // rest are chips and dates, and the variation stops it
                        // reading as graph paper.
                        column === 0 ? "w-40" : column % 3 === 0 ? "w-14" : "w-24",
                      )}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
