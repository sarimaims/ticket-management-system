"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, ChevronRight, Menu, Plus } from "lucide-react";

import { NotificationBell } from "@/components/notifications/notification-bell";
import { usePageMeta } from "@/components/layout/page-title";
import { TodayIsland } from "@/components/layout/today-island";
import { SpotlightTrigger } from "@/components/search/spotlight";
import { cn } from "@/lib/utils";

/**
 * The "Today" island in the middle of the bar. Parked for now - flip back to
 * true to bring it back; the component is complete and untouched.
 */
const SHOW_TODAY_ISLAND = false;

/**
 * One bar for the whole of "where am I": the trail, ending in the page name.
 * Pages no longer draw a header of their own, so this is the only row above
 * the content.
 */
export function Topbar({ onMenu }: { onMenu: () => void }) {
  const { title, crumbs, backHref } = usePageMeta();
  const pathname = usePathname();
  const trail = crumbs.length > 0 ? crumbs : [{ label: title }];

  return (
    <header className="sticky top-0 z-30 flex h-11 shrink-0 items-center gap-2 border-b border-line bg-surface px-3 sm:px-4">
      <button
        type="button"
        onClick={onMenu}
        className="grid size-8 shrink-0 place-items-center rounded-md text-ink-500 hover:bg-ink-50 lg:hidden"
        aria-label="Open navigation"
      >
        <Menu className="size-4.5" />
      </button>

      {backHref && (
        <>
          <Link
            href={backHref as "/"}
            className="inline-flex shrink-0 items-center gap-1 text-[12px] font-semibold text-ink-500 transition-colors hover:text-brand-600"
          >
            <ArrowLeft className="size-3.5" />
            Back
          </Link>
          <span className="h-3.5 w-px shrink-0 bg-line-strong" />
        </>
      )}

      {/* With the island showing, the trail stops short of the middle on wide
          screens, where it sits. */}
      <nav
        aria-label="Breadcrumb"
        className={cn(
          "min-w-0 flex-1",
          SHOW_TODAY_ISLAND && "xl:max-w-[calc(50%-11rem)] 2xl:max-w-[calc(50%-13rem)]",
        )}
      >
        <ol className="flex min-w-0 items-center gap-1 text-[12px]">
          {trail.map((crumb, index) => {
            const last = index === trail.length - 1;
            return (
              <li key={`${crumb.label}-${index}`} className="flex min-w-0 items-center gap-1">
                {crumb.href && !last ? (
                  <Link
                    href={crumb.href as "/"}
                    className="shrink-0 text-ink-400 transition-colors hover:text-ink-700"
                  >
                    {crumb.label}
                  </Link>
                ) : (
                  <span
                    className={
                      last
                        ? "truncate text-[13px] font-bold tracking-tight text-ink-900"
                        : "shrink-0 text-ink-400"
                    }
                  >
                    {crumb.label}
                  </span>
                )}
                {!last && <ChevronRight className="size-3 shrink-0 text-ink-300" />}
              </li>
            );
          })}
        </ol>
      </nav>

      {/* Today, in the middle of the bar. Only where there is room for it
          beside the trail and the actions - on a narrower screen the bell
          already carries the same news. */}
      {SHOW_TODAY_ISLAND && (
        <div className="absolute top-1/2 left-1/2 z-10 hidden -translate-x-1/2 -translate-y-1/2 xl:block">
          <TodayIsland />
        </div>
      )}

      {/* Search everything in reach, from any page. */}
      <SpotlightTrigger />

      {/* Each page portals its actions in here, so a page never needs a
          header row of its own. */}
      <div id="page-actions" className="flex shrink-0 items-center gap-2 empty:hidden" />

      {/* Raising a ticket is one click from anywhere - except the form itself,
          where the button would only lead back to where you are, and the
          personal to-do board, which is not about tickets. */}
      {pathname !== "/create-ticket" && pathname !== "/todo" && (
        <Link
          href="/create-ticket"
          aria-label="Create ticket"
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md bg-brand-600 px-2 text-[12px] font-semibold text-white shadow-sm shadow-brand-600/25 transition-colors hover:bg-brand-700 sm:px-2.5"
        >
          <Plus className="size-3.5" strokeWidth={2.5} />
          <span className="hidden sm:inline">Create Ticket</span>
        </Link>
      )}

      <div className="flex shrink-0 items-center">
        <NotificationBell />
      </div>
    </header>
  );
}
