"use client";

import Link from "next/link";
import { ArrowLeft, ChevronRight, Menu } from "lucide-react";

import { NotificationBell } from "@/components/notifications/notification-bell";
import { usePageMeta } from "@/components/layout/page-title";

/**
 * One bar for the whole of "where am I": the trail, ending in the page name.
 * Pages no longer draw a header of their own, so this is the only row above
 * the content.
 */
export function Topbar({ onMenu }: { onMenu: () => void }) {
  const { title, crumbs, backHref } = usePageMeta();
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

      <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
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

      {/* Each page portals its actions in here, so a page never needs a
          header row of its own. */}
      <div id="page-actions" className="ml-auto flex shrink-0 items-center gap-2" />

      <div className="flex shrink-0 items-center">
        <NotificationBell />
      </div>
    </header>
  );
}
