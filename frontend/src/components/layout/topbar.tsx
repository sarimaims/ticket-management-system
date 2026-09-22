"use client";

import { Menu } from "lucide-react";

import { NotificationBell } from "@/components/notifications/notification-bell";
import { usePageTitle } from "@/components/layout/page-title";

export function Topbar({ onMenu }: { onMenu: () => void }) {
  const pageTitle = usePageTitle();

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-line bg-surface px-3 sm:px-4 lg:px-5">
      <button
        type="button"
        onClick={onMenu}
        className="grid size-9 place-items-center rounded-lg text-ink-500 hover:bg-ink-50 lg:hidden"
        aria-label="Open navigation"
      >
        <Menu className="size-5" />
      </button>

      <h1 className="truncate text-base font-bold tracking-tight text-ink-900">{pageTitle}</h1>

      <div className="ml-auto flex items-center">
        <NotificationBell />
      </div>
    </header>
  );
}
