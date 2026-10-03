"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlarmClock,
  AlertCircle,
  ArrowRight,
  CalendarClock,
  CircleCheckBig,
  CircleDashed,
  CirclePlus,
  CircleSlash,
  Hourglass,
  type LucideIcon,
  MessageSquareText,
  PencilLine,
  RefreshCw,
  Send,
  ShieldAlert,
  ShieldCheck,
  Timer,
  Undo2,
  Users,
} from "lucide-react";

import { Modal } from "@/components/ui/modal";
import { OriginTag } from "@/components/ui/badge";
import { errorMessage } from "@/lib/api";
import { listHistory } from "@/lib/assignments";
import type { TicketRecord } from "@/lib/tickets";
import { STATUS_LABEL, type TicketStatus } from "@/lib/types";
import { cn, formatDateOf, formatTime } from "@/lib/utils";

type Kind =
  | "raised"
  | "handover"
  | "status"
  | "approval"
  | "sent-back"
  | "completed"
  | "cancelled"
  | "promise"
  | "escalated"
  | "handled"
  | "edited"
  | "message";

/** Which chip a step answers to. */
type Lens = "all" | "status" | "people" | "dates" | "other";

const KIND: Record<Kind, { icon: LucideIcon; node: string; lens: Exclude<Lens, "all"> }> = {
  // The same blue, green and sky as the Raised, Completed and Approval tiles
  // above the story, so a tile and its step read as one thing.
  raised: { icon: CirclePlus, node: "bg-blue-600 text-white", lens: "status" },
  handover: { icon: Users, node: "bg-sky-100 text-sky-700", lens: "people" },
  status: { icon: RefreshCw, node: "bg-status-progress-bg text-status-progress-fg", lens: "status" },
  approval: { icon: Send, node: "bg-status-resolved-bg text-status-resolved-fg", lens: "status" },
  "sent-back": { icon: Undo2, node: "bg-status-rejected-bg text-status-rejected-fg", lens: "status" },
  completed: { icon: CircleCheckBig, node: "bg-status-completed-fg text-white", lens: "status" },
  cancelled: { icon: CircleSlash, node: "bg-ink-700 text-white", lens: "status" },
  promise: { icon: CalendarClock, node: "bg-status-waiting-bg text-status-waiting-fg", lens: "dates" },
  escalated: { icon: ShieldAlert, node: "bg-status-escalated-bg text-status-escalated-fg", lens: "other" },
  handled: { icon: ShieldCheck, node: "bg-status-escalated-bg text-status-escalated-fg", lens: "other" },
  edited: { icon: PencilLine, node: "bg-ink-100 text-ink-600", lens: "other" },
  message: { icon: MessageSquareText, node: "bg-ink-100 text-ink-500", lens: "other" },
};

const LENSES: { value: Lens; label: string }[] = [
  { value: "all", label: "Everything" },
  { value: "status", label: "Status & approvals" },
  { value: "people", label: "Handovers" },
  { value: "dates", label: "Dates" },
  { value: "other", label: "Edits & other" },
];

type Hue = "blue" | "green" | "violet" | "sky" | "orange" | "rose" | "slate";

/** A pastel wash and rim for a tile, and a deeper ink for its label and icon. */
const HUE: Record<Hue, { tile: string; ink: string }> = {
  blue: { tile: "bg-blue-50 ring-blue-100", ink: "text-blue-700" },
  green: { tile: "bg-emerald-50 ring-emerald-100", ink: "text-emerald-700" },
  violet: { tile: "bg-violet-50 ring-violet-100", ink: "text-violet-700" },
  sky: { tile: "bg-sky-50 ring-sky-100", ink: "text-sky-700" },
  orange: { tile: "bg-orange-50 ring-orange-100", ink: "text-orange-700" },
  rose: { tile: "bg-rose-50 ring-rose-100", ink: "text-rose-700" },
  slate: { tile: "bg-ink-50 ring-ink-200/70", ink: "text-ink-600" },
};

/** Where the ticket stands, in the colours the dashboard gives the same states. */
const STANDING: Record<TicketStatus, { hue: Hue; icon: LucideIcon }> = {
  New: { hue: "slate", icon: CircleDashed },
  "In Progress": { hue: "violet", icon: RefreshCw },
  Resolved: { hue: "sky", icon: Hourglass },
  Overdue: { hue: "rose", icon: AlarmClock },
  Completed: { hue: "green", icon: CircleCheckBig },
  Cancelled: { hue: "slate", icon: CircleSlash },
};

/** The time column, the line and the story: every row lines up on these. */
const ROW = "grid grid-cols-[4.5rem_2rem_1fr] gap-x-3";

type Step = {
  id: string;
  at: string;
  time: number;
  kind: Kind;
  title: string;
  /** A small tag after the title: which round of sign-off this is. */
  tag?: string;
  /** What moved, from and to: a status, a person, a date. */
  move?: { from: string; to: string };
  detail?: string;
  by: { name: string; role: string };
};

type History = Awaited<ReturnType<typeof listHistory>>;

/** "Nobody", or the names in a row. */
const names = (people: { name?: string }[]) =>
  people.length === 0 ? "Nobody" : people.map((person) => person.name ?? "Someone").join(", ");

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** What a stored status is called on screen. */
const statusName = (value: string) => STATUS_LABEL[value as TicketStatus] ?? value;

/**
 * "45 min", "2 hr 5 min", "20 hr", "3 days 4 hr" - how long something took,
 * written the way a map app says a journey, at the precision that matters.
 */
function span(ms: number) {
  const minutes = Math.round(Math.max(0, ms) / 60_000);
  if (minutes < 1) return "under 1 min";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest > 0 && hours < 10 ? `${hours} hr ${rest} min` : `${hours} hr`;
  }
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  const whole = `${days} ${days === 1 ? "day" : "days"}`;
  return rest > 0 ? `${whole} ${rest} hr` : whole;
}

const ordinal = (n: number) => {
  const tail = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${tail}`;
};

/**
 * "3:22" and "PM", apart, in the reader's own clock: the figure is read
 * first, the half of the day after. No leading zero to read past.
 */
function clock(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { figure: "", period: "" };
  const parts = new Intl.DateTimeFormat([], {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);
  return {
    figure: parts
      .filter((part) => part.type !== "dayPeriod")
      .map((part) => part.value)
      .join("")
      .trim(),
    period: parts.find((part) => part.type === "dayPeriod")?.value.toUpperCase() ?? "",
  };
}

const weekday = (iso: string, width: "short" | "long") =>
  new Date(iso).toLocaleDateString("en-GB", { weekday: width });

/** "Fri · 3:22 PM": the day and the time, under a tile's date. */
function dayAndTime(iso: string) {
  const { figure, period } = clock(iso);
  return `${weekday(iso, "short")} · ${figure} ${period}`.trim();
}

/**
 * The heading over one day of the story: "Today" or "Yesterday" when it is,
 * otherwise the weekday - and the date beside it either way.
 */
function dayLabel(iso: string, now: number) {
  const midnight = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  // Rounded, so a day that gained or lost an hour to the clocks still counts as one.
  const back = Math.round((midnight(new Date(now)) - midnight(new Date(iso))) / 86_400_000);
  if (back === 0 || back === 1) {
    return { name: back === 0 ? "Today" : "Yesterday", date: `${weekday(iso, "short")}, ${formatDateOf(iso)}` };
  }
  return { name: weekday(iso, "long"), date: formatDateOf(iso) };
}

/**
 * Turns the ticket's records - handovers, promised dates, and the lines the
 * system wrote into its thread - into one ordered story.
 *
 * An edit line carries everything that moved in one save, status first, so a
 * status change is read off its start and the rest kept as the detail.
 */
function buildSteps(ticket: TicketRecord, data: History): Step[] {
  const steps: Step[] = [];
  const add = (step: Omit<Step, "time">) => steps.push({ ...step, time: Date.parse(step.at) });

  for (const entry of data.assignments) {
    if (entry.kind === "raised") {
      add({
        id: `a-${entry.id}`,
        at: entry.createdAt,
        kind: "raised",
        title: "Ticket raised",
        detail:
          entry.to.length > 0
            ? `Assigned to ${names(entry.to)}`
            : `Sent to ${ticket.department.name ?? "the department"}`,
        by: entry.by,
      });
    } else {
      add({
        id: `a-${entry.id}`,
        at: entry.createdAt,
        kind: "handover",
        title: "Handed over",
        move: { from: names(entry.from), to: names(entry.to) },
        by: entry.by,
      });
    }
  }

  for (const entry of data.commitments ?? []) {
    const title = {
      promised: "Date promised",
      extended: "Date extended",
      "pulled-in": "Date brought forward",
      withdrawn: "Promised date withdrawn",
    }[entry.kind];
    add({
      id: `c-${entry.id}`,
      at: entry.createdAt,
      kind: "promise",
      title,
      move:
        entry.previousDate || entry.date
          ? {
              from: entry.previousDate ? formatDateOf(entry.previousDate) : "",
              to: entry.date ? formatDateOf(entry.date) : "No date",
            }
          : undefined,
      detail: entry.reason || undefined,
      by: entry.by,
    });
  }

  for (const entry of data.events) {
    const base = { id: `e-${entry.id}`, at: entry.createdAt, by: entry.by };
    const body = entry.body ?? "";

    switch (entry.event) {
      case "resolved":
        add({
          ...base,
          kind: "approval",
          title: "Approval sent",
          detail: capital(body.replace(/^marked this resolved\s*-\s*/i, "")),
        });
        break;
      case "approved":
        add({ ...base, kind: "completed", title: "Approved · Completed" });
        break;
      case "auto-approved":
        add({ ...base, kind: "completed", title: "Auto-approved · Completed", detail: capital(body) });
        break;
      case "rejected":
        add({
          ...base,
          kind: "sent-back",
          title: "Sent back",
          detail: capital(body.replace(/^sent it back\s*-\s*/i, "")),
        });
        break;
      case "escalated":
        add({ ...base, kind: "escalated", title: "Escalated", detail: capital(body) });
        break;
      case "escalation.handled":
        add({ ...base, kind: "handled", title: "Escalation handled", detail: capital(body) });
        break;
      case "message.edited":
      case "message.deleted":
        add({
          ...base,
          kind: "message",
          title: entry.event === "message.edited" ? "Message edited" : "Message withdrawn",
          detail: capital(body),
        });
        break;
      default: {
        const cancelled = body.match(/^cancelled the ticket\s*-\s*([\s\S]*)$/i);
        const status = body.match(/^status ([A-Za-z ]+?) -> ([A-Za-z ]+?)(?:, ([\s\S]*))?$/);
        if (cancelled) {
          add({ ...base, kind: "cancelled", title: "Cancelled", detail: capital(cancelled[1]) });
        } else if (status) {
          const [, from, to, rest] = status;
          const reopened = from === "Completed" || from === "Cancelled";
          add({
            ...base,
            kind: to === "Completed" ? "completed" : "status",
            title: to === "Completed" ? "Completed" : reopened ? "Reopened" : "Status changed",
            move: { from: statusName(from), to: statusName(to) },
            detail: rest ? capital(rest.replaceAll(" -> ", " → ")) : undefined,
          });
        } else {
          add({ ...base, kind: "edited", title: "Edited", detail: capital(body.replaceAll(" -> ", " → ")) });
        }
      }
    }
  }

  // Tickets older than the trail: what the ticket itself remembers fills the gaps.
  const has = (kind: Kind) => steps.some((step) => step.kind === kind);
  if (!has("raised")) {
    add({
      id: "raised",
      at: ticket.createdAt,
      kind: "raised",
      title: "Ticket raised",
      detail: `Sent to ${ticket.department.name ?? "the department"}`,
      by: { name: ticket.raisedBy.name ?? "Someone", role: ticket.raisedByRole ?? "user" },
    });
  }
  if (ticket.resolvedAt && !has("approval") && (ticket.status === "Resolved" || ticket.status === "Completed")) {
    add({
      id: "resolved",
      at: ticket.resolvedAt,
      kind: "approval",
      title: "Approval sent",
      by: { name: ticket.resolvedByName || "The department", role: "user" },
    });
  }
  if (ticket.status === "Completed" && ticket.completedAt && !has("completed")) {
    const auto = ticket.approvedByName === "Auto-approved";
    add({
      id: "completed",
      at: ticket.completedAt,
      kind: "completed",
      title: auto ? "Auto-approved · Completed" : "Completed",
      by: { name: auto ? "FlowDesk" : ticket.approvedByName || "Someone", role: "user" },
    });
  }
  if (ticket.status === "Cancelled" && ticket.cancelledAt && !has("cancelled")) {
    add({
      id: "cancelled",
      at: ticket.cancelledAt,
      kind: "cancelled",
      title: "Cancelled",
      detail: ticket.cancelReason || undefined,
      by: { name: ticket.cancelledByName || "Someone", role: "user" },
    });
  }

  // Raising always opens the story, even when a handover shares its second.
  steps.sort((a, b) => a.time - b.time || Number(b.kind === "raised") - Number(a.kind === "raised"));

  // Asked more than once: each ask says which round it was.
  const rounds = steps.filter((step) => step.kind === "approval");
  if (rounds.length > 1) rounds.forEach((step, index) => (step.tag = `${ordinal(index + 1)} request`));

  return steps;
}

/**
 * Everything that happened to a ticket, in order, with the date and time of
 * each - raised, handed over, dates promised, asked for approval, sent back,
 * approved. Opened from the Dates block of the ticket's sheet.
 */
export function TicketTimeline({
  ticket,
  open,
  onClose,
}: {
  ticket: TicketRecord;
  open: boolean;
  onClose: () => void;
}) {
  /** The records as they came, and when: "open for" is measured to that moment. */
  const [loaded, setLoaded] = useState<{ data: History; now: number } | null>(null);
  const [error, setError] = useState("");
  const [lens, setLens] = useState<Lens>("all");

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    listHistory(ticket.id, controller.signal)
      .then((data) => {
        setLoaded({ data, now: Date.now() });
        setError("");
      })
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setLoaded({ data: { assignments: [], events: [], commitments: [] }, now: Date.now() });
        setError(errorMessage(caught));
      });
    return () => controller.abort();
  }, [open, ticket.id, ticket.updatedAt]);

  const now = loaded?.now ?? 0;
  const steps = useMemo(() => (loaded ? buildSteps(ticket, loaded.data) : null), [loaded, ticket]);

  const shown = useMemo(
    () => (steps ?? []).filter((step) => lens === "all" || KIND[step.kind].lens === lens),
    [steps, lens],
  );

  // One heading per day. How long passed since the step before rides on the
  // line between them - above the day's heading when a new day starts.
  const days = useMemo(() => {
    const out: {
      key: string;
      label: ReturnType<typeof dayLabel>;
      lead: number | null;
      items: { step: Step; gap: number | null }[];
    }[] = [];
    shown.forEach((step, index) => {
      const gap = index > 0 ? step.time - shown[index - 1].time : null;
      const key = formatDateOf(step.at);
      if (out.at(-1)?.key === key) out.at(-1)!.items.push({ step, gap });
      else out.push({ key, label: dayLabel(step.at, now), lead: gap, items: [{ step, gap: null }] });
    });
    return out;
  }, [shown, now]);

  if (!open) return null;

  const closed = ticket.status === "Completed" || ticket.status === "Cancelled";
  const endAt =
    ticket.status === "Completed"
      ? ticket.completedAt
      : ticket.status === "Cancelled"
        ? (ticket.cancelledAt ?? null)
        : null;
  const took = (endAt ? Date.parse(endAt) : (loaded?.now ?? Date.parse(ticket.createdAt))) - Date.parse(ticket.createdAt);
  const asked = steps?.filter((step) => step.kind === "approval").length ?? 0;
  const sentBack = steps?.filter((step) => step.kind === "sent-back").length ?? 0;
  const standing = STANDING[ticket.status] ?? STANDING.New;
  const last = shown.at(-1);

  const counts = (value: Lens) =>
    value === "all" ? (steps?.length ?? 0) : (steps ?? []).filter((step) => KIND[step.kind].lens === value).length;

  return createPortal(
    <Modal
      open
      onClose={onClose}
      title={`Timeline · ${ticket.number}`}
      description={ticket.subject}
      className="max-w-2xl"
    >
      {/* The whole story in four numbers, before the detail. */}
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile
          label="Raised"
          hue="blue"
          icon={CirclePlus}
          value={formatDateOf(ticket.createdAt)}
          note={dayAndTime(ticket.createdAt)}
        />
        <Tile
          label={closed ? (ticket.status === "Completed" ? "Completed" : "Cancelled") : "Status now"}
          hue={standing.hue}
          icon={standing.icon}
          value={endAt ? formatDateOf(endAt) : statusName(ticket.status)}
          note={endAt ? dayAndTime(endAt) : "Still open"}
        />
        <Tile
          label={closed ? "Took" : "Open for"}
          hue="orange"
          icon={Timer}
          value={span(took)}
          note={closed ? `Raised to ${ticket.status === "Completed" ? "completed" : "cancelled"}` : "So far"}
        />
        <Tile
          label="Approvals"
          hue="sky"
          icon={Send}
          value={asked === 0 ? "None yet" : `${asked} ${asked === 1 ? "request" : "requests"}`}
          note={sentBack > 0 ? `Sent back ${sentBack} time${sentBack === 1 ? "" : "s"}` : asked > 0 ? "None sent back" : "Not sent for approval"}
          warn={sentBack > 0}
        />
      </dl>

      {/* Narrowing the story to one thread of it. */}
      {steps && steps.length > 0 && (
        <div role="tablist" aria-label="Show" className="mt-4 flex flex-wrap gap-1.5">
          {LENSES.filter((item) => item.value === "all" || counts(item.value) > 0).map((item) => (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={lens === item.value}
              onClick={() => setLens(item.value)}
              className={cn(
                "inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-semibold transition-colors",
                lens === item.value
                  ? "border-ink-900 bg-ink-900 text-white"
                  : "border-line-strong bg-surface text-ink-600 hover:bg-ink-50",
              )}
            >
              {item.label}
              <span
                className={cn(
                  "rounded-full px-1.5 py-px text-[10px] font-bold tabular-nums",
                  lens === item.value ? "bg-white/20" : "bg-ink-100 text-ink-500",
                )}
              >
                {counts(item.value)}
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="mt-3 -mr-2 max-h-[min(58vh,560px)] overflow-y-auto overscroll-contain pr-2">
        {error && (
          <p role="alert" className="flex items-start gap-2 rounded-field bg-brand-50 px-3 py-2 text-xs font-medium text-brand-700">
            <AlertCircle className="mt-px size-4 shrink-0" />
            {error}
          </p>
        )}

        {steps === null && (
          <ul aria-hidden className="space-y-4 py-2">
            {[0, 1, 2, 3].map((row) => (
              <li key={row} className={cn(ROW, "items-start")}>
                <span className="mt-2 ml-auto h-3.5 w-12 animate-pulse rounded bg-ink-100" />
                <span className="mx-auto size-8 animate-pulse rounded-full bg-ink-100" />
                <span className="space-y-1.5 pt-1.5">
                  <span className="block h-3.5 w-2/5 animate-pulse rounded bg-ink-100" />
                  <span className="block h-3 w-3/5 animate-pulse rounded bg-ink-100" />
                </span>
              </li>
            ))}
          </ul>
        )}

        {steps && shown.length > 0 && (
          <ol className="relative py-1 before:absolute before:top-4 before:bottom-4 before:left-[calc(6.25rem-0.5px)] before:w-px before:bg-line">
            {days.map((group) => (
              <li key={group.key}>
                {group.lead !== null && <Gap ms={group.lead} />}
                {/* The day, on the line itself. */}
                <div className={cn(ROW, "items-center py-2")}>
                  <span />
                  <span className="relative mx-auto size-2.5 rounded-full bg-ink-300 ring-4 ring-surface" />
                  <p className="justify-self-start rounded-full bg-ink-100 px-2.5 py-0.5 text-[12px] leading-5">
                    <span className="font-bold text-ink-800">{group.label.name}</span>
                    <span className="font-medium text-ink-500"> · {group.label.date}</span>
                  </p>
                </div>
                <ol>
                  {group.items.map(({ step, gap }) => (
                    <StepRow key={step.id} step={step} gap={gap} />
                  ))}
                </ol>
              </li>
            ))}

            {/* Still going: where the story stands now, and how long since the last step. */}
            {!closed && lens === "all" && (
              <li>
                {last && <Gap ms={now - last.time} />}
                <div className={cn(ROW, "items-start")}>
                  <span className="pt-1.5 text-right text-[13px] font-semibold text-ink-500">Now</span>
                  <span className="relative mx-auto grid size-8 place-items-center rounded-full border-2 border-dashed border-line-strong bg-surface text-ink-400">
                    <Hourglass className="size-3.5" />
                  </span>
                  <p className="pt-1.5 text-[13.5px] font-semibold text-ink-800">
                    {statusName(ticket.status)}
                    <span className="font-normal text-ink-500"> · open for {span(took)}</span>
                  </p>
                </div>
              </li>
            )}
          </ol>
        )}

        {steps && steps.length > 0 && shown.length === 0 && (
          <p className="py-8 text-center text-sm text-ink-400">Nothing of this kind yet.</p>
        )}
      </div>
    </Modal>,
    document.body,
  );
}

/**
 * One of the four numbers: a pastel tile with its icon on a white chip - the
 * dashboard's cards, in small - the figure, and a line saying what is behind it.
 */
function Tile({
  label,
  hue,
  icon: Icon,
  value,
  note,
  warn,
}: {
  label: string;
  hue: Hue;
  icon: LucideIcon;
  value: string;
  note: string;
  /** The note is something to notice: it went back at least once. */
  warn?: boolean;
}) {
  const tone = HUE[hue];

  return (
    <div className={cn("min-w-0 rounded-xl px-3 py-2.5 ring-1 ring-inset", tone.tile)}>
      <dt className={cn("flex items-center gap-1.5 text-[11.5px] font-semibold", tone.ink)}>
        <span className="grid size-5.5 shrink-0 place-items-center rounded-md bg-white shadow-[0_1px_2px_rgba(15,23,42,0.08)]">
          <Icon className="size-3.5" strokeWidth={2.25} />
        </span>
        <span className="truncate">{label}</span>
      </dt>
      <dd className="mt-1.5 text-[15px] leading-5 font-bold tracking-[-0.01em] text-ink-900 tabular-nums">
        {value}
      </dd>
      <dd className={cn("mt-0.5 truncate text-[12px] font-medium", warn ? "text-rose-700" : "text-ink-600")}>
        {note}
      </dd>
    </div>
  );
}

/**
 * How long passed between two steps, as a chip sitting on the line between
 * them. A wait of a day or more is tinted, so the slow stretches stand out.
 */
function Gap({ ms }: { ms: number }) {
  if (ms < 60_000) return null;
  const long = ms >= 86_400_000;

  return (
    <div className="relative h-7">
      <span
        className={cn(
          "absolute top-1/2 left-25 inline-flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap tabular-nums ring-1",
          long ? "bg-amber-50 text-amber-800 ring-amber-200" : "bg-surface text-ink-600 ring-line-strong",
        )}
      >
        <Timer className="size-3" />
        {span(ms)} later
      </span>
    </div>
  );
}

function StepRow({ step, gap }: { step: Step; gap: number | null }) {
  const meta = KIND[step.kind];
  const Icon = meta.icon;
  const { figure, period } = clock(step.at);

  return (
    <li>
      {gap !== null && <Gap ms={gap} />}
      <div className={cn(ROW, "items-start")}>
        {/* When: the figure large, the half of the day small beside it. */}
        <p
          className="pt-1.5 text-right whitespace-nowrap"
          title={`${formatDateOf(step.at)}, ${formatTime(step.at)}`}
        >
          <time dateTime={step.at} className="text-[14px] font-semibold text-ink-900 tabular-nums">
            {figure}
          </time>
          {period && <span className="ml-1 text-[10.5px] font-semibold text-ink-500">{period}</span>}
        </p>

        <span className={cn("relative mx-auto grid size-8 place-items-center rounded-full ring-4 ring-surface", meta.node)}>
          <Icon className="size-4" strokeWidth={2.25} />
        </span>

        <div className="min-w-0 pt-1.5 pb-3">
          <p className="flex flex-wrap items-center gap-1.5">
            <span className="text-[13.5px] font-bold text-ink-900">{step.title}</span>
            {step.tag && (
              <span className="rounded bg-status-resolved-bg px-1.5 py-px text-[10px] font-bold tracking-wide text-status-resolved-fg uppercase">
                {step.tag}
              </span>
            )}
          </p>

          {step.move && (
            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px]">
              {step.move.from && (
                <>
                  <span className="rounded-md bg-ink-100 px-1.5 py-0.5 font-medium text-ink-500">{step.move.from}</span>
                  <ArrowRight className="size-3.5 shrink-0 text-ink-300" />
                </>
              )}
              <span className="rounded-md bg-ink-900/6 px-1.5 py-0.5 font-semibold text-ink-900">{step.move.to}</span>
            </p>
          )}

          {step.detail && (
            <p className="mt-1 rounded-md border-l-2 border-line-strong bg-ink-50 px-2 py-1 text-[12px] leading-snug whitespace-pre-wrap text-ink-700">
              {step.detail}
            </p>
          )}

          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-500">
            by <span className="font-semibold text-ink-700">{step.by.name}</span>
            <OriginTag role={step.by.role} />
          </p>
        </div>
      </div>
    </li>
  );
}
