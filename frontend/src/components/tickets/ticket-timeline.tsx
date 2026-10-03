"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertCircle,
  ArrowRight,
  CalendarClock,
  CircleCheckBig,
  CirclePlus,
  CircleSlash,
  type LucideIcon,
  MessageSquareText,
  PencilLine,
  RefreshCw,
  Send,
  ShieldAlert,
  ShieldCheck,
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
  { value: "all", label: "All" },
  { value: "status", label: "Status" },
  { value: "people", label: "Handovers" },
  { value: "dates", label: "Dates" },
  { value: "other", label: "Edits" },
];

/** Where the ticket stands, as a dot beside its name in the summary. */
const STATUS_DOT: Record<TicketStatus, string> = {
  New: "bg-ink-400",
  "In Progress": "bg-violet-500",
  Resolved: "bg-sky-500",
  Overdue: "bg-rose-500",
  Completed: "bg-emerald-500",
  Cancelled: "bg-ink-400",
};

/** The filters earn their row only once the story is long enough to need them. */
const FILTER_FROM = 6;

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

/** "3:22 PM", in the reader's own clock, without a leading zero to read past. */
const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true }).toUpperCase();

const weekday = (iso: string, width: "short" | "long") =>
  new Date(iso).toLocaleDateString("en-GB", { weekday: width });

/** "29 Sep, 7:18 AM" - the year only when it is not this one. */
function shortWhen(iso: string) {
  const date = new Date(iso);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  const day = date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
  return `${day}, ${clock(iso)}`;
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
  const last = shown.at(-1);

  const counts = (value: Lens) =>
    value === "all" ? (steps?.length ?? 0) : (steps ?? []).filter((step) => KIND[step.kind].lens === value).length;
  const lenses = LENSES.filter((item) => item.value === "all" || counts(item.value) > 0);

  return createPortal(
    <Modal
      open
      onClose={onClose}
      title={`Timeline · ${ticket.number}`}
      description={ticket.subject}
      className="max-w-xl"
    >
      {/* The whole story in one strip of four facts. */}
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-4">
        <Fact label="Raised">{shortWhen(ticket.createdAt)}</Fact>
        <Fact label={closed ? (ticket.status === "Completed" ? "Completed" : "Cancelled") : "Status"}>
          {endAt ? (
            shortWhen(endAt)
          ) : (
            <span className="inline-flex max-w-full items-center gap-1.5">
              <span className={cn("size-1.5 shrink-0 rounded-full", STATUS_DOT[ticket.status] ?? "bg-ink-400")} />
              <span className="truncate">{statusName(ticket.status)}</span>
            </span>
          )}
        </Fact>
        <Fact label={closed ? "Took" : "Open for"}>{span(took)}</Fact>
        <Fact label="Approvals">
          {asked === 0 ? (
            <span className="font-medium text-ink-400">None</span>
          ) : (
            <>
              {asked} sent
              {sentBack > 0 && <span className="text-rose-600"> · {sentBack} back</span>}
            </>
          )}
        </Fact>
      </dl>

      {/* Narrowing a long story to one thread of it. */}
      {steps && steps.length >= FILTER_FROM && lenses.length > 2 && (
        <div role="tablist" aria-label="Show" className="mt-3 inline-flex rounded-lg bg-ink-100/70 p-0.5">
          {lenses.map((item) => (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={lens === item.value}
              onClick={() => setLens(item.value)}
              className={cn(
                "inline-flex h-6 cursor-pointer items-center gap-1 rounded-md px-2 text-[11.5px] font-semibold transition-colors",
                lens === item.value ? "bg-surface text-ink-900 shadow-sm" : "text-ink-500 hover:text-ink-800",
              )}
            >
              {item.label}
              <span className="text-[10.5px] font-medium text-ink-400 tabular-nums">{counts(item.value)}</span>
            </button>
          ))}
        </div>
      )}

      <div className="mt-4 -mr-2 max-h-[min(60vh,560px)] overflow-y-auto overscroll-contain pr-2">
        {error && (
          <p role="alert" className="flex items-start gap-2 rounded-field bg-brand-50 px-3 py-2 text-xs font-medium text-brand-700">
            <AlertCircle className="mt-px size-4 shrink-0" />
            {error}
          </p>
        )}

        {steps === null && (
          <ul aria-hidden className="space-y-3 py-1">
            {[0, 1, 2].map((row) => (
              <li key={row} className="flex items-center gap-3">
                <span className="size-5 shrink-0 animate-pulse rounded-full bg-ink-100" />
                <span className="h-3 flex-1 animate-pulse rounded bg-ink-100" />
                <span className="h-3 w-12 animate-pulse rounded bg-ink-100" />
              </li>
            ))}
          </ul>
        )}

        {steps && shown.length > 0 && (
          // One thin line down the icons; everything else hangs off it.
          <ol className="relative before:absolute before:top-3 before:bottom-3 before:left-[9.5px] before:w-px before:bg-line">
            {days.map((group, index) => (
              <li key={group.key}>
                <p className={cn("flex items-center gap-2 pb-2 pl-8 text-[11px]", index > 0 && "pt-1")}>
                  <span className="font-semibold text-ink-700">{group.label.name}</span>
                  <span className="text-ink-400">{group.label.date}</span>
                  {group.lead !== null && <Gap ms={group.lead} />}
                </p>
                <ol>
                  {group.items.map(({ step, gap }) => (
                    <StepRow key={step.id} step={step} gap={gap} />
                  ))}
                </ol>
              </li>
            ))}

            {/* Still going: where it stands now. */}
            {!closed && lens === "all" && (
              <li className="flex items-center gap-3">
                <span className="relative grid size-5 shrink-0 place-items-center rounded-full border border-dashed border-ink-300 bg-surface">
                  <span className="size-1.5 animate-pulse rounded-full bg-ink-400" />
                </span>
                <p className="min-w-0 flex-1 truncate text-[12.5px] text-ink-500">
                  <span className="font-semibold text-ink-700">Now</span> · {statusName(ticket.status)}
                </p>
                {last && <Gap ms={now - last.time} />}
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

/** One of the four facts: a quiet label over its value. */
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 bg-surface px-3 py-2">
      <dt className="text-[10px] font-semibold tracking-wider text-ink-400 uppercase">{label}</dt>
      <dd className="mt-0.5 truncate text-[12.5px] font-semibold text-ink-900 tabular-nums">{children}</dd>
    </div>
  );
}

/** How long passed since the step before, said quietly - a day or more in amber. */
function Gap({ ms }: { ms: number }) {
  if (ms < 60_000) return null;
  return (
    <span
      className={cn(
        "shrink-0 text-[10.5px] font-medium whitespace-nowrap tabular-nums",
        ms >= 86_400_000 ? "text-amber-600" : "text-ink-400",
      )}
    >
      +{span(ms)}
    </span>
  );
}

function StepRow({ step, gap }: { step: Step; gap: number | null }) {
  const meta = KIND[step.kind];
  const Icon = meta.icon;

  return (
    <li className="flex gap-3 pb-3.5">
      <span className={cn("relative grid size-5 shrink-0 place-items-center rounded-full ring-[3px] ring-surface", meta.node)}>
        <Icon className="size-3" strokeWidth={2.5} />
      </span>

      <div className="min-w-0 flex-1">
        {/* What happened and who did it, with the time at the end. */}
        <p className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-500">
            <span className="font-semibold text-ink-900">{step.title}</span>
            {step.tag && <span className="ml-1.5 text-[10.5px] font-semibold text-status-resolved-fg">{step.tag}</span>}
            <span> · {step.by.name}</span>
          </span>
          <OriginTag role={step.by.role} />
          {gap !== null && <Gap ms={gap} />}
          <time
            dateTime={step.at}
            title={`${formatDateOf(step.at)}, ${formatTime(step.at)}`}
            className="shrink-0 text-[11px] font-medium text-ink-500 tabular-nums"
          >
            {clock(step.at)}
          </time>
        </p>

        {step.move && (
          <p className="mt-0.5 flex flex-wrap items-center gap-1 text-[11.5px]">
            {step.move.from && (
              <>
                <span className="text-ink-400">{step.move.from}</span>
                <ArrowRight className="size-3 shrink-0 text-ink-300" />
              </>
            )}
            <span className="font-semibold text-ink-700">{step.move.to}</span>
          </p>
        )}

        {step.detail && (
          <p className="mt-0.5 text-[11.5px] leading-snug whitespace-pre-wrap text-ink-500">{step.detail}</p>
        )}
      </div>
    </li>
  );
}
