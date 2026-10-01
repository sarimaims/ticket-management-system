"use client";

import { useCallback, useEffect, useMemo, useState, type ComponentType } from "react";
import Link from "next/link";
import {
  AlarmClock,
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  Hourglass,
  Inbox,
  RefreshCw,
  Send,
  Siren,
  UserRound,
  UserX,
} from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { ACTION_DOTS, ACTION_LABELS } from "@/components/activity/activity-log";
import { DepartmentChart, type DepartmentPoint } from "@/components/dashboard/department-chart";
import { StatusShare, type StatusPoint } from "@/components/dashboard/status-share";
import { timeLeft } from "@/components/tickets/approval-banner";
import { TicketDetailSheet, type SheetTab } from "@/components/tickets/ticket-detail-sheet";
import { StatusBadge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useLiveDashboard } from "@/hooks/use-live-dashboard";
import { isAdmin, ROLE_LABEL } from "@/lib/auth";
import {
  isAwaitingApproval,
  isDueToday,
  isDueTodayOnly,
  isOverdue,
  type DashboardData,
  type DashboardLens,
  type DashboardTicket,
  type DashboardUpdate,
} from "@/lib/tickets";
import { isClosed, type TicketStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

/* ---------------------------------------------------------------- helpers */

const STATUS_ORDER: TicketStatus[] = [
  "New",
  "In Progress",
  "Resolved",
  "Overdue",
  "Completed",
  "Cancelled",
];

const DAY = 86_400_000;

/** Midnight today, so "due today" means the day rather than the next 24 hours. */
const startOfToday = () => new Date(new Date().toDateString()).getTime();

const dayOf = (value: string | null) => (value ? new Date(value.slice(0, 10)).getTime() : null);

const isOpen = (ticket: DashboardTicket) => !isClosed(ticket.status);

const dueOf = (ticket: DashboardTicket) => ticket.committedDeadline ?? ticket.deadline;

const departmentsOf = (ticket: DashboardTicket) =>
  ticket.departments?.length ? ticket.departments : [ticket.department];

const departmentNames = (ticket: DashboardTicket) =>
  departmentsOf(ticket)
    .map((department) => department.name ?? department.code ?? "")
    .filter(Boolean)
    .join(", ") || "Department";

const firstName = (name?: string) => (name ?? "").trim().split(/\s+/)[0] || "Someone";

/** Who holds it, by first name - or that nobody does yet. */
const holders = (ticket: DashboardTicket) =>
  ticket.assignees.length > 0
    ? ticket.assignees.map((person) => firstName(person.name)).join(", ")
    : "not picked up";

const byUpdated = (left: DashboardTicket, right: DashboardTicket) =>
  Date.parse(right.updatedAt) - Date.parse(left.updatedAt);

/** "3 days ago", "in 2 days" - the thing being asked of a date on a queue. */
function when(value: string | null) {
  const due = dayOf(value);
  if (due === null) return "no date";

  const days = Math.round((due - startOfToday()) / DAY);
  if (days === 0) return "due today";
  if (days === 1) return "due tomorrow";
  if (days > 1) return `due in ${days} days`;
  if (days === -1) return "1 day late";
  return `${Math.abs(days)} days late`;
}

function relativeTime(value: string | number, now: number | null) {
  if (!now) return "";

  const seconds = Math.max(0, Math.floor((now - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(value).toLocaleDateString("en", { day: "numeric", month: "short" });
}

function statusSeries(tickets: DashboardTicket[]): StatusPoint[] {
  return STATUS_ORDER.map((status) => ({
    status,
    count: tickets.filter((ticket) => ticket.status === status).length,
  })).filter((point) => point.count > 0);
}

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

/* ------------------------------------------------------------------ pieces */

type Metric = {
  label: string;
  value: number;
  caption: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  tone: "rose" | "amber" | "slate" | "royal" | "violet";
};

const TONES: Record<Metric["tone"], string> = {
  rose: "bg-status-overdue-bg text-status-overdue-fg",
  amber: "bg-status-waiting-bg text-status-waiting-fg",
  slate: "bg-ink-100 text-ink-600",
  royal: "bg-royal-50 text-royal-700",
  violet: "bg-status-resolved-bg text-status-resolved-fg",
};

/**
 * One number worth acting on, and the page that acts on it.
 *
 * Every tile here is a link: a count nobody can follow is a poster, not a
 * dashboard. Totals and completion rates are deliberately absent - they read
 * well and change nothing about what to do next.
 */
function MetricCard({ metric }: { metric: Metric }) {
  const Icon = metric.icon;

  return (
    <Link
      href={metric.href as "/"}
      className="group rounded-xl border border-line bg-surface px-3.5 py-3 transition-colors hover:border-royal-200 hover:bg-royal-50/40"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-[11px] font-semibold tracking-[0.04em] text-ink-500 uppercase">
          {metric.label}
        </p>
        <span className={cn("grid size-6 shrink-0 place-items-center rounded-md", TONES[metric.tone])}>
          <Icon className="size-3.5" />
        </span>
      </div>
      <p className="mt-1.5 text-[26px] leading-none font-bold tracking-tight text-ink-900 tabular-nums">
        {metric.value}
      </p>
      <p className="mt-1.5 truncate text-[11px] text-ink-400">{metric.caption}</p>
    </Link>
  );
}

function Panel({
  id,
  title,
  caption,
  action,
  className,
  children,
}: {
  id?: string;
  title: string;
  caption?: string;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className={cn(
        "flex scroll-mt-14 flex-col overflow-hidden rounded-xl border border-line bg-surface",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3 border-b border-line px-3.5 py-2.5">
        <div className="min-w-0">
          <h2 className="text-[13px] leading-tight font-bold text-ink-900">{title}</h2>
          {caption && <p className="mt-0.5 truncate text-[11px] text-ink-400">{caption}</p>}
        </div>
        {action}
      </div>
      <div className="flex-1 px-3.5 py-3">{children}</div>
    </section>
  );
}

function PanelLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href as "/"}
      className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-royal-700 hover:text-royal-800"
    >
      {children}
      <ArrowUpRight className="size-3.5" />
    </Link>
  );
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

const MINE_LABEL = { asked: "Asked of you", assigned: "On you", raised: "You raised" } as const;

/**
 * Whose a ticket is, in one chip.
 *
 * The reader's own part wins and wears the brand colour - asked of them, on
 * them, or raised by them. For a head, anything else is the team's, and says
 * whose: the person who raised it, or whoever holds it.
 */
function Whose({ ticket, lens }: { ticket: DashboardTicket; lens: DashboardLens }) {
  const { mine, team } = ticket.relation;

  if (mine.length > 0) {
    const why = mine.includes("asked") ? "asked" : mine.includes("assigned") ? "assigned" : "raised";
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-royal-50 px-1.5 py-px text-[10px] font-semibold text-royal-700 ring-1 ring-royal-100">
        <span className="size-1 rounded-full bg-royal-600" />
        {MINE_LABEL[why]}
      </span>
    );
  }

  if (lens !== "head" || team.length === 0) return null;

  const who = team.includes("queue") ? holders(ticket) : firstName(ticket.raisedBy.name);
  return (
    <span className="inline-flex max-w-32 shrink-0 items-center rounded-full bg-ink-50 px-1.5 py-px text-[10px] font-medium text-ink-600 ring-1 ring-line">
      <span className="truncate">Team · {who}</span>
    </span>
  );
}

function TicketRow({
  ticket,
  dot,
  note,
  aside,
  onOpen,
}: {
  ticket: DashboardTicket;
  dot?: string;
  note: string;
  aside?: React.ReactNode;
  onOpen: (ticket: DashboardTicket) => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(ticket)}
        className="group flex w-full items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left transition-colors hover:bg-ink-50"
      >
        {dot && <span className={cn("size-1.5 shrink-0 rounded-full", dot)} />}
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-1.5">
            <span className="shrink-0 text-[11px] font-bold text-royal-700">{ticket.number}</span>
            <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-ink-800">
              {ticket.subject}
            </span>
          </span>
          <span className="mt-0.5 block truncate text-[10px] text-ink-400">{note}</span>
        </span>
        {aside}
        <ArrowUpRight className="size-3.5 shrink-0 text-ink-300 transition-colors group-hover:text-royal-600" />
      </button>
    </li>
  );
}

/* --------------------------------------------------------- needs attention */

type Reason = "asked" | "approval" | "overdue" | "today" | "unassigned";

const REASON_DOT: Record<Reason, string> = {
  asked: "bg-chat-accent",
  approval: "bg-status-resolved-strong",
  overdue: "bg-status-overdue-fg",
  today: "bg-status-waiting-fg",
  unassigned: "bg-ink-300",
};

type Attention = { ticket: DashboardTicket; reason: Reason };

/**
 * The work that needs a decision, worst first: what is waiting on the
 * reader's yes or no, then what is late, due today, and nobody's. One list
 * rather than five, because the question is "what now", not "which category".
 * A ticket is listed once, for its most pressing reason.
 */
function attentionList(
  groups: Partial<Record<Reason, DashboardTicket[]>>,
  limit = 7,
): Attention[] {
  const order: Reason[] = ["asked", "approval", "overdue", "today", "unassigned"];
  const seen = new Set<string>();
  const list: Attention[] = [];

  for (const reason of order) {
    const tickets = [...(groups[reason] ?? [])];
    if (reason === "overdue") {
      tickets.sort((left, right) => (dayOf(dueOf(left)) ?? 0) - (dayOf(dueOf(right)) ?? 0));
    }
    if (reason === "unassigned") {
      tickets.sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
    }
    for (const ticket of tickets) {
      if (seen.has(ticket.id)) continue;
      seen.add(ticket.id);
      list.push({ ticket, reason });
    }
  }

  return list.slice(0, limit);
}

function attentionNote({ ticket, reason }: Attention, now: number | null) {
  switch (reason) {
    case "asked":
      return `${departmentNames(ticket)} · asked to take it over`;
    case "approval": {
      const left = timeLeft(ticket.approvalDueAt);
      return `to ${departmentNames(ticket)} · done, approve${left ? ` · closes itself in ${left}` : ""}`;
    }
    case "unassigned":
      return `${departmentNames(ticket)} · nobody yet · raised ${relativeTime(ticket.createdAt, now)}`;
    default:
      return `${departmentNames(ticket)} · ${when(dueOf(ticket))}`;
  }
}

function AttentionPanel({
  items,
  lens,
  now,
  caption,
  href,
  emptyNote,
  onOpen,
}: {
  items: Attention[];
  lens: DashboardLens;
  now: number | null;
  caption: string;
  href: string;
  emptyNote: string;
  onOpen: (ticket: DashboardTicket) => void;
}) {
  return (
    <Panel
      title={lens === "member" ? "Needs you" : "Needs attention"}
      caption={caption}
      className="xl:col-span-7"
      action={<PanelLink href={href}>{lens === "member" ? "My desk" : "All tickets"}</PanelLink>}
    >
      {items.length > 0 ? (
        <ul className="-mx-1.5 divide-y divide-line">
          {items.map((item) => (
            <TicketRow
              key={item.ticket.id}
              ticket={item.ticket}
              dot={REASON_DOT[item.reason]}
              note={attentionNote(item, now)}
              aside={<Whose ticket={item.ticket} lens={lens} />}
              onOpen={onOpen}
            />
          ))}
        </ul>
      ) : (
        <Empty title="Nothing is waiting" note={emptyNote} />
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ feed */

/**
 * The latest updates in the reader's reach - the server has already drawn the
 * line, so this only says whose each one is. "You" for what the reader did;
 * a "Yours" chip for updates on their own tickets, "Team" for a head's
 * people's.
 */
function UpdatesPanel({
  entries,
  lens,
  now,
  caption,
  openable,
  onOpen,
}: {
  entries: DashboardUpdate[];
  lens: DashboardLens;
  now: number | null;
  caption: string;
  openable: Map<string, DashboardTicket>;
  onOpen: (ticket: DashboardTicket) => void;
}) {
  return (
    <Panel
      title={lens === "head" ? "Team updates" : "Latest updates"}
      caption={caption}
      className="xl:col-span-5"
      action={<PanelLink href="/activity">Activity</PanelLink>}
    >
      {entries.length > 0 ? (
        <ul className="-mx-1.5 divide-y divide-line">
          {entries.slice(0, 8).map((entry) => {
            const ticket = entry.ticketId ? openable.get(entry.ticketId) : undefined;
            const chip =
              entry.mine && lens !== "member" ? (
                <span className="rounded-full bg-royal-50 px-1.5 py-px font-semibold text-royal-700 ring-1 ring-royal-100">
                  Yours
                </span>
              ) : lens === "head" ? (
                <span className="rounded-full bg-ink-50 px-1.5 py-px font-medium text-ink-600 ring-1 ring-line">
                  Team
                </span>
              ) : null;

            const body = (
              <>
                <span
                  className={cn(
                    "mt-1.5 size-1.5 shrink-0 rounded-full",
                    ACTION_DOTS[entry.action] ?? "bg-ink-300",
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 text-[12px] leading-snug text-ink-700">
                    <span className="font-semibold text-ink-900">
                      {entry.actor.isMe ? "You" : entry.actor.name}
                    </span>{" "}
                    {entry.summary}
                  </span>
                  <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[10px] text-ink-400">
                    {chip}
                    <span className="truncate">
                      {ACTION_LABELS[entry.action] ?? "Update"}
                      {lens === "manager" && entry.department ? ` · ${entry.department.name}` : ""}
                      {" · "}
                      {relativeTime(entry.createdAt, now)}
                    </span>
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
                    className="flex w-full items-start gap-2.5 rounded-md px-1.5 py-1.5 text-left transition-colors hover:bg-ink-50"
                  >
                    {body}
                  </button>
                ) : (
                  <div className="flex items-start gap-2.5 px-1.5 py-1.5">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <Empty icon={Inbox} title="No updates yet" note="Changes to tickets in your reach land here." />
      )}
    </Panel>
  );
}

/* ---------------------------------------------------------------- requests */

/** Tickets somebody asked for, where they went and who has them. */
function RequestsPanel({
  id,
  title,
  caption,
  tickets,
  lens,
  now,
  href,
  showRaiser = false,
  wide = false,
  className,
  onOpen,
}: {
  id?: string;
  title: string;
  caption: string;
  tickets: DashboardTicket[];
  lens: DashboardLens;
  now: number | null;
  href?: string;
  showRaiser?: boolean;
  wide?: boolean;
  className?: string;
  onOpen: (ticket: DashboardTicket) => void;
}) {
  const rows = tickets.slice(0, wide ? 8 : 6);

  return (
    <Panel
      id={id}
      title={title}
      caption={caption}
      className={className}
      action={href ? <PanelLink href={href}>My Requests</PanelLink> : undefined}
    >
      {rows.length > 0 ? (
        <ul className={cn("-mx-1.5 divide-y divide-line", wide && "xl:grid xl:grid-cols-2 xl:gap-x-6 xl:divide-y-0")}>
          {rows.map((ticket) => (
            <TicketRow
              key={ticket.id}
              ticket={ticket}
              note={[
                showRaiser
                  ? ticket.relation.mine.includes("raised")
                    ? "You"
                    : ticket.raisedBy.name ?? "Someone"
                  : null,
                `to ${departmentNames(ticket)}`,
                holders(ticket),
                relativeTime(ticket.updatedAt, now),
              ]
                .filter(Boolean)
                .join(" · ")}
              aside={
                <span className="flex shrink-0 items-center gap-1.5">
                  {lens === "head" && <Whose ticket={ticket} lens={lens} />}
                  <StatusBadge status={ticket.status} />
                </span>
              }
              onOpen={onOpen}
            />
          ))}
        </ul>
      ) : (
        <Empty
          icon={Send}
          title="Nothing open"
          note={showRaiser ? "Nobody in your team is waiting on another department." : "Requests you raise appear here."}
        />
      )}
    </Panel>
  );
}

/* ---------------------------------------------------------------- workload */

type Load = { id: string; name: string; designation: string; open: number; late: number };

/**
 * Who in the head's departments carries what: open tickets per person, with
 * the late share drawn inside the bar. Counted only for the departments they
 * run - a shared ticket's other holders are another head's people.
 */
function workloadOf(queue: DashboardTicket[], headed: Set<string>) {
  const rows = new Map<string, Load>();
  let unassigned = 0;

  for (const ticket of queue.filter(isOpen)) {
    const people = ticket.assignees.filter(
      (person) => !person.departmentId || headed.has(person.departmentId),
    );
    if (people.length === 0) {
      unassigned += 1;
      continue;
    }
    for (const person of people) {
      const row = rows.get(person.id) ?? {
        id: person.id,
        name: person.name ?? "Someone",
        designation: person.designation ?? "",
        open: 0,
        late: 0,
      };
      row.open += 1;
      if (isOverdue(ticket)) row.late += 1;
      rows.set(person.id, row);
    }
  }

  return {
    rows: [...rows.values()].sort((left, right) => right.open - left.open || right.late - left.late),
    unassigned,
  };
}

function WorkloadPanel({
  load,
  meId,
}: {
  load: ReturnType<typeof workloadOf>;
  meId?: string;
}) {
  const rows = load.rows.slice(0, 7);
  const max = Math.max(1, ...rows.map((row) => row.open), load.unassigned);

  return (
    <Panel
      title="Team workload"
      caption="Open tickets per person in the departments you run"
      className="xl:col-span-7"
      action={<PanelLink href="/team">Users</PanelLink>}
    >
      {rows.length > 0 || load.unassigned > 0 ? (
        <ul className="space-y-2.5">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center gap-3">
              <span className="w-40 min-w-0 shrink-0">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-[12px] font-semibold text-ink-800">{row.name}</span>
                  {row.id === meId && (
                    <span className="shrink-0 rounded-full bg-royal-50 px-1.5 text-[9.5px] font-bold text-royal-700 ring-1 ring-royal-100">
                      You
                    </span>
                  )}
                </span>
                <span className="block truncate text-[10px] text-ink-400">{row.designation || "—"}</span>
              </span>
              <span className="relative h-2 flex-1 overflow-hidden rounded-full bg-ink-100">
                <span
                  className="absolute inset-y-0 left-0 rounded-full bg-royal-500"
                  style={{ width: `${(row.open / max) * 100}%` }}
                />
                {row.late > 0 && (
                  <span
                    className="absolute inset-y-0 left-0 rounded-full bg-status-overdue-fg"
                    style={{ width: `${(row.late / max) * 100}%` }}
                  />
                )}
              </span>
              <span className="w-24 shrink-0 text-right text-[11px] text-ink-500 tabular-nums">
                <span className="font-bold text-ink-800">{row.open}</span> open
                {row.late > 0 && <span className="text-status-overdue-fg"> · {row.late} late</span>}
              </span>
            </li>
          ))}
          {load.unassigned > 0 && (
            <li className="flex items-center gap-3 border-t border-line pt-2.5">
              <span className="w-40 shrink-0 text-[12px] font-semibold text-ink-500">Not picked up</span>
              <span className="relative h-2 flex-1 overflow-hidden rounded-full bg-ink-100">
                <span
                  className="absolute inset-y-0 left-0 rounded-full bg-ink-300"
                  style={{ width: `${(load.unassigned / max) * 100}%` }}
                />
              </span>
              <span className="w-24 shrink-0 text-right text-[11px] text-ink-500 tabular-nums">
                <span className="font-bold text-ink-800">{load.unassigned}</span> waiting
              </span>
            </li>
          )}
        </ul>
      ) : (
        <Empty title="Nothing open in your queue" note="Your team has a clear desk." />
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------- views */

/**
 * Everything the page shows, worked out once per answer from the server.
 *
 * Three readers, three pages. A member's is their own work: what is on them,
 * what they asked for, and the updates on those. A head's is their team's
 * work in both directions - the queue they run and what their people asked of
 * others - with their own tickets picked out. A manager's is the workspace.
 */
function shape(data: DashboardData, session: ReturnType<typeof useAuth>["session"]) {
  const { lens, tickets } = data;
  const open = tickets.filter(isOpen);

  const onMe = open.filter((ticket) => ticket.relation.mine.includes("assigned"));
  const asked = open.filter((ticket) => ticket.relation.mine.includes("asked"));
  const myRequests = tickets
    .filter((ticket) => ticket.relation.mine.includes("raised"))
    .sort(byUpdated);
  const myOpenRequests = myRequests.filter(isOpen);
  const approvals = myRequests.filter(isAwaitingApproval);

  // The work to watch: a member's own desk, a head's queue, a manager's all.
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

  const teamRaised = tickets
    .filter((ticket) => ticket.relation.team.includes("raised"))
    .sort(byUpdated);

  const desk = "/assigned-to-me";
  const board = lens === "member" ? desk : "/all-tickets";

  let metrics: Metric[];
  if (lens === "member") {
    metrics = [
      {
        label: "On my desk",
        value: onMe.length,
        caption: onMe.length ? "open and assigned to you" : "nothing on your desk",
        href: desk,
        icon: UserRound,
        tone: "royal",
      },
      {
        label: "Past due",
        value: overdue.length,
        caption: overdue.length ? "yours, date gone" : "nothing of yours is late",
        href: `${desk}?view=past`,
        icon: AlarmClock,
        tone: "rose",
      },
      {
        label: "Due today",
        value: today.length,
        caption: today.length ? "finish or re-commit" : "nothing due today",
        href: `${desk}?view=today`,
        icon: CalendarClock,
        tone: "amber",
      },
      {
        label: "My requests",
        value: myOpenRequests.length,
        caption: approvals.length
          ? `${approvals.length} waiting on your approval`
          : myOpenRequests.length
            ? "open requests you raised"
            : "nothing you asked for is open",
        href: approvals.length ? "/my-requests?view=approval" : "/my-requests",
        icon: Send,
        tone: approvals.length ? "violet" : "slate",
      },
    ];
  } else {
    metrics = [
      {
        // Named apart from the Overdue *status* on purpose: this counts every
        // open ticket whose date has gone, however its status column reads.
        label: "Past due",
        value: overdue.length,
        caption: overdue.length ? "date gone, still open" : "nothing is late",
        href: `${board}?view=past`,
        icon: AlarmClock,
        tone: "rose",
      },
      {
        label: "Due today",
        value: today.length,
        caption: today.length ? "finish or re-commit" : "nothing due today",
        href: `${board}?view=today`,
        icon: CalendarClock,
        tone: "amber",
      },
      {
        label: "Not picked up",
        value: unassigned.length,
        caption: unassigned.length ? "waiting for an owner" : "everything has an owner",
        href: `${board}?view=unassigned`,
        icon: UserX,
        tone: "slate",
      },
      lens === "head"
        ? {
            label: "Raised by team",
            value: teamRaised.filter(isOpen).length,
            caption: "your people's open requests",
            href: "#team-requests",
            icon: Send,
            tone: "violet",
          }
        : {
            label: "Awaiting approval",
            value: open.filter(isAwaitingApproval).length,
            caption: "done, waiting on the requester",
            href: `${board}?view=approval`,
            icon: Hourglass,
            tone: "violet",
          },
      session?.role === "superadmin"
        ? {
            label: "Escalations",
            value: open.filter((ticket) => ticket.escalation?.status === "open").length,
            caption: "waiting on your decision",
            href: "/escalations",
            icon: Siren,
            tone: "rose",
          }
        : {
            label: "On me",
            value: onMe.length,
            caption: onMe.length ? "open and assigned to you" : "nothing on your desk",
            href: desk,
            icon: UserRound,
            tone: "royal",
          },
    ];
  }

  const attention = attentionList({
    asked,
    approval: approvals,
    overdue,
    today,
    // A member cannot hand out work, so "nobody's" is not theirs to act on.
    unassigned: lens === "member" ? [] : unassigned.filter((t) => !isOverdue(t) && !isDueToday(t)),
  });

  const headed = new Set(data.headOf.map((department) => department.id));

  return {
    lens,
    metrics,
    attention,
    openCount: open.length,
    queue,
    myRequests,
    myOpenRequests,
    teamRaised,
    statuses: statusSeries(lens === "member" ? tickets : queue),
    departments: departmentSeries(tickets),
    workload: lens === "head" ? workloadOf(queue, headed) : null,
    board,
  };
}

function DashboardSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-14 rounded-xl" />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className="h-24 rounded-xl" />
        ))}
      </div>
      <div className="grid gap-3 xl:grid-cols-12">
        <Skeleton className="h-72 rounded-xl xl:col-span-7" />
        <Skeleton className="h-72 rounded-xl xl:col-span-5" />
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

  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const timer = window.setInterval(tick, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const view = useMemo(() => (data ? shape(data, session) : null), [data, session]);
  const byId = useMemo(
    () => new Map((data?.tickets ?? []).map((ticket) => [ticket.id, ticket])),
    [data],
  );

  const openTicket = useCallback((ticket: DashboardTicket) => {
    setTab("details");
    setViewingId(ticket.id);
  }, []);
  const closeTicket = useCallback(() => setViewingId(null), []);

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

  const lensLabel =
    view.lens === "manager"
      ? ROLE_LABEL[session?.role ?? "admin"]
      : view.lens === "head"
        ? `Head of ${data.headOf.map((department) => department.name).join(", ")}`
        : session?.designation || "Member";

  const reach =
    view.lens === "manager"
      ? `Every department · ${view.openCount} open`
      : view.lens === "head"
        ? `Your queue, your team's requests and your own work · ${view.openCount} open`
        : `Tickets you raised, hold, or are asked to take · ${view.openCount} open`;

  return (
    <div className="space-y-3 pb-4">
      {/* Who this page is for and what it covers, then how fresh it is. */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-3.5 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-center gap-2 text-[13px] font-bold text-ink-900">
            <span className="truncate">{session?.name ?? "Your workspace"}</span>
            <span className="max-w-[60%] shrink-0 truncate rounded-full bg-royal-50 px-2 py-px text-[10.5px] font-semibold text-royal-700 ring-1 ring-royal-100">
              {lensLabel}
            </span>
          </p>
          <p className="mt-0.5 truncate text-[11px] text-ink-400">{reach}</p>
        </div>

        <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-400">
          <span className="size-1.5 rounded-full bg-status-completed-fg" />
          live · {syncedAt ? relativeTime(syncedAt, now) : "connecting"}
        </span>

        <button
          type="button"
          onClick={refresh}
          aria-label="Refresh"
          className="grid size-8 shrink-0 place-items-center rounded-md border border-line-strong text-ink-500 transition-colors hover:bg-ink-50 hover:text-ink-900"
        >
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
        </button>
      </div>

      {error && (
        <p className="flex items-center justify-between gap-3 rounded-xl border border-status-overdue-bg bg-status-overdue-bg/60 px-3.5 py-2 text-[12px] font-medium text-status-overdue-fg">
          Live data paused. {error}
          <button type="button" onClick={refresh} className="font-bold underline underline-offset-2">
            Try again
          </button>
        </p>
      )}

      <section
        aria-label="What needs doing"
        className={cn(
          "grid grid-cols-2 gap-3 md:grid-cols-3",
          view.metrics.length === 4 ? "xl:grid-cols-4" : "xl:grid-cols-5",
        )}
      >
        {view.metrics.map((metric) => (
          <MetricCard key={metric.label} metric={metric} />
        ))}
      </section>

      <div className="grid gap-3 xl:grid-cols-12">
        <AttentionPanel
          items={view.attention}
          lens={view.lens}
          now={now}
          caption={
            view.lens === "member"
              ? "Asked of you, waiting on your approval, late, or due today"
              : "Asked of you, awaiting your approval, late, due today, or nobody's"
          }
          href={view.board}
          emptyNote={
            view.lens === "member"
              ? "Nothing late, nothing due today, and nobody is waiting on you."
              : "No late work, nothing due today, and every ticket has an owner."
          }
          onOpen={openTicket}
        />
        <UpdatesPanel
          entries={data.activity}
          lens={view.lens}
          now={now}
          caption={
            view.lens === "member"
              ? "On the tickets you are part of"
              : view.lens === "head"
                ? "Across your queue and your team's requests"
                : "Across the workspace"
          }
          openable={byId}
          onOpen={openTicket}
        />
      </div>

      {view.lens === "member" && (
        <div className="grid gap-3 xl:grid-cols-12">
          <RequestsPanel
            title="My requests"
            caption="What you asked for, where it went and who has it"
            tickets={view.myOpenRequests.length > 0 ? view.myOpenRequests : view.myRequests}
            lens={view.lens}
            now={now}
            href="/my-requests"
            className="xl:col-span-7"
            onOpen={openTicket}
          />
          <Panel
            title="Status mix"
            caption={`${data.tickets.length} ${data.tickets.length === 1 ? "ticket" : "tickets"} you are part of`}
            className="xl:col-span-5"
          >
            <StatusShare data={view.statuses} />
          </Panel>
        </div>
      )}

      {view.lens === "head" && view.workload && (
        <>
          <div className="grid gap-3 xl:grid-cols-12">
            <WorkloadPanel load={view.workload} meId={meId} />
            <Panel
              title="Status mix"
              caption={`${view.queue.length} ${view.queue.length === 1 ? "ticket" : "tickets"} in your queue`}
              className="xl:col-span-5"
            >
              <StatusShare data={view.statuses} />
            </Panel>
          </div>
          <RequestsPanel
            id="team-requests"
            title="Raised by your team"
            caption="What your people asked for, yours marked - with where it went and who has it"
            tickets={view.teamRaised.filter(isOpen)}
            lens={view.lens}
            now={now}
            showRaiser
            wide
            onOpen={openTicket}
          />
        </>
      )}

      {view.lens === "manager" && (
        <>
          <div className="grid gap-3 xl:grid-cols-12">
            <Panel
              title="Where the work sits"
              caption="Open tickets per department"
              className="xl:col-span-7"
            >
              {view.departments.length > 0 ? (
                <DepartmentChart data={view.departments} />
              ) : (
                <p className="py-10 text-center text-[12px] text-ink-400">Nothing open right now.</p>
              )}
            </Panel>
            <Panel
              title="Status mix"
              caption={`${data.tickets.length} ${data.tickets.length === 1 ? "ticket" : "tickets"} in the workspace`}
              className="xl:col-span-5"
            >
              <StatusShare data={view.statuses} />
            </Panel>
          </div>
          {view.myOpenRequests.length > 0 && (
            <RequestsPanel
              title="Raised by you"
              caption="Requests you sent, where they went and who has them"
              tickets={view.myOpenRequests}
              lens={view.lens}
              now={now}
              href="/my-requests"
              wide
              onOpen={openTicket}
            />
          )}
        </>
      )}

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
