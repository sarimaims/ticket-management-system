"use client";

import Link from "next/link";
import { MessageSquare, PencilLine, RefreshCw, TicketPlus } from "lucide-react";

import type { NotificationRecord, NotificationType } from "@/lib/notifications";
import { chime } from "@/lib/chime";
import { cn } from "@/lib/utils";

/**
 * Turning the sound back on plays it once. It proves the setting works, and
 * the click itself is the gesture browsers demand before any audio at all -
 * so the next real notification is heard rather than swallowed.
 */
export function toggleSound(muted: boolean, setMuted: (muted: boolean) => void) {
  const next = !muted;
  setMuted(next);
  if (!next) chime.newTicket();
}

/** "3 minutes ago" beats a timestamp for a list this recent. */
export function timeAgo(iso: string) {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";

  const steps: [number, string][] = [
    [60, "minute"],
    [60, "hour"],
    [24, "day"],
    [7, "week"],
  ];

  let value = seconds;
  let unit = "second";
  for (const [size, name] of steps) {
    if (value < size) break;
    value = Math.floor(value / size);
    unit = name;
  }
  return `${value} ${unit}${value === 1 ? "" : "s"} ago`;
}

/** Phone-style short time: the clock for today, the day for anything older. */
export function shortTime(iso: string) {
  const date = new Date(iso);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();

  if (sameDay) {
    return date
      .toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true })
      .toUpperCase();
  }
  return date.toLocaleDateString([], { day: "numeric", month: "short" });
}

/**
 * Where a notification sends you, and which row it means once you land.
 *
 * The page picks the ticket out of `?ticket=`, clears whatever filter would
 * have hidden it, scrolls it into view and flashes it - so the click ends on
 * the row it was about rather than at the top of a list.
 */
export const destination = (item: NotificationRecord) => {
  // The raiser reads a ticket on My Requests, the department on its own queue,
  // and a message goes to both - so the copy itself says which side it was
  // written for. Rows from before that flag fall back to the old rule: "new"
  // and "edited" are the department's business, "updated" is the raiser's.
  const forRaiser = item.forRaiser ?? item.type === "ticket.updated";
  const page = forRaiser ? "/my-requests" : "/assigned-to-me";

  // The id is exact; the number still finds the row if the id is missing.
  const key = item.ticket ?? item.ticketNumber;
  return key ? `${page}?ticket=${encodeURIComponent(key)}` : page;
};

type Meta = {
  icon: React.ComponentType<{ className?: string }>;
  /** The circle behind the icon: tinted, not filled. */
  badge: string;
  label: string;
};

/**
 * One look per kind of event, shared by the bell, the sheet and the toasts.
 *
 * The circles are washed rather than solid. Four saturated discs down a short
 * list read as four alerts of equal weight; a tint says the same thing and
 * leaves the headline as the loudest part of the row.
 */
export const TYPE_META: Record<NotificationType, Meta> = {
  "ticket.new": {
    icon: TicketPlus,
    badge: "bg-brand-50 text-brand-600",
    label: "New request",
  },
  "ticket.updated": {
    icon: RefreshCw,
    badge: "bg-status-progress-bg text-status-progress-fg",
    label: "Update",
  },
  "ticket.edited": {
    icon: PencilLine,
    badge: "bg-status-waiting-bg text-status-waiting-fg",
    label: "Edited",
  },
  "ticket.message": {
    icon: MessageSquare,
    badge: "bg-ink-100 text-ink-600",
    label: "Message",
  },
};

/**
 * One notification, as a row rather than a card.
 *
 * Cards inside a panel meant two borders and two radii around every line, and
 * a tinted box with a ring around the unread ones on top of that. A list reads
 * better flat: hairlines between rows, one soft icon, and unread carried by a
 * single dot and a heavier headline - the way Mail and Gmail have long done it.
 */
export function NotificationCard({
  item,
  onNavigate,
  onRead,
  compact,
}: {
  item: NotificationRecord;
  onNavigate?: () => void;
  onRead?: (id: string) => void | Promise<void>;
  compact?: boolean;
}) {
  const meta = TYPE_META[item.type] ?? TYPE_META["ticket.updated"];
  const Icon = meta.icon;

  return (
    <Link
      href={destination(item) as "/"}
      onClick={() => {
        if (!item.read) void onRead?.(item.id);
        onNavigate?.();
      }}
      className={cn(
        "group flex gap-2.5 transition-colors",
        compact ? "px-3 py-2" : "px-3.5 py-2.5",
        item.read ? "hover:bg-ink-50" : "bg-brand-50/30 hover:bg-brand-50/60",
      )}
    >
      <span
        className={cn(
          "mt-0.5 grid size-7 shrink-0 place-items-center rounded-full",
          meta.badge,
        )}
      >
        <Icon className="size-3.5" />
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-[12.5px] leading-snug",
              item.read ? "font-medium text-ink-700" : "font-bold text-ink-900",
            )}
          >
            {item.title}
          </span>
          <span className="shrink-0 text-[10px] whitespace-nowrap text-ink-400 tabular-nums">
            {compact ? timeAgo(item.createdAt) : shortTime(item.createdAt)}
          </span>
        </span>

        <span className="mt-0.5 line-clamp-2 block text-[11.5px] leading-snug text-ink-500">
          {item.body}
        </span>

        {/* The icon already says what kind of event this was, so the chip that
            repeated it in words is gone; what is left is who and where. */}
        {(item.departmentName || item.actorName) && (
          <span className="mt-1 block truncate text-[10px] text-ink-400">
            {[item.departmentName, item.actorName].filter(Boolean).join(" · ")}
          </span>
        )}
      </span>

      {!item.read && <span className="mt-2 size-1.5 shrink-0 rounded-full bg-brand-600" />}
    </Link>
  );
}

/** Today / Yesterday / a date - the heading a phone puts above each run. */
export function dayLabel(iso: string) {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString([], { day: "numeric", month: "long", year: "numeric" });
}

/** Groups a feed into runs of one day, newest first, order preserved. */
export function groupByDay(items: NotificationRecord[]) {
  const groups: { label: string; items: NotificationRecord[] }[] = [];

  for (const item of items) {
    const label = dayLabel(item.createdAt);
    const last = groups.at(-1);
    if (last?.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }

  return groups;
}
