"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  BadgeCheck,
  CalendarCheck,
  ChevronLeft,
  ChevronRight,
  Loader2,
  MessageSquare,
  TrendingDown,
  TrendingUp,
  UserPlus,
  type LucideIcon,
} from "lucide-react";

import { approvalsChanged, timeLeft } from "@/components/tickets/approval-banner";
import { PriorityBadge, StatusBadge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { errorMessage } from "@/lib/api";
import { initials } from "@/lib/auth";
import { answerHandover, listHandovers } from "@/lib/handovers";
import { answerApproval, isDueTodayOnly, isOverdue, type DashboardTicket } from "@/lib/tickets";
import { isSettled, STATUS_LABEL, type TicketStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

import {
  DAY,
  dayOf,
  departmentNames,
  departmentsOf,
  dueOf,
  isOpen,
  shortDay,
  startOfToday,
  STATUS_TONE,
  TAB,
  when,
  type ListSpec,
} from "./dashboard-utils";

/* ------------------------------------------------------------------ shell */

/**
 * The card every widget sits in: a white sheet with a soft edge, its title
 * and one line under it, and whatever it offers on the right.
 */
export function Card({
  id,
  title,
  caption,
  action,
  footer,
  className,
  bodyClassName,
  children,
}: {
  id?: string;
  title: React.ReactNode;
  caption?: React.ReactNode;
  action?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className={cn(
        "flex min-w-0 scroll-mt-16 flex-col rounded-2xl border border-line/80 bg-surface shadow-[0_1px_2px_rgba(15,23,42,0.04)]",
        className,
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 px-5 pt-4 pb-3">
        <div className="min-w-32 flex-1">
          <h2 className="truncate text-[14px] font-semibold tracking-[-0.01em] text-ink-900">{title}</h2>
          {caption && <p className="mt-0.5 truncate text-[11.5px] text-ink-400">{caption}</p>}
        </div>
        {action}
      </header>
      <div className={cn("min-h-0 flex-1 px-5 pb-4", bodyClassName)}>{children}</div>
      {footer && <div className="px-5 pb-4">{footer}</div>}
    </section>
  );
}

/** The way from a card's few to the whole list, at the card's foot. */
export function FooterLink({
  href,
  extra,
  children,
}: {
  href: string;
  extra?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href as "/"}
      className="flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-line bg-surface text-[12px] font-semibold text-royal-700 transition-colors hover:border-royal-200 hover:bg-royal-50"
    >
      {children}
      {extra && <span className="font-normal text-ink-400">· {extra}</span>}
      <ArrowUpRight className="size-3.5" />
    </Link>
  );
}

/** A small round initial for a person, or for whatever stands in for one. */
function Initial({ name, className }: { name: string; className?: string }) {
  return (
    <span
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-full bg-ink-100 text-[11px] font-semibold text-ink-600",
        className,
      )}
      aria-hidden="true"
    >
      {initials(name || "?")}
    </span>
  );
}

/* -------------------------------------------------------------------- kpi */

export type KpiTheme = "blue" | "pink" | "green" | "orange" | "red" | "violet" | "sky";

/** Pastel cards, one hue each: a wash for the card, a deeper ink for its icon. */
const KPI_THEME: Record<KpiTheme, { card: string; icon: string }> = {
  blue: { card: "bg-blue-50", icon: "text-blue-600" },
  pink: { card: "bg-pink-50", icon: "text-pink-600" },
  green: { card: "bg-emerald-50", icon: "text-emerald-600" },
  orange: { card: "bg-orange-50", icon: "text-orange-500" },
  red: { card: "bg-rose-50", icon: "text-rose-600" },
  violet: { card: "bg-violet-50", icon: "text-violet-600" },
  sky: { card: "bg-sky-50", icon: "text-sky-600" },
};

export type Kpi = {
  key: string;
  label: string;
  value: number;
  caption: string;
  icon: LucideIcon;
  theme: KpiTheme;
  /** What a click lists. */
  spec: ListSpec;
};

/**
 * One headline number, as a slim strip: the icon on a white chip at the
 * start, then the label, and the figure with the line saying what is behind
 * it. Wide rather than tall, so the row of them reads at a glance and leaves
 * the page to the work below. The whole card opens the tickets it counts.
 */
export function KpiCard({ kpi, onShow }: { kpi: Kpi; onShow: (spec: ListSpec) => void }) {
  const Icon = kpi.icon;
  const theme = KPI_THEME[kpi.theme];

  return (
    <button
      type="button"
      onClick={() => onShow(kpi.spec)}
      // The caption can be cut short in a narrow card; the whole line is here.
      title={`${kpi.label}: ${kpi.value} · ${kpi.caption}`}
      className={cn(
        "group relative flex min-w-0 items-center gap-3 rounded-xl px-3 py-2.5 text-left ring-1 ring-ink-900/5 ring-inset",
        "transition-[transform,box-shadow] duration-200 hover:-translate-y-px hover:shadow-[0_10px_22px_-16px_rgba(15,23,42,0.45)]",
        "focus-visible:ring-2 focus-visible:ring-royal-300 focus-visible:outline-none",
        theme.card,
      )}
    >
      <span
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-lg bg-white shadow-[0_1px_2px_rgba(15,23,42,0.08)]",
          theme.icon,
        )}
      >
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1 text-[11.5px] leading-4 font-medium text-ink-600">
          <span className="truncate">{kpi.label}</span>
          <ArrowUpRight className="size-3 shrink-0 text-ink-400 opacity-0 transition-opacity group-hover:opacity-100" />
        </span>
        <span className="mt-0.5 flex min-w-0 items-baseline gap-1.5">
          <span className="text-[20px] leading-6 font-bold tracking-[-0.02em] text-ink-900 tabular-nums">
            {kpi.value}
          </span>
          <span className="truncate text-[11px] text-ink-500">{kpi.caption}</span>
        </span>
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ donut */

/*
 * Status slices in an order checked for colour-blind separation - red kept
 * away from green, the two near-twins (in progress, awaiting approval) kept
 * apart. New and Cancelled are deliberately quiet greys. Every slice is also
 * written out in the legend with its count, so colour is never the only cue.
 */
const DONUT: { status: TicketStatus; color: string }[] = [
  { status: "New", color: "var(--color-status-new-fg)" },
  { status: "In Progress", color: "var(--color-status-progress-fg)" },
  { status: "Overdue", color: "var(--color-status-overdue-fg)" },
  { status: "Resolved", color: "var(--color-status-resolved-fg)" },
  { status: "Cancelled", color: "var(--color-ink-400)" },
  { status: "Completed", color: "var(--color-status-completed-fg)" },
];

/**
 * Every ticket in reach by status: a ring with the total in its middle and a
 * legend that counts each slice. Hovering a slice or a row picks it out;
 * clicking either lists those tickets.
 */
export function StatusDonut({
  tickets,
  scope,
  onShow,
}: {
  tickets: DashboardTicket[];
  scope: string;
  onShow: (spec: ListSpec) => void;
}) {
  const [hover, setHover] = useState<TicketStatus | null>(null);

  const rows = DONUT.map((row) => ({
    ...row,
    list: tickets.filter((ticket) => ticket.status === row.status),
  }));
  const total = tickets.length;
  const radius = 46;
  const stroke = 13;
  const circumference = 2 * Math.PI * radius;
  const slices = rows.filter((row) => row.list.length > 0);
  // A surface gap between slices, the same width all the way round.
  const gap = slices.length > 1 ? 2.4 : 0;

  const lengths = slices.map((row) => (row.list.length / Math.max(total, 1)) * circumference);
  const arcs = slices.map((row, index) => ({
    ...row,
    dash: Math.max(lengths[index] - gap, 0.6),
    // Where this slice starts: the sum of every slice before it.
    offset: lengths.slice(0, index).reduce((sum, length) => sum + length, 0),
  }));

  const show = (row: (typeof rows)[number]) =>
    onShow({
      label: STATUS_LABEL[row.status],
      value: row.list.length,
      caption: scope,
      tone: STATUS_TONE[row.status],
      list: row.list,
    });

  const focused = hover ? rows.find((row) => row.status === hover) : null;

  if (total === 0) {
    return <p className="py-8 text-center text-[12px] text-ink-400">No tickets yet.</p>;
  }

  return (
    <div className="flex items-center gap-4">
      <div className="relative size-30 shrink-0">
        <svg viewBox="0 0 120 120" className="size-full -rotate-90" role="img" aria-label="Tickets by status">
          <circle cx="60" cy="60" r={radius} fill="none" stroke="var(--color-ink-100)" strokeWidth={stroke} />
          {arcs.map((arc) => (
            <circle
              key={arc.status}
              cx="60"
              cy="60"
              r={radius}
              fill="none"
              stroke={arc.color}
              strokeWidth={stroke}
              strokeDasharray={`${arc.dash} ${circumference - arc.dash}`}
              strokeDashoffset={-arc.offset}
              opacity={hover && hover !== arc.status ? 0.22 : 1}
              className="cursor-pointer transition-opacity duration-200"
              onMouseEnter={() => setHover(arc.status)}
              onMouseLeave={() => setHover(null)}
              onClick={() => show(arc)}
            >
              <title>{`${STATUS_LABEL[arc.status]}: ${arc.list.length}`}</title>
            </circle>
          ))}
        </svg>
        <span className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <span>
            <span className="block text-[22px] leading-none font-bold text-ink-900">
              {focused ? focused.list.length : total}
            </span>
            <span className="mt-1 block max-w-18 truncate text-[10px] text-ink-400">
              {focused ? STATUS_LABEL[focused.status] : "Total"}
            </span>
          </span>
        </span>
      </div>

      <ul className="min-w-0 flex-1 space-y-0.5">
        {rows
          .filter((row) => row.list.length > 0 || row.status !== "Overdue")
          .map((row) => (
            <li key={row.status}>
              <button
                type="button"
                disabled={row.list.length === 0}
                onClick={() => show(row)}
                onMouseEnter={() => setHover(row.status)}
                onMouseLeave={() => setHover(null)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-[12px] transition-colors",
                  "enabled:cursor-pointer enabled:hover:bg-ink-50 disabled:opacity-45",
                  hover === row.status && "bg-ink-50",
                )}
              >
                <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: row.color }} />
                <span className="min-w-0 flex-1 truncate text-ink-600">{STATUS_LABEL[row.status]}</span>
                <span className="font-semibold text-ink-900">{row.list.length}</span>
              </button>
            </li>
          ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------- days */

type Day = { start: number; end: number; isToday: boolean; date: Date };

/** The last `count` local days, oldest first, each as its start and end. */
function lastDays(count = 7): Day[] {
  const today = new Date(startOfToday());
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (count - 1 - index));
    const next = new Date(date);
    next.setDate(date.getDate() + 1);
    return { start: date.getTime(), end: next.getTime(), isToday: index === count - 1, date };
  });
}

/** When a ticket was closed in this status, if it was. */
const closedAt = (ticket: DashboardTicket, status: "Completed" | "Cancelled") =>
  ticket.status !== status
    ? null
    : ((status === "Completed" ? ticket.completedAt : ticket.cancelledAt) ?? ticket.updatedAt);

/** A rounded-up top for an axis whose middle line is still a whole number. */
const axisTop = (peak: number) => Math.max(2, Math.ceil(peak / 2) * 2);

/*
 * Three series, one hue each, in the first three slots of a palette checked
 * for colour-blind separation across every pair. Each also has a word in the
 * legend and in the tooltip, and the list a day opens.
 */
const SERIES = [
  {
    key: "raised",
    label: "Raised",
    color: "#2a78d6",
    dot: "bg-[#2a78d6]",
    tint: "bg-royal-50 text-royal-700 ring-royal-200",
  },
  {
    key: "completed",
    label: "Completed",
    color: "#1baf7a",
    dot: "bg-[#1baf7a]",
    tint: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  },
  {
    key: "cancelled",
    label: "Cancelled",
    color: "#eb6834",
    dot: "bg-[#eb6834]",
    tint: "bg-orange-50 text-orange-700 ring-orange-200",
  },
] as const;

type SeriesKey = (typeof SERIES)[number]["key"];

/**
 * What happened each of the last seven days: raised, completed and cancelled
 * side by side. Hovering a day shows its numbers; clicking it lists the
 * tickets behind them, one tab per series.
 */
export function DailyActivity({
  tickets,
  onShow,
  className,
}: {
  tickets: DashboardTicket[];
  onShow: (spec: ListSpec) => void;
  className?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);

  const days = lastDays(7).map((day) => {
    const inDay = (iso: string | null | undefined) => {
      if (!iso) return false;
      const time = Date.parse(iso);
      return time >= day.start && time < day.end;
    };
    const lists: Record<SeriesKey, DashboardTicket[]> = {
      raised: tickets.filter((ticket) => inDay(ticket.createdAt)),
      completed: tickets.filter((ticket) => inDay(closedAt(ticket, "Completed"))),
      cancelled: tickets.filter((ticket) => inDay(closedAt(ticket, "Cancelled"))),
    };
    return {
      ...day,
      lists,
      label: day.isToday ? "Today" : day.date.toLocaleDateString(undefined, { weekday: "short" }),
      title: day.date.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" }),
    };
  });

  const peak = Math.max(1, ...days.flatMap((day) => SERIES.map((series) => day.lists[series.key].length)));
  const top = axisTop(peak);
  const ticks = [top, top / 2, 0];
  const totals = SERIES.map((series) => ({
    ...series,
    total: days.reduce((sum, day) => sum + day.lists[series.key].length, 0),
  }));

  const show = (day: (typeof days)[number]) => {
    const first = SERIES.find((series) => day.lists[series.key].length > 0) ?? SERIES[0];
    onShow({
      label: day.title,
      value: day.lists[first.key].length,
      caption: "What happened that day",
      tone: "royal",
      filters: SERIES.map((series) => ({
        key: series.key,
        label: series.label,
        dot: series.dot,
        tint: series.tint,
        list: day.lists[series.key],
      })),
      initialFilter: first.key,
    });
  };

  return (
    <Card
      title="Daily ticket activity"
      caption="Last 7 days · tap a day for its tickets"
      className={className}
    >
      <div className="flex gap-2">
        {/* The axis: three clean numbers on hairlines. */}
        <div className="relative h-44 w-6 shrink-0">
          <div className="absolute inset-x-0 top-0 bottom-6">
            {ticks.map((tick) => (
              <span
                key={tick}
                className="absolute right-0 translate-y-1/2 text-[10px] leading-none text-ink-300"
                style={{ bottom: `${(tick / top) * 100}%` }}
              >
                {tick}
              </span>
            ))}
          </div>
        </div>

        <div className="relative h-44 min-w-0 flex-1">
          <div className="absolute inset-x-0 top-0 bottom-6" aria-hidden="true">
            {ticks.map((tick) => (
              <span
                key={tick}
                className="absolute inset-x-0 h-px bg-ink-100"
                style={{ bottom: `${(tick / top) * 100}%` }}
              />
            ))}
          </div>

          <div className="absolute inset-0 flex gap-1">
            {days.map((day, index) => (
              <button
                key={day.start}
                type="button"
                onClick={() => show(day)}
                onMouseEnter={() => setHover(index)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(index)}
                onBlur={() => setHover(null)}
                aria-label={`${day.title}: ${SERIES.map((series) => `${day.lists[series.key].length} ${series.label.toLowerCase()}`).join(", ")}`}
                className={cn(
                  "relative flex min-w-0 flex-1 cursor-pointer flex-col justify-end rounded-lg pb-6 transition-colors focus-visible:outline-none",
                  hover === index && "bg-ink-50/80",
                )}
              >
                <span className="flex h-full items-end justify-center gap-0.75">
                  {SERIES.map((series) => {
                    const value = day.lists[series.key].length;
                    return (
                      <span
                        key={series.key}
                        className="w-2.5 rounded-t-sm transition-[height] duration-500"
                        style={{
                          height: value ? `${(value / top) * 100}%` : 0,
                          backgroundColor: series.color,
                        }}
                      />
                    );
                  })}
                </span>
                <span
                  className={cn(
                    "absolute inset-x-0 bottom-0 h-6 truncate text-center text-[10.5px] leading-6",
                    day.isToday ? "font-semibold text-ink-800" : "text-ink-400",
                  )}
                >
                  {day.label}
                </span>

                {hover === index && (
                  <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 w-40 -translate-x-1/2 rounded-xl border border-line bg-surface px-3 py-2 text-left shadow-lg shadow-ink-900/10">
                    <span className="block text-[11px] font-semibold text-ink-900">{day.title}</span>
                    {SERIES.map((series) => (
                      <span key={series.key} className="mt-1 flex items-center gap-1.5 text-[11px] text-ink-600">
                        <span className="size-1.5 rounded-full" style={{ backgroundColor: series.color }} />
                        <span className="flex-1">{series.label}</span>
                        <span className="font-semibold text-ink-900">{day.lists[series.key].length}</span>
                      </span>
                    ))}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 pl-8 text-[11px] text-ink-500">
        {totals.map((series) => (
          <span key={series.key} className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ backgroundColor: series.color }} />
            {series.label}
            <span className="font-semibold text-ink-800">{series.total}</span>
          </span>
        ))}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ trend */

/** When a ticket stopped being open, or never if it still is. */
const closedTime = (ticket: DashboardTicket) =>
  ticket.status === "Completed"
    ? Date.parse(ticket.completedAt ?? ticket.updatedAt)
    : ticket.status === "Cancelled"
      ? Date.parse(ticket.cancelledAt ?? ticket.updatedAt)
      : Number.POSITIVE_INFINITY;

/**
 * How the open pile has moved this week - the count still open at the end of
 * each day - with today's split underneath: on track, due today, late. The
 * three boxes each open their tickets; so does a point on the line.
 */
export function OpenTrend({
  tickets,
  onShow,
  className,
}: {
  tickets: DashboardTicket[];
  onShow: (spec: ListSpec) => void;
  className?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);

  const points = lastDays(7).map((day) => {
    const list = tickets.filter(
      (ticket) => Date.parse(ticket.createdAt) < day.end && closedTime(ticket) >= day.end,
    );
    return {
      ...day,
      list,
      label: day.isToday ? "Today" : day.date.toLocaleDateString(undefined, { weekday: "short" }),
      title: day.date.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" }),
    };
  });

  const openNow = tickets.filter(isOpen);
  const working = tickets.filter((ticket) => !isSettled(ticket.status));
  const late = working.filter(isOverdue);
  const today = working.filter(isDueTodayOnly);
  const onTrack = working.filter((ticket) => !isOverdue(ticket) && !isDueTodayOnly(ticket));
  const awaiting = tickets.filter((ticket) => ticket.status === "Resolved").length;

  const delta = points[points.length - 1].list.length - points[0].list.length;
  const peak = Math.max(1, ...points.map((point) => point.list.length));
  const top = peak * 1.25;
  const coords = points.map((point, index) => ({
    x: (index / (points.length - 1)) * 100,
    y: 100 - (point.list.length / top) * 100,
  }));
  const line = coords.map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`).join(" ");
  const area = `${line} L100,100 L0,100 Z`;

  const boxes = [
    {
      key: "track",
      label: "On track",
      list: onTrack,
      box: "bg-emerald-50 hover:bg-emerald-100/70",
      ink: "text-emerald-700",
      tone: "completed" as const,
    },
    {
      key: "today",
      label: "Due today",
      list: today,
      box: "bg-amber-50 hover:bg-amber-100/70",
      ink: "text-amber-700",
      tone: "amber" as const,
    },
    {
      key: "late",
      label: "Late",
      list: late,
      box: "bg-rose-50 hover:bg-rose-100/70",
      ink: "text-rose-700",
      tone: "rose" as const,
    },
  ];

  return (
    <Card title="Open work" caption="Still open at the end of each day · last 7 days" className={className}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-[28px] leading-none font-bold tracking-[-0.02em] text-ink-900">
          {openNow.length}
        </span>
        <span className="text-[12px] text-ink-500">open now</span>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
            delta > 0
              ? "bg-rose-50 text-rose-700"
              : delta < 0
                ? "bg-emerald-50 text-emerald-700"
                : "bg-ink-100 text-ink-600",
          )}
          title="Change since the start of the week shown"
        >
          {delta > 0 ? <TrendingUp className="size-3" /> : delta < 0 ? <TrendingDown className="size-3" /> : null}
          {delta > 0 ? `+${delta}` : delta} since {points[0].label}
        </span>
      </div>
      <p className="mt-1 text-[11px] text-ink-400">
        {awaiting > 0 ? `${awaiting} of them done and awaiting sign-off` : "Nothing is waiting on a sign-off"}
      </p>

      <div className="relative mt-4 h-24">
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="absolute inset-0 size-full overflow-visible"
          aria-hidden="true"
        >
          {[0, 50, 100].map((y) => (
            <line
              key={y}
              x1="0"
              x2="100"
              y1={y}
              y2={y}
              stroke="var(--color-ink-100)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <path d={area} fill="var(--color-royal-500)" fillOpacity={0.1} />
          <path
            d={line}
            fill="none"
            stroke="var(--color-royal-600)"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        {/* The points are HTML on top, so they stay round however wide the card. */}
        {coords.map((point, index) => (
          <button
            key={points[index].start}
            type="button"
            onClick={() =>
              onShow({
                label: `Open at the end of ${points[index].title}`,
                value: points[index].list.length,
                caption: "Raised by then, not yet completed or cancelled",
                tone: "royal",
                list: points[index].list,
              })
            }
            onMouseEnter={() => setHover(index)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(index)}
            onBlur={() => setHover(null)}
            aria-label={`${points[index].title}: ${points[index].list.length} open`}
            className="absolute grid size-6 -translate-x-1/2 -translate-y-1/2 cursor-pointer place-items-center focus-visible:outline-none"
            style={{ left: `${point.x}%`, top: `${point.y}%` }}
          >
            <span
              className={cn(
                "rounded-full bg-royal-600 ring-2 ring-surface transition-transform",
                index === coords.length - 1 ? "size-2.5" : "size-2",
                hover === index && "scale-150",
              )}
            />
            {hover === index && (
              <span className="pointer-events-none absolute bottom-full mb-1 rounded-lg border border-line bg-surface px-2 py-1 text-[11px] whitespace-nowrap text-ink-700 shadow-md">
                <span className="font-semibold text-ink-900">{points[index].list.length}</span> open ·{" "}
                {points[index].label}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="relative mt-1.5 h-4 text-[10.5px] text-ink-400">
        {points.map((point, index) => (
          <span
            key={point.start}
            className={cn(
              "absolute whitespace-nowrap",
              index === 0 ? "left-0" : index === points.length - 1 ? "right-0" : "-translate-x-1/2",
              point.isToday && "font-semibold text-ink-700",
            )}
            style={index === 0 || index === points.length - 1 ? undefined : { left: `${coords[index].x}%` }}
          >
            {point.label}
          </span>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        {boxes.map((box) => (
          <button
            key={box.key}
            type="button"
            onClick={() =>
              onShow({
                label: box.label,
                value: box.list.length,
                caption: "Open work, by its date",
                tone: box.tone,
                list: box.list,
              })
            }
            className={cn("cursor-pointer rounded-xl px-3 py-2 text-left transition-colors", box.box)}
          >
            <span className={cn("block text-[10.5px] font-medium", box.ink)}>{box.label}</span>
            <span className="mt-0.5 block text-[16px] leading-tight font-bold text-ink-900">
              {box.list.length}
            </span>
          </button>
        ))}
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------- deadlines */

/**
 * The days ahead as a week strip, each marked where something falls due, and
 * the selected day's tickets underneath. Arrows move a week at a time; the
 * chip in the corner lists what is already late.
 */
export function Deadlines({
  tickets,
  onOpen,
  onShow,
  className,
}: {
  tickets: DashboardTicket[];
  onOpen: (ticket: DashboardTicket) => void;
  onShow: (spec: ListSpec) => void;
  className?: string;
}) {
  const today = startOfToday();
  const [start, setStart] = useState(today);
  const [selected, setSelected] = useState(today);

  const working = tickets.filter((ticket) => !isSettled(ticket.status) && dueOf(ticket));
  const late = working.filter(isOverdue);
  const byDay = new Map<number, DashboardTicket[]>();
  for (const ticket of working) {
    const day = dayOf(dueOf(ticket));
    if (day === null) continue;
    byDay.set(day, [...(byDay.get(day) ?? []), ticket]);
  }

  const week = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(date.getDate() + index);
    return date.getTime();
  });

  const shift = (weeks: number) => {
    const date = new Date(start);
    date.setDate(date.getDate() + weeks * 7);
    const next = date.getTime();
    setStart(next);
    setSelected(today >= next && today < next + 7 * DAY ? today : next);
  };

  const first = new Date(week[0]);
  const last = new Date(week[6]);
  const month =
    first.getMonth() === last.getMonth()
      ? first.toLocaleDateString(undefined, { month: "long", year: "numeric" })
      : `${first.toLocaleDateString(undefined, { month: "short" })} – ${last.toLocaleDateString(undefined, { month: "short", year: "numeric" })}`;

  const items = [...(byDay.get(selected) ?? [])].sort(
    (left, right) => Number(isOverdue(right)) - Number(isOverdue(left)) || Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
  );
  const selectedName =
    selected === today
      ? "today"
      : new Date(selected).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });

  /** Who a row is about: whoever raised it, unless that was the reader. */
  const personOf = (ticket: DashboardTicket) =>
    ticket.relation.mine.includes("raised")
      ? (ticket.assignees[0]?.name ?? departmentNames(ticket))
      : (ticket.raisedBy.name ?? departmentNames(ticket));

  return (
    <Card
      title="Upcoming deadlines"
      caption="What falls due, day by day"
      className={className}
      action={
        late.length > 0 ? (
          <button
            type="button"
            onClick={() =>
              onShow({
                label: "Late",
                value: late.length,
                caption: "Open, and past the date asked for or promised",
                tone: "rose",
                list: late,
              })
            }
            className="shrink-0 cursor-pointer rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700 ring-1 ring-rose-100 transition-colors hover:bg-rose-100"
          >
            {late.length} late
          </button>
        ) : undefined
      }
    >
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => shift(-1)}
          aria-label="Previous week"
          className="grid size-7 cursor-pointer place-items-center rounded-lg text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-800"
        >
          <ChevronLeft className="size-4" />
        </button>
        <span className="flex items-center gap-2 text-[12.5px] font-semibold text-ink-800">
          {month}
          {start !== today && (
            <button
              type="button"
              onClick={() => {
                setStart(today);
                setSelected(today);
              }}
              className="cursor-pointer rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold text-royal-700 hover:bg-royal-50"
            >
              Today
            </button>
          )}
        </span>
        <button
          type="button"
          onClick={() => shift(1)}
          aria-label="Next week"
          className="grid size-7 cursor-pointer place-items-center rounded-lg text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-800"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>

      <div className="mt-2 grid grid-cols-7 gap-1">
        {week.map((day) => {
          const date = new Date(day);
          const count = byDay.get(day)?.length ?? 0;
          const isSelected = day === selected;
          const isToday = day === today;
          return (
            <button
              key={day}
              type="button"
              onClick={() => setSelected(day)}
              aria-pressed={isSelected}
              aria-label={`${date.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}: ${count} due`}
              className="group flex cursor-pointer flex-col items-center gap-1 rounded-xl py-1 transition-colors hover:bg-ink-50"
            >
              <span className="text-[10px] font-medium text-ink-400">
                {date.toLocaleDateString(undefined, { weekday: "short" })}
              </span>
              <span
                className={cn(
                  "grid size-8 place-items-center rounded-full text-[12.5px] font-semibold transition-colors",
                  isSelected
                    ? "bg-ink-900 text-white shadow-sm"
                    : isToday
                      ? "text-royal-700 ring-1 ring-royal-300"
                      : "text-ink-700",
                )}
              >
                {date.getDate()}
              </span>
              <span
                className={cn(
                  "h-1 w-1 rounded-full",
                  count === 0 ? "bg-transparent" : day < today ? "bg-rose-500" : "bg-royal-500",
                )}
                aria-hidden="true"
              />
            </button>
          );
        })}
      </div>

      <div className="mt-3 border-t border-line pt-2">
        {items.length === 0 ? (
          <p className="flex items-center justify-center gap-2 py-6 text-[12px] text-ink-400">
            <CalendarCheck className="size-4 text-ink-300" />
            Nothing due {selectedName}.
          </p>
        ) : (
          <ul className="-mx-2 space-y-0.5">
            {items.slice(0, 5).map((ticket) => (
              <li key={ticket.id}>
                <button
                  type="button"
                  onClick={() => onOpen(ticket)}
                  className="group flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-ink-50"
                >
                  <Initial name={personOf(ticket)} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-semibold text-ink-900 group-hover:text-royal-700">
                      {ticket.subject}
                    </span>
                    <span className="block truncate text-[11px] text-ink-400">
                      {ticket.number} · {departmentNames(ticket)}
                    </span>
                  </span>
                  {isOverdue(ticket) ? (
                    <span className="shrink-0 rounded-md bg-status-overdue-bg px-1.5 py-0.5 text-[10.5px] font-semibold text-status-overdue-fg">
                      Late
                    </span>
                  ) : (
                    <StatusBadge status={ticket.status} className="shrink-0 px-1.5 text-[10.5px]" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
        {items.length > 5 && (
          <button
            type="button"
            onClick={() =>
              onShow({
                label: `Due ${selectedName}`,
                value: items.length,
                caption: "Open tickets falling due that day",
                tone: "amber",
                list: items,
              })
            }
            className="mt-1 w-full cursor-pointer rounded-lg py-1.5 text-center text-[11.5px] font-semibold text-royal-700 hover:bg-royal-50"
          >
            View all {items.length}
          </button>
        )}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ table */

export type WorkTab = {
  key: string;
  label: string;
  tickets: DashboardTicket[];
  /** The page that lists the whole pile, where there is one. */
  href?: string;
  /** Which end's department to show: where it came from, or where it went. */
  place: "from" | "to";
  /** Which person to show: who raised it, or who holds it. */
  person: "raiser" | "holder";
  empty: { title: string; note: string };
};

const ROWS = 7;

/**
 * The reader's own work as a table, one tab per pile - what is on them, what
 * they asked for, and for a head or a manager the team's. Open tickets lead.
 * A row opens the ticket; the speech bubble opens it on the conversation.
 */
export function WorkTable({
  tabs,
  onOpen,
  className,
}: {
  tabs: WorkTab[];
  onOpen: (ticket: DashboardTicket, start?: "details" | "chat") => void;
  className?: string;
}) {
  const busiest = tabs.find((tab) => tab.tickets.some(isOpen)) ?? tabs[0];
  const [active, setActive] = useState(busiest.key);
  const tab = tabs.find((item) => item.key === active) ?? tabs[0];
  const rows = tab.tickets.slice(0, ROWS);

  return (
    <Card
      title="My work"
      caption="Open first, newest activity first"
      className={className}
      bodyClassName="px-0 pb-0"
      action={
        <div role="tablist" aria-label="Which tickets" className="flex max-w-full overflow-x-auto rounded-xl bg-ink-100 p-1">
          {tabs.map((item) => {
            const selected = item.key === tab.key;
            const open = item.tickets.filter(isOpen).length;
            return (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setActive(item.key)}
                className={cn(
                  "inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] whitespace-nowrap transition-all",
                  selected
                    ? "bg-surface font-semibold text-ink-900 shadow-sm"
                    : "font-medium text-ink-500 hover:text-ink-800",
                )}
              >
                {item.label}
                <span
                  className={cn(
                    "rounded-full px-1.5 text-[10.5px] leading-4",
                    selected ? "bg-royal-50 text-royal-700" : "bg-ink-200/70 text-ink-600",
                  )}
                >
                  {open}
                </span>
              </button>
            );
          })}
        </div>
      }
    >
      {rows.length === 0 ? (
        <div className="border-t border-line px-5 py-10 text-center">
          <p className="text-[13px] font-semibold text-ink-700">{tab.empty.title}</p>
          <p className="mt-1 text-[12px] text-ink-400">{tab.empty.note}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-160 text-left">
            <thead>
              <tr className="border-y border-line bg-ink-50/70 text-[10.5px] font-semibold tracking-[0.06em] text-ink-400 uppercase">
                <th className="py-2.5 pr-3 pl-5 font-semibold">Ticket</th>
                <th className="px-3 py-2.5 font-semibold">{tab.place === "from" ? "From" : "To"}</th>
                <th className="px-3 py-2.5 font-semibold">{tab.person === "raiser" ? "Raised by" : "Held by"}</th>
                <th className="px-3 py-2.5 font-semibold">Due</th>
                <th className="px-3 py-2.5 font-semibold">Status</th>
                <th className="py-2.5 pr-5 pl-3">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((ticket) => {
                const place =
                  tab.place === "from" ? ticket.fromDepartments[0] : departmentsOf(ticket)[0];
                const more = tab.place === "from" ? ticket.fromDepartments.length - 1 : departmentsOf(ticket).length - 1;
                const person =
                  tab.person === "raiser"
                    ? (ticket.raisedBy.name ?? "Someone")
                    : ticket.assignees.map((item) => item.name ?? "Someone").join(", ");
                const due = dueOf(ticket);
                const late = isOverdue(ticket);
                const today = isDueTodayOnly(ticket);

                return (
                  <tr
                    key={ticket.id}
                    tabIndex={0}
                    onClick={() => onOpen(ticket)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onOpen(ticket);
                      }
                    }}
                    className="group cursor-pointer transition-colors hover:bg-ink-50/70 focus-visible:bg-ink-50 focus-visible:outline-none"
                  >
                    <td className="py-3 pr-3 pl-5">
                      <span className="block max-w-64 truncate text-[13px] font-semibold text-ink-900 group-hover:text-royal-700">
                        {ticket.subject}
                      </span>
                      <span className="mt-0.5 flex items-center gap-2">
                        <span className="font-mono text-[11px] text-ink-400">{ticket.number}</span>
                        <PriorityBadge priority={ticket.priority} className="px-1.5 py-px text-[10px]" />
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      {place ? (
                        <>
                          <span className="block max-w-40 truncate text-[12.5px] text-ink-700">
                            {place.name ?? "Department"}
                            {more > 0 && <span className="ml-1 text-ink-400">+{more}</span>}
                          </span>
                          <span className="block max-w-40 truncate text-[11px] text-ink-400">
                            {place.unit?.name ?? ""}
                          </span>
                        </>
                      ) : (
                        <span className="text-[12px] text-ink-300">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {person ? (
                        <span className="flex max-w-36 items-center gap-2">
                          <Initial name={person} className="size-6 text-[9.5px]" />
                          <span className="truncate text-[12.5px] text-ink-700">{person}</span>
                        </span>
                      ) : (
                        <span className="text-[12px] font-medium text-status-waiting-fg">Not picked up</span>
                      )}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      {!isOpen(ticket) ? (
                        <span className="text-[12px] text-ink-300">—</span>
                      ) : due ? (
                        <>
                          <span className="block text-[12.5px] text-ink-700">{shortDay(due)}</span>
                          <span
                            className={cn(
                              "block text-[11px]",
                              late
                                ? "font-semibold text-status-overdue-fg"
                                : today
                                  ? "font-semibold text-status-waiting-fg"
                                  : "text-ink-400",
                            )}
                          >
                            {when(due)}
                          </span>
                        </>
                      ) : (
                        <span className="text-[12px] text-ink-300">No date</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <StatusBadge status={ticket.status} />
                    </td>
                    <td className="py-3 pr-5 pl-3 text-right">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onOpen(ticket, "chat");
                        }}
                        title="Open the conversation"
                        aria-label={`Open the conversation on ${ticket.number}`}
                        className="inline-flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-ink-400 transition-colors hover:bg-royal-50 hover:text-royal-700"
                      >
                        <MessageSquare className="size-3.5" />
                        {ticket.messageCount > 0 && ticket.messageCount}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3 text-[11.5px]">
        <span className="text-ink-400">
          Showing <span className="font-semibold text-ink-700">{rows.length}</span> of {tab.tickets.length}
        </span>
        {tab.href && (
          <Link
            href={tab.href as "/"}
            className="inline-flex items-center gap-1 font-semibold text-royal-700 hover:text-royal-800"
          >
            View all
            <ArrowUpRight className="size-3.5" />
          </Link>
        )}
      </div>
    </Card>
  );
}

/* ---------------------------------------------------------------- actions */

/** A pile of work that is not a single ticket: shown as a row with one button. */
export type ActionNote = {
  key: string;
  icon: LucideIcon;
  tint: string;
  title: string;
  note: string;
  label: string;
  onClick?: () => void;
  href?: string;
};

const PRIMARY =
  "inline-flex h-7 cursor-pointer items-center gap-1 rounded-lg bg-ink-900 px-2.5 text-[11.5px] font-semibold text-white transition-colors hover:bg-ink-800 disabled:cursor-default disabled:opacity-60";
const SECONDARY =
  "inline-flex h-7 cursor-pointer items-center rounded-lg px-2.5 text-[11.5px] font-semibold text-ink-600 ring-1 ring-line transition-colors hover:bg-ink-50 hover:text-ink-900 disabled:cursor-default disabled:opacity-60";

/**
 * What is waiting on the reader's yes or no, answerable right here: approve a
 * finished request, take over a ticket somebody handed them, or turn to a
 * pile that needs an owner. Sending a request back needs a reason, so that
 * one opens the ticket, where the reason is asked for.
 */
export function ActionNeeded({
  approvals,
  asks,
  notes,
  meId,
  onOpen,
  onShow,
  onChanged,
}: {
  approvals: DashboardTicket[];
  asks: DashboardTicket[];
  notes: ActionNote[];
  meId?: string;
  onOpen: (ticket: DashboardTicket) => void;
  onShow: (spec: ListSpec) => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const items = [
    ...approvals.map((ticket) => ({ kind: "approve" as const, ticket })),
    ...asks.map((ticket) => ({ kind: "handover" as const, ticket })),
  ];
  const total = items.length + notes.length;
  const shown = items.slice(0, Math.max(0, 4 - notes.length));
  const hidden = items.length - shown.length;

  const approve = async (ticket: DashboardTicket) => {
    setBusy(ticket.id);
    try {
      await answerApproval(ticket.id, "approve");
      approvalsChanged();
      toast.success(`${ticket.number} approved`, "Marked Completed. The department has been told.");
      onChanged();
    } catch (caught) {
      toast.error(`Could not approve ${ticket.number}`, errorMessage(caught));
    } finally {
      setBusy(null);
    }
  };

  const answer = async (ticket: DashboardTicket, decision: "accept" | "decline") => {
    setBusy(ticket.id);
    try {
      const handovers = await listHandovers(ticket.id);
      const waiting = handovers.find(
        (item) =>
          item.status === "pending" &&
          item.to.some((person) => person.id === meId) &&
          !item.declinedBy.includes(meId ?? ""),
      );
      if (!waiting) {
        toast.error("Nothing to answer", `${ticket.number} is no longer waiting on you.`);
        onChanged();
        return;
      }
      await answerHandover(ticket.id, waiting.id, decision);
      toast.success(
        decision === "accept" ? `${ticket.number} is yours now` : `Declined ${ticket.number}`,
        decision === "accept"
          ? "It is on your desk under Assigned to Me."
          : `${waiting.requestedBy.name} has been told.`,
      );
      onChanged();
    } catch (caught) {
      toast.error(`Could not answer ${ticket.number}`, errorMessage(caught));
    } finally {
      setBusy(null);
    }
  };

  if (total === 0) return null;

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <span className="relative flex size-2">
            <span className="absolute inset-0 animate-ping rounded-full bg-rose-400 opacity-50" />
            <span className="relative size-2 rounded-full bg-rose-500" />
          </span>
          Needs your action
          <span className="rounded-full bg-rose-50 px-1.5 py-px text-[11px] font-semibold text-rose-700 ring-1 ring-rose-100">
            {total}
          </span>
        </span>
      }
      caption="Decide here, without opening the ticket"
    >
      <ul className="-mx-2 space-y-1">
        {shown.map(({ kind, ticket }) => {
          const working = busy === ticket.id;
          const left = kind === "approve" ? timeLeft(ticket.approvalDueAt) : "";
          return (
            <li key={`${kind}-${ticket.id}`} className="flex items-start gap-3 rounded-xl p-2 transition-colors hover:bg-ink-50/70">
              <span
                className={cn(
                  "mt-0.5 grid size-8 shrink-0 place-items-center rounded-full",
                  kind === "approve"
                    ? "bg-status-resolved-bg text-status-resolved-fg"
                    : "bg-tile-admin-bg text-tile-admin-fg",
                )}
              >
                {kind === "approve" ? <BadgeCheck className="size-4" /> : <UserPlus className="size-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => onOpen(ticket)}
                  className="block max-w-full cursor-pointer truncate text-left text-[12.5px] font-semibold text-ink-900 hover:text-royal-700"
                >
                  {ticket.subject}
                </button>
                <p className="truncate text-[11px] text-ink-400">
                  {ticket.number} ·{" "}
                  {kind === "approve"
                    ? `${ticket.resolvedByName || "The department"} says it is done${left ? ` · closes itself in ${left}` : ""}`
                    : `${ticket.raisedBy.name ?? "Someone"}'s request · asked to take it over`}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {kind === "approve" ? (
                    <>
                      <button type="button" disabled={working} onClick={() => approve(ticket)} className={PRIMARY}>
                        {working && <Loader2 className="size-3 animate-spin" />}
                        Approve
                      </button>
                      <button type="button" disabled={working} onClick={() => onOpen(ticket)} className={SECONDARY}>
                        Review or send back
                      </button>
                    </>
                  ) : (
                    <>
                      <button type="button" disabled={working} onClick={() => answer(ticket, "accept")} className={PRIMARY}>
                        {working && <Loader2 className="size-3 animate-spin" />}
                        Accept
                      </button>
                      <button
                        type="button"
                        disabled={working}
                        onClick={() => answer(ticket, "decline")}
                        className={SECONDARY}
                      >
                        Decline
                      </button>
                    </>
                  )}
                </div>
              </div>
            </li>
          );
        })}

        {notes.map((note) => {
          const Icon = note.icon;
          const button = note.href ? (
            <Link href={note.href as "/"} className={SECONDARY}>
              {note.label}
            </Link>
          ) : (
            <button type="button" onClick={note.onClick} className={SECONDARY}>
              {note.label}
            </button>
          );
          return (
            <li key={note.key} className="flex items-center gap-3 rounded-xl p-2 transition-colors hover:bg-ink-50/70">
              <span className={cn("grid size-8 shrink-0 place-items-center rounded-full", note.tint)}>
                <Icon className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12.5px] font-semibold text-ink-900">{note.title}</p>
                <p className="truncate text-[11px] text-ink-400">{note.note}</p>
              </div>
              {button}
            </li>
          );
        })}
      </ul>

      {hidden > 0 && (
        <button
          type="button"
          onClick={() =>
            onShow({
              label: "Waiting on you",
              value: items.length,
              caption: "Sign-offs and hand-overs waiting for your answer",
              tone: "rose",
              filters: [
                { key: "approvals", label: "To approve", ...TAB.approval, list: approvals },
                { key: "asks", label: "Asked to take", ...TAB.open, list: asks },
              ],
            })
          }
          className="mt-1 w-full cursor-pointer rounded-lg py-1.5 text-center text-[11.5px] font-semibold text-royal-700 hover:bg-royal-50"
        >
          +{hidden} more waiting on you
        </button>
      )}
    </Card>
  );
}
