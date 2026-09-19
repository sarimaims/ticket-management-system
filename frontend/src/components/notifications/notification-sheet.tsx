"use client";

import { useEffect, useMemo, useState } from "react";
import { Bell, BellOff, CheckCheck, Trash2, Volume2, X } from "lucide-react";

import { useNotifications } from "@/components/notifications/notification-provider";
import {
  NotificationCard,
  groupByDay,
  toggleSound,
} from "@/components/notifications/notification-shared";
import { cn } from "@/lib/utils";

type Filter = "all" | "unread" | "requests" | "updates";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "requests", label: "Requests" },
  { key: "updates", label: "Updates" },
];

/**
 * The whole feed, in the same right-hand drawer the ticket details use, laid
 * out the way a phone lays out its notification centre: runs grouped by day,
 * each notification its own rounded card.
 */
export function NotificationSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { items, unread, muted, setMuted, markAllRead, markOneRead, clearAll } =
    useNotifications();
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const rows = useMemo(() => {
    if (filter === "unread") return items.filter((item) => !item.read);
    if (filter === "requests") return items.filter((item) => item.type === "ticket.new");
    if (filter === "updates") return items.filter((item) => item.type !== "ticket.new");
    return items;
  }, [items, filter]);

  const groups = useMemo(() => groupByDay(rows), [rows]);

  return (
    <>
      {open && (
        <div
          className="fixed inset-x-0 top-16 bottom-0 z-40 bg-ink-900/30"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        aria-hidden={!open}
        aria-label="All notifications"
        className={cn(
          "fixed top-16 right-0 bottom-0 z-50 flex w-full max-w-md flex-col border-l border-line bg-canvas transition-transform duration-200",
          open ? "translate-x-0" : "translate-x-full",
        )}
      >
        <div className="flex items-center gap-2 border-b border-line bg-surface px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="flex items-center gap-2 text-base font-bold text-ink-900">
              Notifications
              {unread > 0 && (
                <span className="rounded-full bg-brand-600 px-2 py-0.5 text-[11px] font-bold text-white">
                  {unread} new
                </span>
              )}
            </h2>
          </div>

          <button
            type="button"
            onClick={() => toggleSound(muted, setMuted)}
            className="grid size-8 place-items-center rounded-lg text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700"
            aria-label={muted ? "Turn the sound on" : "Turn the sound off"}
            title={muted ? "Sound off" : "Sound on"}
          >
            {muted ? <BellOff className="size-4.5" /> : <Volume2 className="size-4.5" />}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="grid size-8 place-items-center rounded-lg text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700"
            aria-label="Close notifications"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Filter pills, the way a phone lets you narrow a busy centre. */}
        <div className="flex items-center gap-1.5 overflow-x-auto border-b border-line bg-surface px-4 py-2.5">
          {FILTERS.map((entry) => {
            const count =
              entry.key === "unread"
                ? unread
                : entry.key === "requests"
                  ? items.filter((item) => item.type === "ticket.new").length
                  : entry.key === "updates"
                    ? items.filter((item) => item.type !== "ticket.new").length
                    : items.length;

            return (
              <button
                key={entry.key}
                type="button"
                onClick={() => setFilter(entry.key)}
                aria-pressed={filter === entry.key}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-semibold transition-colors",
                  filter === entry.key
                    ? "bg-ink-900 text-white"
                    : "bg-ink-100 text-ink-600 hover:bg-ink-200",
                )}
              >
                {entry.label}
                <span
                  className={cn(
                    "text-[11px]",
                    filter === entry.key ? "text-white/70" : "text-ink-400",
                  )}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-3">
          {groups.length === 0 ? (
            <div className="px-4 py-16 text-center">
              <span className="mx-auto grid size-12 place-items-center rounded-full bg-ink-100">
                <Bell className="size-5 text-ink-400" />
              </span>
              <p className="mt-3 text-sm font-semibold text-ink-700">
                {filter === "all" ? "Nothing yet" : "Nothing here"}
              </p>
              <p className="mt-0.5 text-sm text-ink-400">
                {filter === "all"
                  ? "Tickets raised to your department show up here."
                  : "Try another filter."}
              </p>
            </div>
          ) : (
            groups.map((group) => (
              <section key={group.label} className="mb-4 last:mb-0">
                <h3 className="px-1 pb-1.5 text-[11px] font-bold tracking-wide text-ink-400 uppercase">
                  {group.label}
                </h3>
                <div className="space-y-1.5">
                  {group.items.map((item) => (
                    <NotificationCard
                      key={item.id}
                      item={item}
                      onNavigate={onClose}
                      onRead={markOneRead}
                    />
                  ))}
                </div>
              </section>
            ))
          )}
        </div>

        {items.length > 0 && (
          <div className="flex items-center gap-2 border-t border-line bg-surface px-4 py-3">
            <button
              type="button"
              onClick={() => void markAllRead()}
              disabled={unread === 0}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-line-strong px-3 py-2 text-[13px] font-semibold text-ink-700 transition-colors hover:bg-ink-50 disabled:opacity-50"
            >
              <CheckCheck className="size-4" />
              Mark all read
            </button>
            <button
              type="button"
              onClick={() => void clearAll()}
              className="flex items-center justify-center gap-1.5 rounded-lg border border-line-strong px-3 py-2 text-[13px] font-semibold text-brand-600 transition-colors hover:bg-brand-50"
            >
              <Trash2 className="size-4" />
              Clear
            </button>
          </div>
        )}
      </aside>
    </>
  );
}
