"use client";

import { useEffect, useMemo, useState, type ComponentType } from "react";
import Link from "next/link";
import {
  AlarmClock,
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  Inbox,
  Plus,
  RefreshCw,
  UserRound,
  UserX,
} from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { DepartmentChart, type DepartmentPoint } from "@/components/dashboard/department-chart";
import { StatusShare, type StatusPoint } from "@/components/dashboard/status-share";
import { StatusBadge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useLiveTickets } from "@/hooks/use-live-tickets";
import type { TicketRecord } from "@/lib/tickets";
import type { TicketStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const STATUS_ORDER: TicketStatus[] = [
  "New",
  "Accepted",
  "In Progress",
  "Waiting",
  "Overdue",
  "Completed",
];

const DAY = 86_400_000;

/** Midnight today, so "due today" means the day rather than the next 24 hours. */
const startOfToday = () => new Date(new Date().toDateString()).getTime();

const dayOf = (value: string | null) => (value ? new Date(value.slice(0, 10)).getTime() : null);

const isOpen = (ticket: TicketRecord) => ticket.status !== "Completed";

/** Past its date and not finished - whatever the status column happens to say. */
function isOverdue(ticket: TicketRecord) {
  if (!isOpen(ticket)) return false;
  if (ticket.status === "Overdue") return true;

  const due = dayOf(ticket.committedDeadline ?? ticket.deadline);
  return due !== null && due < startOfToday();
}

function isDueToday(ticket: TicketRecord) {
  if (!isOpen(ticket)) return false;
  return dayOf(ticket.committedDeadline ?? ticket.deadline) === startOfToday();
}

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

function statusSeries(tickets: TicketRecord[]): StatusPoint[] {
  return STATUS_ORDER.map((status) => ({
    status,
    count: tickets.filter((ticket) => ticket.status === status).length,
  })).filter((point) => point.count > 0);
}

function departmentSeries(tickets: TicketRecord[]): DepartmentPoint[] {
  const load = new Map<string, number>();

  for (const ticket of tickets.filter(isOpen)) {
    const name = ticket.department.name?.trim() || ticket.department.code?.trim() || "Unassigned";
    load.set(name, (load.get(name) ?? 0) + 1);
  }

  return [...load.entries()]
    .map(([department, count]) => ({ department, tickets: count }))
    .sort((left, right) => right.tickets - left.tickets)
    .slice(0, 6);
}

type Metric = {
  label: string;
  value: number;
  caption: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  tone: "rose" | "amber" | "slate" | "royal";
};

const TONES: Record<Metric["tone"], string> = {
  rose: "bg-status-overdue-bg text-status-overdue-fg",
  amber: "bg-status-waiting-bg text-status-waiting-fg",
  slate: "bg-ink-100 text-ink-600",
  royal: "bg-royal-50 text-royal-700",
};

/**
 * One number worth acting on, and the page that acts on it.
 *
 * Every tile here is a link: a count nobody can follow is a poster, not a
 * dashboard. Totals and completion rates are deliberately absent - they read
 * well and change nothing about what to do next.
 */
function MetricCard({ metric, loading }: { metric: Metric; loading: boolean }) {
  const Icon = metric.icon;

  return (
    <Link
      href={metric.href as "/"}
      className="group rounded-xl border border-line bg-surface px-3.5 py-3 transition-colors hover:border-royal-200 hover:bg-royal-50/40"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold tracking-[0.04em] text-ink-500 uppercase">
          {metric.label}
        </p>
        <span className={cn("grid size-6 shrink-0 place-items-center rounded-md", TONES[metric.tone])}>
          <Icon className="size-3.5" />
        </span>
      </div>

      {loading ? (
        <Skeleton className="mt-2 h-7 w-10" />
      ) : (
        <p className="mt-1.5 text-[26px] leading-none font-bold tracking-tight text-ink-900 tabular-nums">
          {metric.value}
        </p>
      )}

      <p className="mt-1.5 truncate text-[11px] text-ink-400">{metric.caption}</p>
    </Link>
  );
}

function Panel({
  title,
  caption,
  action,
  className,
  children,
}: {
  title: string;
  caption?: string;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn("flex flex-col overflow-hidden rounded-xl border border-line bg-surface", className)}
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

/** One row of the work that is actually late, due, or nobody's. */
function QueueRow({
  ticket,
  reason,
  now,
}: {
  ticket: TicketRecord;
  reason: "overdue" | "today" | "unassigned";
  now: number | null;
}) {
  const note =
    reason === "unassigned"
      ? `nobody yet · raised ${relativeTime(ticket.createdAt, now)}`
      : when(ticket.committedDeadline ?? ticket.deadline);

  return (
    <li>
      <Link
        href={`/all-tickets?ticket=${ticket.id}` as "/"}
        className="group flex items-center gap-2.5 rounded-md px-1.5 py-1.5 transition-colors hover:bg-ink-50"
      >
        <span
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            reason === "overdue"
              ? "bg-status-overdue-fg"
              : reason === "today"
                ? "bg-status-waiting-fg"
                : "bg-ink-300",
          )}
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-1.5">
            <span className="shrink-0 text-[11px] font-bold text-royal-700">{ticket.number}</span>
            <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-ink-800">
              {ticket.subject}
            </span>
          </span>
          <span className="mt-0.5 block truncate text-[10px] text-ink-400">
            {ticket.department.name ?? "Department"} · {note}
          </span>
        </span>
        <ArrowUpRight className="size-3.5 shrink-0 text-ink-300 transition-colors group-hover:text-royal-600" />
      </Link>
    </li>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-12 rounded-xl" />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
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
  const { tickets, loading, error, syncedAt, refresh } = useLiveTickets({
    scope: "all",
    intervalMs: 15_000,
  });
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const timer = window.setInterval(tick, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const meId = session?.id;

  const view = useMemo(() => {
    const open = tickets.filter(isOpen);
    const overdue = open.filter(isOverdue);
    const today = open.filter((ticket) => isDueToday(ticket) && !isOverdue(ticket));
    const unassigned = open.filter((ticket) => ticket.assignees.length === 0);
    const mine = open.filter((ticket) => ticket.assignees.some((person) => person.id === meId));

    const metrics: Metric[] = [
      {
        // Named apart from the Overdue *status* on purpose: this counts every
        // open ticket whose date has gone, however its status column reads.
        label: "Past due",
        value: overdue.length,
        caption: overdue.length ? "date gone, still open" : "nothing is late",
        href: "/all-tickets",
        icon: AlarmClock,
        tone: "rose",
      },
      {
        label: "Due today",
        value: today.length,
        caption: today.length ? "finish or re-commit" : "nothing due today",
        href: "/all-tickets",
        icon: CalendarClock,
        tone: "amber",
      },
      {
        label: "Unassigned",
        value: unassigned.length,
        caption: unassigned.length ? "waiting to be picked up" : "everything has an owner",
        href: "/all-tickets",
        icon: UserX,
        tone: "slate",
      },
      {
        label: "On me",
        value: mine.length,
        caption: mine.length ? "open and assigned to you" : "nothing on your desk",
        href: "/assigned-to-me",
        icon: UserRound,
        tone: "royal",
      },
    ];

    /**
     * The work that needs a decision, worst first: late, then due today, then
     * the ones nobody has picked up. One list rather than three, because the
     * question is "what now", not "which category".
     */
    const attention = [
      ...overdue
        .slice()
        .sort(
          (left, right) =>
            (dayOf(left.committedDeadline ?? left.deadline) ?? 0) -
            (dayOf(right.committedDeadline ?? right.deadline) ?? 0),
        )
        .map((ticket) => ({ ticket, reason: "overdue" as const })),
      ...today.map((ticket) => ({ ticket, reason: "today" as const })),
      ...unassigned
        .filter((ticket) => !isOverdue(ticket) && !isDueToday(ticket))
        .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
        .map((ticket) => ({ ticket, reason: "unassigned" as const })),
    ].slice(0, 7);

    return {
      metrics,
      attention,
      openCount: open.length,
      statuses: statusSeries(tickets),
      departments: departmentSeries(tickets),
      recent: [...tickets]
        .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
        .slice(0, 6),
    };
  }, [tickets, meId]);

  if (loading && tickets.length === 0) return <DashboardSkeleton />;

  return (
    <div className="space-y-3 pb-4">
      {/* One strip rather than a banner: who you are and how fresh this is,
          then out of the way. */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-3.5 py-2.5">
        <p className="min-w-0 flex-1 truncate text-[13px] font-bold text-ink-900">
          {session?.name ?? "Your workspace"}
          <span className="ml-2 text-[11px] font-medium text-ink-400">
            {view.openCount} open {view.openCount === 1 ? "ticket" : "tickets"} in your reach
          </span>
        </p>

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

        <Link
          href="/create-ticket"
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-royal-600 px-3 text-[12px] font-semibold text-white transition-colors hover:bg-royal-700"
        >
          <Plus className="size-3.5" strokeWidth={2.5} />
          New ticket
        </Link>
      </div>

      {error && (
        <p className="flex items-center justify-between gap-3 rounded-xl border border-status-overdue-bg bg-status-overdue-bg/60 px-3.5 py-2 text-[12px] font-medium text-status-overdue-fg">
          Live data paused. {error}
          <button type="button" onClick={refresh} className="font-bold underline underline-offset-2">
            Try again
          </button>
        </p>
      )}

      <section aria-label="What needs doing" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {view.metrics.map((metric) => (
          <MetricCard key={metric.label} metric={metric} loading={loading} />
        ))}
      </section>

      <div className="grid gap-3 xl:grid-cols-12">
        <Panel
          title="Needs attention"
          caption="Late, due today, or waiting for an owner"
          className="xl:col-span-7"
          action={
            <Link
              href="/all-tickets"
              className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-royal-700 hover:text-royal-800"
            >
              All tickets
              <ArrowUpRight className="size-3.5" />
            </Link>
          }
        >
          {view.attention.length > 0 ? (
            <ul className="-mx-1.5 divide-y divide-line">
              {view.attention.map((item) => (
                <QueueRow key={item.ticket.id} ticket={item.ticket} reason={item.reason} now={now} />
              ))}
            </ul>
          ) : (
            <p className="flex flex-col items-center gap-2 py-10 text-center">
              <CheckCircle2 className="size-6 text-status-completed-fg" />
              <span className="text-[13px] font-semibold text-ink-700">Nothing is waiting</span>
              <span className="text-[11px] text-ink-400">
                No late work, nothing due today, and every ticket has an owner.
              </span>
            </p>
          )}
        </Panel>

        <Panel
          title="Status mix"
          caption={`${tickets.length} ${tickets.length === 1 ? "ticket" : "tickets"} in view`}
          className="xl:col-span-5"
        >
          <StatusShare data={view.statuses} />
        </Panel>
      </div>

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
          title="Latest movement"
          caption="Most recently updated"
          className="xl:col-span-5"
          action={
            <Link
              href="/activity"
              className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-royal-700 hover:text-royal-800"
            >
              Activity
              <ArrowUpRight className="size-3.5" />
            </Link>
          }
        >
          {view.recent.length > 0 ? (
            <ul className="-mx-1.5 divide-y divide-line">
              {view.recent.map((ticket) => (
                <li key={ticket.id}>
                  <Link
                    href={`/all-tickets?ticket=${ticket.id}` as "/"}
                    className="group flex items-center gap-2.5 rounded-md px-1.5 py-1.5 transition-colors hover:bg-ink-50"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-1.5">
                        <span className="shrink-0 text-[11px] font-bold text-royal-700">
                          {ticket.number}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-ink-800">
                          {ticket.subject}
                        </span>
                      </span>
                      <span className="mt-0.5 block truncate text-[10px] text-ink-400">
                        {ticket.department.name ?? "Department"} ·{" "}
                        {relativeTime(ticket.updatedAt, now)}
                      </span>
                    </span>
                    <StatusBadge status={ticket.status} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="flex flex-col items-center gap-2 py-10 text-center">
              <Inbox className="size-6 text-ink-300" />
              <span className="text-[13px] font-semibold text-ink-700">No tickets yet</span>
              <span className="text-[11px] text-ink-400">New requests appear here as they land.</span>
            </p>
          )}
        </Panel>
      </div>
    </div>
  );
}
