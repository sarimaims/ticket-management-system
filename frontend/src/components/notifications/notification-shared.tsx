"use client";

import Link from "next/link";
import {
  Building2,
  CalendarClock,
  CircleCheckBig,
  CircleSlash,
  HandHelping,
  MessageSquare,
  PencilLine,
  RefreshCw,
  TicketPlus,
  Trash2,
  UserRoundPlus,
} from "lucide-react";

import type {
  NotificationEvent,
  NotificationRecord,
  NotificationType,
} from "@/lib/notifications";
import { useAuth } from "@/components/auth/auth-provider";
import { canSeeAllTickets } from "@/lib/auth";
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
export const destination = (item: NotificationRecord, overseer = true) => {
  // The raiser reads a ticket on My Requests, the department on its own queue,
  // and a message goes to both - so the copy itself says which side it was
  // written for. Rows from before that flag fall back to the old rule: "new"
  // and "edited" are the department's business, "updated" is the raiser's.
  const forRaiser = item.forRaiser ?? item.type === "ticket.updated";
  // All Tickets rather than Assigned to Me for the department's side: the
  // latter now lists only what is on you by name, and a notification must land
  // on a page that actually holds the row it is about.
  // A plain user has no All Tickets, so their side of it is Assigned to Me.
  const page = forRaiser ? "/my-requests" : overseer ? "/all-tickets" : "/assigned-to-me";

  // A deleted ticket has no row left to find, so it just opens the list.
  if (item.type === "ticket.deleted") return page;

  // The id is exact; the number still finds the row if the id is missing.
  const key = item.ticket ?? item.ticketNumber;
  return key ? `${page}?ticket=${encodeURIComponent(key)}` : page;
};

type Meta = {
  icon: React.ComponentType<{ className?: string }>;
  /** The circle behind the icon: tinted, not filled. */
  badge: string;
  /** The solid bar an unread row wears, in the same hue as the circle. */
  rail: string;
  label: string;
};

/**
 * One look per kind of event, shared by the bell, the sheet and the toasts.
 *
 * Keyed on what happened rather than on which page it belongs to, because a
 * reader scanning the feed is asking "what became of it", and four different
 * answers all wearing the same update blue is four answers nobody can tell
 * apart. The colours are the ones those states already wear on a ticket -
 * green for finished, red for called off, amber for a date - so the feed and
 * the table agree without anybody learning a second scheme.
 */
export const EVENT_META: Record<NotificationEvent, Meta> = {
  raised: {
    icon: TicketPlus,
    badge: "bg-brand-50 text-brand-600",
    rail: "bg-brand-600",
    label: "New request",
  },
  completed: {
    icon: CircleCheckBig,
    badge: "bg-status-completed-bg text-status-completed-fg",
    rail: "bg-status-completed-fg",
    label: "Completed",
  },
  cancelled: {
    icon: CircleSlash,
    badge: "bg-status-overdue-bg text-status-overdue-fg",
    rail: "bg-status-overdue-fg",
    label: "Cancelled",
  },
  status: {
    icon: RefreshCw,
    badge: "bg-status-progress-bg text-status-progress-fg",
    rail: "bg-status-progress-fg",
    label: "Status",
  },
  promise: {
    icon: CalendarClock,
    badge: "bg-status-waiting-bg text-status-waiting-fg",
    rail: "bg-status-waiting-fg",
    label: "Deadline",
  },
  assigned: {
    icon: UserRoundPlus,
    badge: "bg-tile-admin-bg text-tile-admin-fg",
    rail: "bg-tile-admin-fg",
    label: "Assigned",
  },
  moved: {
    icon: Building2,
    badge: "bg-tile-admin-bg text-tile-admin-fg",
    rail: "bg-tile-admin-fg",
    label: "Moved",
  },
  edited: {
    icon: PencilLine,
    badge: "bg-status-accepted-bg text-status-accepted-fg",
    rail: "bg-status-accepted-fg",
    label: "Edited",
  },
  message: {
    icon: MessageSquare,
    badge: "bg-ink-100 text-ink-600",
    rail: "bg-ink-400",
    label: "Message",
  },
  handover: {
    icon: HandHelping,
    badge: "bg-tile-admin-bg text-tile-admin-fg",
    rail: "bg-tile-admin-fg",
    label: "Handover",
  },
  "handover.answered": {
    icon: HandHelping,
    badge: "bg-tile-admin-bg text-tile-admin-fg",
    rail: "bg-tile-admin-fg",
    label: "Handover",
  },
  deleted: {
    icon: Trash2,
    badge: "bg-status-overdue-bg text-status-overdue-fg",
    rail: "bg-status-overdue-fg",
    label: "Deleted",
  },
};

/** What each broad type meant before the finer action was recorded. */
const TYPE_FALLBACK: Record<NotificationType, NotificationEvent> = {
  "ticket.new": "raised",
  "ticket.updated": "status",
  "ticket.edited": "edited",
  "ticket.message": "message",
  "ticket.handover": "handover",
  "ticket.handover.answered": "handover.answered",
  "ticket.deleted": "deleted",
};

/**
 * Which action a row is, however old it is.
 *
 * Rows written before the action was recorded still have to read correctly, so
 * a missing one falls back to what its type used to mean.
 */
export function eventOf(item: NotificationRecord): NotificationEvent {
  return item.event ?? TYPE_FALLBACK[item.type] ?? "status";
}

export const metaFor = (item: NotificationRecord) => EVENT_META[eventOf(item)];

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
  const { session } = useAuth();
  const meta = metaFor(item);
  const Icon = meta.icon;

  // The ticket number opens almost every headline. Pulled out, it can carry
  // the brand and be found by eye; the rest of the line stays plain text.
  const rest =
    item.ticketNumber && item.title.startsWith(item.ticketNumber)
      ? item.title.slice(item.ticketNumber.length)
      : null;

  return (
    <Link
      href={destination(item, canSeeAllTickets(session)) as "/"}
      onClick={() => {
        if (!item.read) void onRead?.(item.id);
        onNavigate?.();
      }}
      className={cn(
        "group relative flex gap-2.5 transition-colors",
        compact ? "px-3 py-2" : "px-3.5 py-2.5",
        item.read ? "hover:bg-ink-50" : "bg-brand-50/40 hover:bg-brand-50/70",
      )}
    >
      {/* Unread wears a bar in its own colour: it survives scrolling past the
          icon, and says what kind of event it was before the row is read. */}
      {!item.read && (
        <span aria-hidden className={cn("absolute inset-y-0 left-0 w-[3px]", meta.rail)} />
      )}

      <span
        className={cn("mt-0.5 grid size-7 shrink-0 place-items-center rounded-full", meta.badge)}
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
            {rest === null ? (
              item.title
            ) : (
              <>
                <span className="font-bold text-brand-600">{item.ticketNumber}</span>
                {rest}
              </>
            )}
          </span>
          <span className="shrink-0 text-[10px] whitespace-nowrap text-ink-400 tabular-nums">
            {compact ? timeAgo(item.createdAt) : shortTime(item.createdAt)}
          </span>
        </span>

        <span className="mt-0.5 line-clamp-2 block text-[11.5px] leading-snug text-ink-600">
          {item.body}
        </span>

        {/* The icon already says what kind of event this was, so the chip that
            repeated it in words is gone; what is left is who and where. */}
        {(item.departmentName || item.actorName) && (
          <span className="mt-1 flex min-w-0 items-center gap-1 text-[10px] text-ink-400">
            {item.departmentName && (
              <span className="truncate rounded bg-ink-100 px-1.5 py-px font-semibold text-ink-600">
                {item.departmentName}
              </span>
            )}
            {item.actorName && <span className="truncate">{item.actorName}</span>}
          </span>
        )}
      </span>

      {!item.read && <span className={cn("mt-2 size-1.5 shrink-0 rounded-full", meta.rail)} />}
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
