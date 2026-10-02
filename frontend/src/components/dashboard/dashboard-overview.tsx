"use client";

import { useCallback, useEffect, useMemo, useState, type ComponentType } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowRightLeft,
  ArrowUpRight,
  BadgeCheck,
  Building,
  CalendarCheck,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleCheckBig,
  Flag,
  Inbox,
  Layers,
  Loader,
  MessageSquare,
  PencilLine,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Siren,
  Trash2,
  Undo2,
  UserCog,
  UserPlus,
  UserX,
  X,
} from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { ACTION_LABELS } from "@/components/activity/activity-log";
import { TodoBrief } from "@/components/dashboard/todo-brief";
import { DepartmentChart, type DepartmentPoint } from "@/components/dashboard/department-chart";
import {
  ActionNeeded,
  Card,
  DailyActivity,
  Deadlines,
  FooterLink,
  KpiCard,
  OpenTrend,
  StatusDonut,
  WorkTable,
  type ActionNote,
  type Kpi,
  type WorkTab,
} from "@/components/dashboard/home-widgets";
import { TicketDetailSheet, type SheetTab } from "@/components/tickets/ticket-detail-sheet";
import { PriorityBadge, StatusBadge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useLiveDashboard } from "@/hooks/use-live-dashboard";
import { isAdmin } from "@/lib/auth";
import {
  isAwaitingApproval,
  isDueTodayOnly,
  isOverdue,
  type DashboardData,
  type DashboardLens,
  type DashboardTicket,
  type DashboardUpdate,
} from "@/lib/tickets";
import { isClosed, isSettled } from "@/lib/types";
import { cn } from "@/lib/utils";

import {
  byUpdated,
  DAY,
  departmentNames,
  departmentsOf,
  dueOf,
  firstName,
  holders,
  isOpen,
  openFirst,
  relativeTime,
  TAB,
  TONES,
  when,
  type ListSpec,
} from "./dashboard-utils";

/* ---------------------------------------------------------------- helpers */

function departmentSeries(tickets: DashboardTicket[]): DepartmentPoint[] {
  const load = new Map<string, number>();

  for (const ticket of tickets.filter(isOpen)) {
    // A shared ticket is open work for each department it went to.
    for (const department of departmentsOf(ticket)) {
      const name = department.name?.trim() || department.code?.trim() || "Unassigned";
      load.set(name, (load.get(name) ?? 0) + 1);
    }
  }

  return [...load.entries()]
    .map(([department, count]) => ({ department, tickets: count }))
    .sort((left, right) => right.tickets - left.tickets)
    .slice(0, 6);
}

function Empty({
  icon: Icon = CheckCircle2,
  title,
  note,
}: {
  icon?: ComponentType<{ className?: string }>;
  title: string;
  note: string;
}) {
  return (
    <p className="flex flex-col items-center gap-2 py-8 text-center">
      <Icon
        className={cn("size-6", Icon === CheckCircle2 ? "text-status-completed-fg" : "text-ink-300")}
      />
      <span className="text-[13px] font-semibold text-ink-700">{title}</span>
      <span className="text-[11px] text-ink-400">{note}</span>
    </p>
  );
}

/* ------------------------------------------------------------- list window */

/** One ticket in the list: who it is for and where it stands, at a glance. */
function ListRow({
  ticket,
  onOpen,
}: {
  ticket: DashboardTicket;
  onOpen: (ticket: DashboardTicket) => void;
}) {
  const due = dueOf(ticket);
  const late = isOverdue(ticket);

  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(ticket)}
        className="group flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-ink-50 focus-visible:bg-ink-50 focus-visible:outline-none"
      >
        <span className="shrink-0 rounded-md bg-royal-50 px-1.5 py-0.5 font-mono text-[10.5px] font-bold text-royal-700 ring-1 ring-royal-100">
          {ticket.number}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-ink-900 group-hover:text-royal-700">
            {ticket.subject}
          </span>
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-ink-400">
            <span className="truncate">{departmentNames(ticket)}</span>
            <span aria-hidden className="text-ink-300">·</span>
            <span className="shrink-0">{holders(ticket)}</span>
            {due && !isClosed(ticket.status) && (
              <>
                <span aria-hidden className="text-ink-300">·</span>
                <span
                  className={cn(
                    "shrink-0",
                    late ? "font-semibold text-status-overdue-fg" : "text-ink-500",
                  )}
                >
                  {when(due)}
                </span>
              </>
            )}
          </span>
        </span>

        <PriorityBadge priority={ticket.priority} className="hidden shrink-0 sm:inline-flex" />
        <StatusBadge status={ticket.status} className="shrink-0" />
        <ArrowUpRight className="size-3.5 shrink-0 text-ink-300 transition-colors group-hover:text-royal-600" />
      </button>
    </li>
  );
}

/**
 * The tickets behind a number, listed in place.
 *
 * Its own shell rather than the plain dialog: the count sits in the number's
 * colour so the two read as one thing, tabs split it where that helps, a
 * search narrows a long list without leaving it, and a row opens the ticket
 * as it does everywhere else here. Where a page lists the same tickets with
 * more filters, the foot offers it - offered, not forced.
 */
function TicketListModal({
  spec,
  onClose,
  onOpen,
}: {
  spec: ListSpec | null;
  onClose: () => void;
  onOpen: (ticket: DashboardTicket) => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState(spec?.initialFilter ?? spec?.filters?.[0]?.key ?? "");

  useEffect(() => {
    if (!spec) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [spec, onClose]);

  if (!spec) return null;

  const tab = spec.filters?.find((item) => item.key === filter) ?? spec.filters?.[0];
  const all = [...(tab ? tab.list : (spec.list ?? []))].sort(byUpdated);
  const term = query.trim().toLowerCase();
  const shown = term
    ? all.filter((ticket) =>
        `${ticket.number} ${ticket.subject} ${departmentNames(ticket)} ${holders(ticket)}`
          .toLowerCase()
          .includes(term),
      )
    : all;
  const fuller = spec.href && spec.href.startsWith("/") ? spec.href : null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8">
      <div
        className="fixed inset-0 bg-ink-900/40 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${spec.label}: ${spec.value}`}
        className="relative z-10 my-auto flex max-h-[min(80vh,44rem)] w-full max-w-2xl animate-island-open flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl shadow-ink-900/25"
      >
        <div className="flex items-start gap-3 px-5 pt-4 pb-3">
          <span
            className={cn(
              "grid h-11 min-w-11 shrink-0 place-items-center rounded-xl px-2 text-[20px] leading-none font-bold tabular-nums",
              tab ? tab.tint : TONES[spec.tone],
            )}
          >
            {tab ? tab.list.length : spec.value}
          </span>
          <div className="min-w-0 flex-1 pt-0.5">
            <h2 className="truncate text-[15px] font-bold tracking-tight text-ink-900">{spec.label}</h2>
            <p className="mt-0.5 truncate text-[12px] text-ink-500">{spec.caption}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid size-8 shrink-0 place-items-center rounded-lg text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* The tabs: each a slice in its own colour. The one in view is filled
            with it; the rest stay quiet until hovered. */}
        {spec.filters && (
          <div role="tablist" aria-label="Show" className="flex flex-wrap gap-1 px-5 pb-3">
            {spec.filters.map((item) => {
              const active = item.key === tab?.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => {
                    setFilter(item.key);
                    setQuery("");
                  }}
                  className={cn(
                    "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[12px] transition-all",
                    active
                      ? cn("font-semibold ring-1", item.tint)
                      : "font-medium text-ink-500 hover:bg-ink-50 hover:text-ink-800",
                  )}
                >
                  {!active && <span className={cn("size-1.5 rounded-full", item.dot)} aria-hidden="true" />}
                  {item.label}
                  <span className={cn("tabular-nums", active ? "font-bold" : "text-ink-400")}>
                    {item.list.length}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Worth having once the list outgrows a glance. */}
        {all.length > 5 && (
          <div className="px-5 pb-3">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-ink-400" />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by ticket ID, subject, department or person"
                aria-label="Search these tickets"
                className="h-9 w-full rounded-lg border border-line-strong bg-ink-50/60 pr-3 pl-8 text-[13px] text-ink-900 transition-colors placeholder:text-ink-400 focus:border-brand-400 focus:bg-surface focus:ring-2 focus:ring-brand-500/10 focus:outline-none"
              />
            </div>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto border-t border-line px-2.5 py-2">
          {all.length === 0 ? (
            <Empty title="Nothing here" note="No tickets in this count right now." />
          ) : shown.length === 0 ? (
            <Empty icon={Search} title="No matches" note="Try a ticket ID or a different word." />
          ) : (
            <ul className="space-y-0.5">
              {shown.map((ticket) => (
                <ListRow key={ticket.id} ticket={ticket} onOpen={onOpen} />
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-line bg-ink-50/50 px-5 py-2.5">
          <p className="text-[11px] text-ink-400">
            {term ? (
              <>
                <span className="font-bold text-ink-700">{shown.length}</span> of {all.length} tickets
              </>
            ) : (
              <>
                <span className="font-bold text-ink-700">{all.length}</span>{" "}
                {all.length === 1 ? "ticket" : "tickets"} · newest activity first
              </>
            )}
          </p>
          {fuller && (
            <Link
              href={fuller as "/"}
              onClick={onClose}
              className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-royal-700 hover:text-royal-800"
            >
              Open with filters
              <ArrowUpRight className="size-3.5" />
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ feed */

/** A tint pair from the status tokens: the icon's wash and its ink. */
const TINT = {
  royal: "bg-royal-50 text-royal-700",
  progress: "bg-status-progress-bg text-status-progress-fg",
  accepted: "bg-status-accepted-bg text-status-accepted-fg",
  admin: "bg-tile-admin-bg text-tile-admin-fg",
  waiting: "bg-status-waiting-bg text-status-waiting-fg",
  resolved: "bg-status-resolved-bg text-status-resolved-fg",
  completed: "bg-status-completed-bg text-status-completed-fg",
  rejected: "bg-status-rejected-bg text-status-rejected-fg",
  escalated: "bg-status-escalated-bg text-status-escalated-fg",
  overdue: "bg-status-overdue-bg text-status-overdue-fg",
  chat: "bg-chat-accent/10 text-chat-accent",
  slate: "bg-ink-100 text-ink-600",
} as const;

type Look = { icon: ComponentType<{ className?: string }>; tint: string; label: string };

/**
 * What a line of the feed looks like: an icon and a tint for what happened.
 *
 * Most lines are "raised" or "updated", so an update is read a step further -
 * a status change, a promised date, a hand-over, a new priority each wear
 * their own colour. The colour always rides with a label, never alone.
 */
function lookOf(entry: DashboardUpdate): Look {
  const summary = entry.summary.toLowerCase();

  switch (entry.action) {
    case "ticket.created":
      return { icon: Plus, tint: TINT.royal, label: "Raised" };
    case "ticket.updated":
      if (summary.includes("status")) return { icon: ArrowRightLeft, tint: TINT.progress, label: "Status changed" };
      if (summary.includes("promised")) return { icon: CalendarCheck, tint: TINT.accepted, label: "Date promised" };
      if (summary.includes("assign") || summary.includes("handed") || summary.includes("picked up"))
        return { icon: UserPlus, tint: TINT.admin, label: "Assigned" };
      if (summary.includes("priority")) return { icon: Flag, tint: TINT.waiting, label: "Priority changed" };
      if (summary.includes("deadline") || summary.includes("due"))
        return { icon: CalendarClock, tint: TINT.waiting, label: "Date changed" };
      return { icon: PencilLine, tint: TINT.progress, label: "Updated" };
    case "ticket.resolved":
      return { icon: CheckCircle2, tint: TINT.resolved, label: "Resolved" };
    case "ticket.approved":
    case "ticket.auto_approved":
      return { icon: BadgeCheck, tint: TINT.completed, label: ACTION_LABELS[entry.action] ?? "Approved" };
    case "ticket.rejected":
      return { icon: Undo2, tint: TINT.rejected, label: "Sent back" };
    case "ticket.escalated":
      return { icon: Siren, tint: TINT.escalated, label: "Escalated" };
    case "ticket.escalation_handled":
      return { icon: ShieldCheck, tint: TINT.completed, label: "Escalation handled" };
    case "ticket.deleted":
      return { icon: Trash2, tint: TINT.overdue, label: "Deleted" };
    case "message.edited":
    case "message.deleted":
      return { icon: MessageSquare, tint: TINT.chat, label: ACTION_LABELS[entry.action] ?? "Message" };
    default:
      if (entry.action.startsWith("member.")) {
        return { icon: UserCog, tint: TINT.admin, label: ACTION_LABELS[entry.action] ?? "Member" };
      }
      if (entry.action.startsWith("department.") || entry.action.startsWith("unit.")) {
        return { icon: Building, tint: TINT.slate, label: ACTION_LABELS[entry.action] ?? "Changed" };
      }
      return { icon: Activity, tint: TINT.slate, label: ACTION_LABELS[entry.action] ?? "Update" };
  }
}

/** A summary with its ticket numbers picked out, so the eye finds them first. */
function SummaryText({ text }: { text: string }) {
  return (
    <>
      {text.split(/(TK-\d+)/).map((part, index) =>
        /^TK-\d+$/.test(part) ? (
          <span key={index} className="font-semibold text-royal-700">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}

/** How many lines the activity card shows; the whole log is one click away. */
const ACTIVITY_ROWS = 6;

/**
 * The latest few things that happened on the reader's tickets - the server
 * has already drawn the reach, so this only picks whose. A head gets a small
 * switch to "Team": their queue and their people's requests that are not
 * their own, so the two never mix in one list.
 */
function ActivityCard({
  entries,
  lens,
  now,
  openable,
  onOpen,
}: {
  entries: DashboardUpdate[];
  lens: DashboardLens;
  now: number | null;
  openable: Map<string, DashboardTicket>;
  onOpen: (ticket: DashboardTicket) => void;
}) {
  // A head with nothing of their own yet opens on the team, not on an empty list.
  const [scope, setScope] = useState<"mine" | "team">(() =>
    lens === "head" && !entries.some((entry) => entry.mine) ? "team" : "mine",
  );
  const team = lens === "head" && scope === "team";
  const shown = entries.filter((entry) => (team ? !entry.mine : entry.mine)).slice(0, ACTIVITY_ROWS);

  return (
    <Card
      title={team ? "Team activity" : "My activities"}
      caption={team ? "On your queue and your team's requests" : "On the tickets you are part of"}
      footer={<FooterLink href="/activity">See all activity</FooterLink>}
      action={
        lens === "head" ? (
          <span role="tablist" aria-label="Whose activity" className="inline-flex shrink-0 rounded-full bg-ink-100 p-0.5">
            {(["mine", "team"] as const).map((item) => (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={scope === item}
                onClick={() => setScope(item)}
                className={cn(
                  "cursor-pointer rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition-colors",
                  scope === item ? "bg-surface text-ink-900 shadow-sm" : "text-ink-500 hover:text-ink-800",
                )}
              >
                {item === "mine" ? "My" : "Team"}
              </button>
            ))}
          </span>
        ) : undefined
      }
    >
      {shown.length > 0 ? (
        <ul className="-mx-2 space-y-0.5">
          {shown.map((entry) => {
            const ticket = entry.ticketId ? openable.get(entry.ticketId) : undefined;
            const look = lookOf(entry);
            const Icon = look.icon;
            const body = (
              <>
                <span className={cn("mt-0.5 grid size-7 shrink-0 place-items-center rounded-full", look.tint)}>
                  <Icon className="size-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 text-[12px] leading-snug text-ink-700">
                    <span className="font-semibold text-ink-900">
                      {entry.actor.isMe ? "You" : entry.actor.name}
                    </span>{" "}
                    <SummaryText text={entry.summary} />
                  </span>
                  <span className="mt-0.5 block truncate text-[10.5px] text-ink-400">
                    {look.label} · {relativeTime(entry.createdAt, now)}
                  </span>
                </span>
              </>
            );

            return (
              <li key={entry.id}>
                {ticket ? (
                  <button
                    type="button"
                    onClick={() => onOpen(ticket)}
                    className="flex w-full cursor-pointer items-start gap-2.5 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-ink-50"
                  >
                    {body}
                  </button>
                ) : (
                  <div className="flex items-start gap-2.5 px-2 py-1.5">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <Empty
          icon={Inbox}
          title="No activity yet"
          note={team ? "Nothing has moved on your team's tickets." : "Changes to your tickets land here."}
        />
      )}
    </Card>
  );
}

/* ---------------------------------------------------------------- workload */

type Load = {
  id: string;
  name: string;
  designation: string;
  /** Their open tickets, newest activity first - what a click lists. */
  tickets: DashboardTicket[];
  open: number;
  late: number;
  /** Completed in the last seven days, so a quiet desk can still be a busy week. */
  doneWeek: number;
  /** Their completed tickets, newest activity first. */
  completedTickets: DashboardTicket[];
};

/**
 * Who in the head's departments carries what. Counted only for the
 * departments the head runs - a shared ticket's other holders are another
 * head's people.
 */
function workloadOf(queue: DashboardTicket[], headed: Set<string>) {
  const rows = new Map<string, Load>();
  const unassigned: DashboardTicket[] = [];
  const weekAgo = Date.now() - 7 * DAY;

  const peopleOf = (ticket: DashboardTicket) =>
    ticket.assignees.filter((person) => !person.departmentId || headed.has(person.departmentId));

  const rowFor = (person: DashboardTicket["assignees"][number]) => {
    const existing = rows.get(person.id);
    if (existing) return existing;
    const row: Load = {
      id: person.id,
      name: person.name ?? "Someone",
      designation: person.designation ?? "",
      tickets: [],
      open: 0,
      late: 0,
      doneWeek: 0,
      completedTickets: [],
    };
    rows.set(person.id, row);
    return row;
  };

  for (const ticket of [...queue].sort(byUpdated)) {
    const people = peopleOf(ticket);

    if (isOpen(ticket)) {
      if (people.length === 0) {
        unassigned.push(ticket);
        continue;
      }
      for (const person of people) {
        const row = rowFor(person);
        row.tickets.push(ticket);
        row.open += 1;
        if (isOverdue(ticket)) row.late += 1;
      }
    } else if (ticket.status === "Completed") {
      const thisWeek = Date.parse(ticket.completedAt ?? ticket.updatedAt) >= weekAgo;
      for (const person of people) {
        const row = rowFor(person);
        row.completedTickets.push(ticket);
        if (thisWeek) row.doneWeek += 1;
      }
    }
  }

  const list = [...rows.values()].sort(
    (left, right) => right.open - left.open || right.late - left.late || right.doneWeek - left.doneWeek,
  );

  return { rows: list, unassigned };
}

/** The four slices of a person's work, as tabs and as tiles - one definition for both. */
const WORKLOAD_FILTERS = [
  { key: "open", label: "Open", ...TAB.open, pick: (row: Load) => row.tickets },
  {
    key: "new",
    label: "New",
    ...TAB.new,
    pick: (row: Load) => row.tickets.filter((ticket) => ticket.status === "New"),
  },
  {
    key: "progress",
    label: "In progress",
    ...TAB.progress,
    pick: (row: Load) => row.tickets.filter((ticket) => ticket.status === "In Progress"),
  },
  { key: "completed", label: "Completed", ...TAB.done, pick: (row: Load) => row.completedTickets },
] as const;

/**
 * The tickets behind a workload card, shaped for the list window: a person's
 * work with a tab per slice, opened on the slice that was clicked.
 */
function workloadList(load: ReturnType<typeof workloadOf>, key: string, filter = "open"): ListSpec | null {
  if (key === "unassigned") {
    return {
      label: "Not picked up",
      value: load.unassigned.length,
      caption: "Open in your departments, waiting for an owner",
      tone: "amber",
      list: load.unassigned,
    };
  }
  const row = load.rows.find((item) => item.id === key);
  if (!row) return null;
  return {
    label: row.name,
    value: row.open,
    caption: row.designation || "Their tickets",
    tone: "royal",
    filters: WORKLOAD_FILTERS.map((item) => ({
      key: item.key,
      label: item.label,
      dot: item.dot,
      tint: item.tint,
      list: item.pick(row),
    })),
    initialFilter: filter,
  };
}

/** How long something has waited, in whole days. */
function waitedFor(since: string) {
  const days = Math.floor((Date.now() - Date.parse(since)) / DAY);
  return days <= 0 ? "since today" : `${days} ${days === 1 ? "day" : "days"}`;
}

/** The workload list's columns: who, then one narrow column per slice. */
// Narrow enough to share a row with the to-dos: the four number columns give
// way before the names do.
const WORKLOAD_GRID = "grid grid-cols-[minmax(6rem,1fr)_repeat(4,minmax(0,3.75rem))] items-center gap-x-1";

/**
 * The team's load as one quiet list: a row per person, four plain numbers in
 * columns that read straight down - open, new, in progress, completed. The
 * colour lives only in the dots of the column headings; a zero fades so the
 * real numbers stand out. A name opens all their open work, a number opens
 * just that slice, and what nobody has taken is one line above the list.
 */
function WorkloadPanel({
  load,
  meId,
  onShow,
}: {
  load: ReturnType<typeof workloadOf>;
  meId?: string;
  onShow: (key: string, filter?: string) => void;
}) {
  const oldestWaiting = load.unassigned.reduce<string | null>(
    (oldest, ticket) => (!oldest || ticket.createdAt < oldest ? ticket.createdAt : oldest),
    null,
  );
  const people = load.rows.length;

  return (
    <Card
      title="Team workload"
      caption={`${people} ${people === 1 ? "person" : "people"} · click a number to see those tickets`}
      action={
        <Link
          href="/team"
          className="inline-flex shrink-0 items-center gap-1 text-[11.5px] font-semibold text-royal-700 hover:text-royal-800"
        >
          Your team
          <ArrowUpRight className="size-3.5" />
        </Link>
      }
    >
      {people > 0 || load.unassigned.length > 0 ? (
        <>
          {load.unassigned.length > 0 && (
            <button
              type="button"
              onClick={() => onShow("unassigned")}
              className="group mb-3 flex w-full cursor-pointer items-center gap-2 rounded-lg bg-status-waiting-bg/40 px-3 py-2 text-left text-[12px] text-ink-600 transition-colors hover:bg-status-waiting-bg/70"
            >
              <span className="size-1.5 shrink-0 rounded-full bg-status-waiting-fg" aria-hidden="true" />
              <span className="font-bold text-ink-900 tabular-nums">{load.unassigned.length}</span>
              not picked up
              {oldestWaiting && (
                <span className="truncate text-ink-400">· oldest waiting {waitedFor(oldestWaiting)}</span>
              )}
              <ChevronRight className="ml-auto size-3.5 shrink-0 text-ink-300 transition-transform group-hover:translate-x-0.5" />
            </button>
          )}

          {people > 0 && (
            <div role="table" aria-label="Team workload">
              <div
                role="row"
                className={cn(
                  WORKLOAD_GRID,
                  "border-b border-line pb-1.5 text-[10.5px] font-medium text-ink-400",
                )}
              >
                <span role="columnheader">Person</span>
                {WORKLOAD_FILTERS.map((item) => (
                  <span
                    key={item.key}
                    role="columnheader"
                    className="flex flex-col items-center gap-1 text-center leading-tight"
                  >
                    <span className={cn("size-1.5 shrink-0 rounded-full", item.dot)} aria-hidden="true" />
                    <span>{item.label}</span>
                  </span>
                ))}
              </div>

              <div className="divide-y divide-line">
                {load.rows.map((row) => (
                  <div key={row.id} role="row" className={cn(WORKLOAD_GRID, "py-1.5")}>
                    <button
                      type="button"
                      role="cell"
                      onClick={() => onShow(row.id, "open")}
                      className="group min-w-0 cursor-pointer rounded-md px-1 py-1 text-left -ml-1 transition-colors hover:bg-ink-50"
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-[12.5px] font-semibold text-ink-900 group-hover:text-royal-700">
                          {row.name}
                        </span>
                        {row.id === meId && (
                          <span className="shrink-0 rounded-full bg-royal-50 px-1.5 text-[9.5px] font-bold text-royal-700 ring-1 ring-royal-100">
                            You
                          </span>
                        )}
                      </span>
                      <span className="block truncate text-[10.5px] text-ink-400">
                        {row.designation || "Team member"}
                      </span>
                    </button>

                    {WORKLOAD_FILTERS.map((item) => {
                      const value = item.pick(row).length;
                      return (
                        <button
                          key={item.key}
                          type="button"
                          role="cell"
                          onClick={() => onShow(row.id, item.key)}
                          title={`${row.name}: ${value} ${item.label.toLowerCase()}`}
                          className={cn(
                            "cursor-pointer rounded-md py-1.5 text-center text-[13.5px] font-semibold tabular-nums transition-colors hover:bg-ink-50 hover:text-royal-700",
                            value === 0 ? "text-ink-300" : "text-ink-900",
                          )}
                        >
                          {value}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <Empty title="Nothing open in your queue" note="Your team has a clear desk." />
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ views */

/**
 * Everything the page shows, worked out once per answer from the server.
 *
 * Three readers, three reaches - the server has already drawn them: a
 * member's own tickets; a head's own plus everything to or from the
 * departments they run; a manager's whole workspace. The headline numbers
 * read left to right from the whole reach - everything, completed, in
 * progress - to the reader's own: what is on them, what they asked for, and
 * what falls due today.
 */
function shape(data: DashboardData) {
  const { lens, tickets } = data;
  const open = tickets.filter(isOpen);

  const myRequests = tickets.filter((ticket) => ticket.relation.mine.includes("raised")).sort(byUpdated);
  const myOpenRequests = myRequests.filter(isOpen);
  const approvals = myRequests.filter(isAwaitingApproval);
  const waitingOwner = myOpenRequests.filter(
    (ticket) => ticket.assignees.length === 0 && !isSettled(ticket.status),
  );

  // On the reader by name, or asked of them and waiting on a yes.
  const assignedToMe = tickets
    .filter((ticket) => ticket.relation.mine.includes("assigned") || ticket.relation.mine.includes("asked"))
    .sort(byUpdated);
  const myDesk = assignedToMe.filter(isOpen);
  const asks = myDesk.filter((ticket) => ticket.relation.mine.includes("asked"));
  const deskToday = myDesk.filter(isDueTodayOnly);

  // What the reader answers for: a member's own desk, a head's queue, a manager's all.
  const queue =
    lens === "member"
      ? tickets.filter((ticket) => ticket.relation.mine.includes("assigned"))
      : lens === "head"
        ? tickets.filter((ticket) => ticket.relation.team.includes("queue"))
        : tickets;
  const openQueue = queue.filter(isOpen);
  const overdue = openQueue.filter(isOverdue);
  const today = openQueue.filter(isDueTodayOnly);
  const unassigned = openQueue.filter((ticket) => ticket.assignees.length === 0);
  const weekAgo = Date.now() - 7 * DAY;

  const escalations = open.filter((ticket) => ticket.escalation?.status === "open");

  const where = lens === "member" ? "On your desk" : lens === "head" ? "In your queue" : "Across the workspace";
  const reach =
    lens === "manager"
      ? "Every ticket in the workspace"
      : lens === "head"
        ? "Yours, and everything to or from your departments"
        : "Every ticket you are part of";
  const board = lens === "member" ? "/assigned-to-me" : "/all-tickets";

  // The whole reach, by where it stands. Only a manager's reach is exactly what
  // All Tickets lists, so only theirs offers that page from the list.
  const completed = tickets.filter((ticket) => ticket.status === "Completed");
  const completedRecent = completed.filter(
    (ticket) => Date.parse(ticket.completedAt ?? ticket.updatedAt) >= weekAgo,
  );
  const cancelled = tickets.filter((ticket) => ticket.status === "Cancelled");
  const inProgress = tickets.filter((ticket) => ticket.status === "In Progress");
  const progressLate = inProgress.filter(isOverdue);
  const linked = lens === "manager";

  const kpis: Kpi[] = [
    {
      key: "all",
      label: "All tickets",
      value: tickets.length,
      caption: `${open.length} open`,
      icon: Layers,
      theme: "blue",
      spec: {
        label: "All tickets",
        value: tickets.length,
        caption: reach,
        tone: "royal",
        href: linked ? "/all-tickets?status=all" : undefined,
        filters: [
          { key: "all", label: "All", ...TAB.open, list: tickets },
          { key: "open", label: "Open", ...TAB.progress, list: open },
          { key: "done", label: "Completed", ...TAB.done, list: completed },
          { key: "cancelled", label: "Cancelled", ...TAB.waiting, list: cancelled },
        ],
      },
    },
    {
      key: "done",
      label: "Completed",
      value: completed.length,
      caption: completedRecent.length ? `${completedRecent.length} in the last 7 days` : "none in the last 7 days",
      icon: CircleCheckBig,
      theme: "green",
      spec: {
        label: "Completed",
        value: completed.length,
        caption: reach,
        tone: "completed",
        href: linked ? "/all-tickets?status=Completed" : undefined,
        filters: [
          { key: "all", label: "All time", ...TAB.done, list: completed },
          { key: "week", label: "Last 7 days", ...TAB.open, list: completedRecent },
        ],
      },
    },
    {
      key: "progress",
      label: "In progress",
      value: inProgress.length,
      caption: progressLate.length
        ? `${progressLate.length} running late`
        : inProgress.length
          ? "being worked on"
          : "nothing in progress",
      icon: Loader,
      theme: "violet",
      spec: {
        label: "In progress",
        value: inProgress.length,
        caption: reach,
        tone: "progress",
        href: linked ? "/all-tickets?status=In%20Progress" : undefined,
        filters: [
          { key: "all", label: "All", ...TAB.progress, list: inProgress },
          { key: "late", label: "Running late", ...TAB.late, list: progressLate },
        ],
      },
    },
    {
      key: "desk",
      label: "Assigned to me",
      value: myDesk.length,
      caption: asks.length
        ? `${asks.length} asked of you`
        : deskToday.length
          ? `${deskToday.length} due today`
          : myDesk.length
            ? "open on your desk"
            : "nothing on your desk",
      icon: Inbox,
      theme: "sky",
      spec: {
        label: "Assigned to me",
        value: myDesk.length,
        caption: "On you, or asked of you",
        tone: "royal",
        href: "/assigned-to-me",
        filters: [
          { key: "open", label: "Open", ...TAB.open, list: myDesk },
          { key: "today", label: "Due today", ...TAB.today, list: deskToday },
          { key: "late", label: "Late", ...TAB.late, list: myDesk.filter(isOverdue) },
          {
            key: "done",
            label: "Completed",
            ...TAB.done,
            list: assignedToMe.filter((ticket) => ticket.status === "Completed"),
          },
        ],
      },
    },
    {
      key: "requests",
      label: "My requests",
      value: myOpenRequests.length,
      caption: approvals.length
        ? `${approvals.length} awaiting your approval`
        : waitingOwner.length
          ? `${waitingOwner.length} not picked up yet`
          : myOpenRequests.length
            ? "open requests you raised"
            : "none open",
      icon: Send,
      theme: "pink",
      spec: {
        label: "My requests",
        value: myOpenRequests.length,
        caption: "What you asked other departments for",
        tone: "violet",
        href: "/my-requests",
        filters: [
          { key: "open", label: "Open", ...TAB.open, list: myOpenRequests },
          { key: "approval", label: "Awaiting approval", ...TAB.approval, list: approvals },
          { key: "waiting", label: "Not picked up", ...TAB.waiting, list: waitingOwner },
          {
            key: "done",
            label: "Completed",
            ...TAB.done,
            list: myRequests.filter((ticket) => ticket.status === "Completed"),
          },
        ],
        initialFilter: approvals.length ? "approval" : "open",
      },
    },
    {
      key: "today",
      label: "Due today",
      value: today.length,
      caption: new Date().toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }),
      icon: CalendarClock,
      theme: "orange",
      spec: {
        label: "Due today",
        value: today.length,
        caption: where,
        tone: "amber",
        href: `${board}?view=today`,
        list: today,
      },
    },
  ];

  const tabs: WorkTab[] = [
    {
      key: "assigned",
      label: "Assigned to me",
      tickets: openFirst(assignedToMe),
      href: "/assigned-to-me",
      place: "from",
      person: "raiser",
      empty: { title: "Nothing on you", note: "Tickets assigned or handed to you appear here." },
    },
    {
      key: "requests",
      label: "My requests",
      tickets: openFirst(myRequests),
      href: "/my-requests",
      place: "to",
      person: "holder",
      empty: { title: "No requests yet", note: "Tickets you raise appear here." },
    },
    ...(lens === "manager"
      ? [
          {
            key: "all",
            label: "All tickets",
            tickets: openFirst(tickets),
            href: "/all-tickets",
            place: "to" as const,
            person: "holder" as const,
            empty: { title: "No tickets yet", note: "Every ticket in the workspace appears here." },
          },
        ]
      : []),
  ];

  const headed = new Set(data.headOf.map((department) => department.id));

  return {
    lens,
    kpis,
    tabs,
    reach,
    where,
    approvals,
    asks,
    today,
    overdue,
    unassigned,
    escalations,
    departments: departmentSeries(tickets),
    workload: lens === "head" ? workloadOf(queue, headed) : null,
  };
}

/** Good morning, and what today holds - said in one line. */
function Greeting({
  name,
  summary,
  syncedAt,
  now,
  loading,
  onRefresh,
}: {
  name: string;
  summary: string;
  syncedAt: number | null;
  now: number | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  const hour = new Date().getHours();
  const part = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const date = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });

  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[22px] leading-tight font-bold tracking-[-0.02em] text-ink-900">
          {part}, {firstName(name)}
        </h1>
        <p className="mt-1 text-[13px] text-ink-500">
          {date} <span className="text-ink-300">·</span> {summary}
        </p>
      </div>
      <div className="flex items-center gap-2.5">
        <span className="inline-flex items-center gap-1.5 text-[11.5px] text-ink-400">
          <span className="relative flex size-1.5">
            <span className="absolute inset-0 animate-ping rounded-full bg-status-completed-fg opacity-40" />
            <span className="relative size-1.5 rounded-full bg-status-completed-fg" />
          </span>
          Live · {syncedAt ? relativeTime(syncedAt, now) : "connecting"}
        </span>
        <button
          type="button"
          onClick={onRefresh}
          aria-label="Refresh"
          className="grid size-9 cursor-pointer place-items-center rounded-xl border border-line bg-surface text-ink-500 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:bg-ink-50 hover:text-ink-900"
        >
          <RefreshCw className={cn("size-4", loading && "animate-spin")} />
        </button>
      </div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-12 w-80 rounded-xl" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-37 rounded-2xl" />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="min-w-0 space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Skeleton className="h-72 rounded-2xl" />
            <Skeleton className="h-72 rounded-2xl" />
          </div>
          <Skeleton className="h-96 rounded-2xl" />
        </div>
        <div className="space-y-4">
          <Skeleton className="h-52 rounded-2xl" />
          <Skeleton className="h-96 rounded-2xl" />
        </div>
      </div>
    </div>
  );
}

export function DashboardOverview() {
  const { session } = useAuth();
  const { data, loading, error, syncedAt, refresh } = useLiveDashboard(20_000);
  const [now, setNow] = useState<number | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [tab, setTab] = useState<SheetTab>("details");
  /** A list shown in the window, as it stood when its number was clicked. */
  const [spec, setSpec] = useState<ListSpec | null>(null);
  /** A workload card's list, by key, so it follows the live numbers. */
  const [workloadKey, setWorkloadKey] = useState<string | null>(null);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const timer = window.setInterval(tick, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const view = useMemo(() => (data ? shape(data) : null), [data]);
  const byId = useMemo(() => new Map((data?.tickets ?? []).map((ticket) => [ticket.id, ticket])), [data]);

  const openTicket = useCallback((ticket: DashboardTicket, start: SheetTab = "details") => {
    setSpec(null);
    setWorkloadKey(null);
    setTab(start);
    setViewingId(ticket.id);
  }, []);
  const closeTicket = useCallback(() => setViewingId(null), []);
  const closeList = useCallback(() => {
    setSpec(null);
    setWorkloadKey(null);
  }, []);

  if (!data || !view) {
    if (error) {
      return (
        <p className="flex items-center justify-between gap-3 rounded-xl border border-status-overdue-bg bg-status-overdue-bg/60 px-3.5 py-2 text-[12px] font-medium text-status-overdue-fg">
          Could not load the dashboard. {error}
          <button type="button" onClick={refresh} className="font-bold underline underline-offset-2">
            Try again
          </button>
        </p>
      );
    }
    return <DashboardSkeleton />;
  }

  const meId = session?.id;
  const manager = isAdmin(session);
  const myDepartments = new Set((session?.departments ?? []).map((membership) => membership.id));

  // The open sheet follows the live list, so a change lands in it too.
  const viewing = viewingId ? (byId.get(viewingId) ?? null) : null;
  const canWork = viewing
    ? manager || departmentsOf(viewing).some((department) => myDepartments.has(department.id))
    : false;
  const canEdit = viewing ? manager || viewing.raisedBy.id === meId : false;
  // Neither working it nor having asked for it: a head looking in on their
  // team's request to another department.
  const overseeing = viewing && !canWork && !canEdit;
  const overseen = overseeing
    ? viewing.fromDepartments
        .filter((department) => data.headOf.some((head) => head.id === department.id))
        .map((department) => department.name)
        .join(", ")
    : "";

  // Today in one line: what is due, late, and waiting on the reader's answer.
  const summaryParts = [
    view.today.length ? `${view.today.length} due today` : "",
    view.overdue.length ? `${view.overdue.length} late` : "",
    view.approvals.length ? `${view.approvals.length} awaiting your approval` : "",
    view.asks.length ? `${view.asks.length} asked of you` : "",
  ].filter(Boolean);
  const summary = summaryParts.length ? summaryParts.join(" · ") : "Nothing urgent. You're all caught up.";

  // Piles that need an owner or a decision, beside the single tickets.
  const notes: ActionNote[] = [
    ...(view.lens !== "member" && view.unassigned.length > 0
      ? [
          {
            key: "unassigned",
            icon: UserX,
            tint: "bg-status-waiting-bg text-status-waiting-fg",
            title: `${view.unassigned.length} not picked up`,
            note: view.lens === "head" ? "In your queue, waiting for an owner" : "Waiting for an owner",
            label: "Review",
            onClick: () =>
              setSpec({
                label: "Not picked up",
                value: view.unassigned.length,
                caption: view.where,
                tone: "amber",
                list: view.unassigned,
              }),
          },
        ]
      : []),
    ...(session?.role === "superadmin" && view.escalations.length > 0
      ? [
          {
            key: "escalations",
            icon: Siren,
            tint: "bg-status-escalated-bg text-status-escalated-fg",
            title: `${view.escalations.length} ${view.escalations.length === 1 ? "escalation" : "escalations"} waiting`,
            note: "Put in front of you to decide",
            label: "Open",
            href: "/escalations",
          },
        ]
      : []),
  ];

  const listSpec = spec ?? (workloadKey && view.workload
    ? workloadList(view.workload, workloadKey.split(":")[0] ?? "", workloadKey.split(":")[1] ?? "open")
    : null);

  return (
    <div className="space-y-4 pb-6">
      <Greeting
        name={session?.name ?? ""}
        summary={summary}
        syncedAt={syncedAt}
        now={now}
        loading={loading}
        onRefresh={refresh}
      />

      {error && (
        <p className="flex items-center justify-between gap-3 rounded-xl border border-status-overdue-bg bg-status-overdue-bg/60 px-3.5 py-2 text-[12px] font-medium text-status-overdue-fg">
          Live data paused. {error}
          <button type="button" onClick={refresh} className="font-bold underline underline-offset-2">
            Try again
          </button>
        </p>
      )}

      <section aria-label="At a glance" className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {view.kpis.map((kpi) => (
          <KpiCard key={kpi.key} kpi={kpi} onShow={setSpec} />
        ))}
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_21rem]">
        {/* The main column: the week, and the work itself. */}
        <div className="min-w-0 space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <DailyActivity tickets={data.tickets} onShow={setSpec} />
            <OpenTrend tickets={data.tickets} onShow={setSpec} />
          </div>

          <WorkTable tabs={view.tabs} onOpen={openTicket} />

          {/* Your own list beside your team's load: what is on you, and on them. */}
          <div className="grid gap-4 lg:grid-cols-2">
            <TodoBrief />
            {view.lens === "head" && view.workload && (
              <WorkloadPanel
                load={view.workload}
                meId={meId}
                onShow={(key, filter) => {
                  setSpec(null);
                  setWorkloadKey(`${key}:${filter ?? "open"}`);
                }}
              />
            )}

            {view.lens === "manager" && view.departments.length > 0 && (
              <Card title="Where the work sits" caption="Open tickets per department">
                <DepartmentChart data={view.departments} />
              </Card>
            )}
          </div>
        </div>

        {/* The side column: what is waiting on you, the picture, the days ahead. */}
        <aside className="grid min-w-0 content-start gap-4 lg:grid-cols-2 xl:grid-cols-1">
          <ActionNeeded
            approvals={view.approvals}
            asks={view.asks}
            notes={notes}
            meId={meId}
            onOpen={openTicket}
            onShow={setSpec}
            onChanged={refresh}
          />
          <Card title="Ticket overview" caption={view.reach}>
            <StatusDonut tickets={data.tickets} scope={view.reach} onShow={setSpec} />
          </Card>
          <Deadlines tickets={data.tickets} onOpen={openTicket} onShow={setSpec} />
          <ActivityCard
            entries={data.activity}
            lens={view.lens}
            now={now}
            openable={byId}
            onOpen={openTicket}
          />
        </aside>
      </div>

      <TicketListModal
        // Keyed by what is listed, so each opens on a fresh search and tab.
        key={spec ? `${spec.label}:${spec.value}` : (workloadKey ?? "none")}
        spec={listSpec}
        onClose={closeList}
        onOpen={(ticket) => openTicket(ticket)}
      />

      <TicketDetailSheet
        ticket={viewing}
        canWork={canWork}
        canEdit={canEdit}
        tab={tab}
        onTab={setTab}
        onClose={closeTicket}
        onSaved={() => refresh()}
        readOnly={
          overseeing
            ? `You are following this as head of ${overseen || "the raising department"}. Only the people on the ticket can reply or change it.`
            : undefined
        }
      />
    </div>
  );
}
