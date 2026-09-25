"use client";

import { useEffect, useMemo, useState } from "react";
import { Bell, CheckCheck, Search, Trash2, Volume2, VolumeX, X } from "lucide-react";

import { useNotifications } from "@/components/notifications/notification-provider";
import {
  NotificationCard,
  eventOf,
  groupByDay,
  toggleSound,
} from "@/components/notifications/notification-shared";
import type { NotificationEvent, NotificationRecord } from "@/lib/notifications";
import { cn } from "@/lib/utils";

type Filter =
  | "all"
  | "unread"
  | "requests"
  | "status"
  | "deadlines"
  | "people"
  | "messages";

/**
 * What each filter answers, in terms of the action a row records.
 *
 * Grouped the way somebody would ask for them rather than one chip per event:
 * "what finished or was called off" is one question, and three chips for
 * completed, cancelled and reopened would only split the same glance in three.
 */
const MATCHES: Record<Exclude<Filter, "all" | "unread">, NotificationEvent[]> = {
  requests: ["raised"],
  status: ["completed", "cancelled", "status", "edited"],
  deadlines: ["promise"],
  people: ["assigned", "moved", "handover", "handover.answered"],
  messages: ["message"],
};

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "requests", label: "New" },
  { key: "status", label: "Status" },
  { key: "deadlines", label: "Deadlines" },
  { key: "people", label: "People" },
  { key: "messages", label: "Messages" },
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
  /** Free text over the headline, the line under it, and the ticket number. */
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  /** Whether a row answers one chip. Counting and filtering ask the same question. */
  const inFilter = (item: NotificationRecord, key: Filter) => {
    if (key === "all") return true;
    if (key === "unread") return !item.read;
    return MATCHES[key].includes(eventOf(item));
  };

  const rows = useMemo(() => {
    const term = query.trim().toLowerCase();

    return items.filter((item) => {
      if (!inFilter(item, filter)) return false;
      if (!term) return true;
      return `${item.ticketNumber} ${item.title} ${item.body} ${item.departmentName} ${item.actorName}`
        .toLowerCase()
        .includes(term);
    });
  }, [items, filter, query]);

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

        {/* A feed of forty rows is faster to search than to scroll, and the
            thing people remember is the ticket number. */}
        <div className="relative border-b border-line">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-ink-400" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search notifications"
            aria-label="Search notifications"
            className="h-9 w-full bg-transparent pr-8 pl-8 text-[12.5px] text-ink-900 placeholder:text-ink-400 focus:outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear the search"
              className="absolute top-1/2 right-2.5 grid size-5 -translate-y-1/2 place-items-center rounded-full text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700"
            >
              <X className="size-3" strokeWidth={3} />
            </button>
          )}
        </div>

        {/* One track, one raised segment: filled pills of equal weight read as
            buttons, none of which looked chosen. */}
        <div className="flex items-center gap-0.5 overflow-x-auto border-b border-line px-3 py-2">
          {FILTERS.map((entry) => {
            const count =
              entry.key === "unread"
                ? unread
                : items.filter((item) => inFilter(item, entry.key)).length;

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
                {query ? "Nothing matches" : filter === "all" ? "Nothing yet" : "Nothing here"}
              </p>
              <p className="mt-0.5 text-[11px] text-ink-400">
                {query
                  ? `No notification mentions “${query}”.`
                  : filter === "all"
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
