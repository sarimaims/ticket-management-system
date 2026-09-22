"use client";

import { useEffect, useMemo, useState } from "react";
import { Bell, CheckCheck, Trash2, Volume2, VolumeX, X } from "lucide-react";

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
          className="fixed inset-0 z-40 bg-ink-900/30"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        aria-hidden={!open}
        aria-label="All notifications"
        className={cn(
          // Full height, like the ticket sheet: a panel that opens over the
          // bar rather than under it.
          "fixed inset-y-0 right-0 z-50 flex w-full max-w-[23rem] flex-col border-l border-line bg-surface shadow-2xl shadow-ink-900/10 transition-transform duration-200",
          open ? "translate-x-0" : "translate-x-full",
        )}
      >
        <div className="flex items-center gap-2 border-b border-line px-3.5 py-2.5">
          <h2 className="min-w-0 flex-1 truncate text-[13px] font-bold text-ink-900">
            Notifications
            {unread > 0 && (
              <span className="ml-1.5 rounded-full bg-brand-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                {unread} new
              </span>
            )}
          </h2>

          <button
            type="button"
            onClick={() => toggleSound(muted, setMuted)}
            className="grid size-6 place-items-center rounded text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700"
            aria-label={muted ? "Turn the sound on" : "Turn the sound off"}
            title={muted ? "Sound off" : "Sound on"}
          >
            {muted ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5" />}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="grid size-6 place-items-center rounded text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700"
            aria-label="Close notifications"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* One track, one raised segment: four filled pills read as four
            buttons of equal weight, none of which looked chosen. */}
        <div className="flex items-center gap-0.5 overflow-x-auto border-b border-line px-3 py-2">
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
                  "flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11.5px] font-semibold transition-colors",
                  filter === entry.key
                    ? "bg-brand-600 text-white shadow-sm shadow-brand-600/25"
                    : "text-ink-500 hover:bg-ink-100 hover:text-ink-900",
                )}
              >
                {entry.label}
                <span
                  className={cn(
                    "rounded px-1 text-[10px] tabular-nums",
                    filter === entry.key ? "bg-white/20 text-white" : "bg-ink-100 text-ink-500",
                  )}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex-1 overflow-y-auto">
          {groups.length === 0 ? (
            <div className="px-4 py-14 text-center">
              <span className="mx-auto grid size-9 place-items-center rounded-full bg-brand-50">
                <Bell className="size-4 text-brand-400" />
              </span>
              <p className="mt-2 text-[12px] font-semibold text-ink-700">
                {filter === "all" ? "Nothing yet" : "Nothing here"}
              </p>
              <p className="mt-0.5 text-[11px] text-ink-400">
                {filter === "all"
                  ? "Tickets raised to your department show up here."
                  : "Try another filter."}
              </p>
            </div>
          ) : (
            groups.map((group) => (
              <section key={group.label}>
                <h3 className="sticky top-0 z-10 border-b border-line bg-ink-50/90 px-3.5 py-1 text-[10px] font-semibold tracking-[0.08em] text-ink-400 uppercase backdrop-blur">
                  {group.label}
                </h3>
                <div className="divide-y divide-line">
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
          <div className="flex items-center gap-2 border-t border-line px-3.5 py-2">
            <button
              type="button"
              onClick={() => void markAllRead()}
              disabled={unread === 0}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11.5px] font-semibold text-ink-600 transition-colors hover:bg-ink-100 hover:text-ink-900 disabled:opacity-40"
            >
              <CheckCheck className="size-3.5" />
              Mark all read
            </button>
            <button
              type="button"
              onClick={() => void clearAll()}
              className="flex items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11.5px] font-semibold text-ink-500 transition-colors hover:bg-brand-50 hover:text-brand-600"
            >
              <Trash2 className="size-3.5" />
              Clear
            </button>
          </div>
        )}
      </aside>
    </>
  );
}
