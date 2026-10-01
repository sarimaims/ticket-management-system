"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  ArrowUpRight,
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  HandHelping,
  Pause,
  Play,
  ShieldCheck,
  Siren,
  UserRoundCheck,
  X,
  type LucideIcon,
} from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { useNotifications } from "@/components/notifications/notification-provider";
import { APPROVALS_CHANGED, timeLeft } from "@/components/tickets/approval-banner";
import { ESCALATIONS_CHANGED } from "@/components/tickets/escalation-card";
import { isSuperAdmin } from "@/lib/auth";
import {
  countEscalations,
  isDueTodayOnly,
  isOverdue,
  listApprovals,
  listTickets,
} from "@/lib/tickets";
import { isClosed } from "@/lib/types";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ model */

type Kind = "escalation" | "approval" | "handover" | "overdue" | "due" | "assigned";

type Moment = {
  /** Stable across refreshes, so a cleared moment stays cleared. */
  key: string;
  kind: Kind;
  title: string;
  detail: string;
  href: string;
};

/**
 * How each kind of moment looks, and how much it matters.
 *
 * The island is pearl-white, so every kind wears the palest wash of its
 * colour with the colour itself only on the glyph - enough to tell an
 * approval from a deadline at a glance, never enough to shout. Rank decides
 * both the order of the list and which moment the pill leads with: what needs
 * a decision outranks what merely needs doing.
 */
const KIND: Record<
  Kind,
  { icon: LucideIcon; label: string; tone: string; glow: string; ink: string; rank: number }
> = {
  escalation: {
    icon: Siren,
    label: "Escalation",
    tone: "bg-rose-50 text-rose-600 ring-rose-100",
    glow: "bg-rose-400",
    ink: "text-rose-600",
    rank: 0,
  },
  approval: {
    icon: ShieldCheck,
    label: "Approval",
    tone: "bg-sky-50 text-sky-600 ring-sky-100",
    glow: "bg-sky-400",
    ink: "text-sky-600",
    rank: 1,
  },
  handover: {
    icon: HandHelping,
    label: "Handover",
    tone: "bg-violet-50 text-violet-600 ring-violet-100",
    glow: "bg-violet-400",
    ink: "text-violet-600",
    rank: 2,
  },
  overdue: {
    icon: CircleAlert,
    label: "Overdue",
    tone: "bg-orange-50 text-orange-600 ring-orange-100",
    glow: "bg-orange-400",
    ink: "text-orange-600",
    rank: 3,
  },
  due: {
    icon: CalendarClock,
    label: "Due today",
    tone: "bg-amber-50 text-amber-600 ring-amber-100",
    glow: "bg-amber-400",
    ink: "text-amber-600",
    rank: 4,
  },
  assigned: {
    icon: UserRoundCheck,
    label: "New on your desk",
    tone: "bg-emerald-50 text-emerald-600 ring-emerald-100",
    glow: "bg-emerald-400",
    ink: "text-emerald-600",
    rank: 5,
  },
};

/** How long one moment holds the pill before the next takes its place. */
const HOLD_MS = 4200;

/** How often to look again when nothing has said anything changed. */
const REFRESH_MS = 60_000;

/**
 * The surface both the pill and the panel are cut from: white going very
 * slightly cool towards the bottom, a hairline edge, a lit top rim and a long
 * soft shadow - lifted off the bar rather than printed on it.
 */
const PEARL =
  "bg-linear-to-b from-white to-[#f7f8fb] ring-1 ring-ink-900/[0.07] " +
  "shadow-[0_1px_2px_rgba(15,23,42,0.05),0_10px_28px_-12px_rgba(15,23,42,0.22),inset_0_1px_0_#fff]";

/* ------------------------------------------------------ what was cleared */

/**
 * Cleared moments, kept per browser and per day.
 *
 * Clearing is "I have seen this", not "this is done" - the ticket is still
 * due, still waiting on an answer - so it lives with the viewer rather than on
 * the server, and tomorrow starts clean: a thing cleared on Monday that is
 * still waiting on Tuesday has earned its place back.
 */
const today = () => new Date().toLocaleDateString("en-CA");
const CLEARED_PREFIX = "flowdesk.island.cleared.";

function readCleared(): string[] {
  try {
    const raw = localStorage.getItem(CLEARED_PREFIX + today());
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function writeCleared(keys: string[]) {
  try {
    // Yesterday's list is of no use to anyone; it goes as today's is written.
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const name = localStorage.key(index);
      if (name?.startsWith(CLEARED_PREFIX) && name !== CLEARED_PREFIX + today()) {
        localStorage.removeItem(name);
      }
    }
    localStorage.setItem(CLEARED_PREFIX + today(), JSON.stringify(keys));
  } catch {
    // A browser that will not keep it simply shows them again after a reload.
  }
}

/**
 * Whether the island has been put away. Unlike clearing this is a preference
 * about the bar, not about the day, so it holds until they bring it back.
 */
const HIDDEN_KEY = "flowdesk.island.hidden";

function readHidden() {
  try {
    return localStorage.getItem(HIDDEN_KEY) === "1";
  } catch {
    return false;
  }
}

function writeHidden(hidden: boolean) {
  try {
    if (hidden) localStorage.setItem(HIDDEN_KEY, "1");
    else localStorage.removeItem(HIDDEN_KEY);
  } catch {
    // Put away for this visit only.
  }
}

/* --------------------------------------------------------------- the data */

/**
 * Everything that wants this person today, most pressing first.
 *
 * Read from what the app already knows rather than from a feed of its own:
 * the tickets on their desk, the requests waiting on their sign-off, the
 * asks put to them, and - for the super admin - what has been escalated.
 */
function useMoments() {
  const { session } = useAuth();
  const { items, loading } = useNotifications();
  const [moments, setMoments] = useState<Moment[]>([]);
  const [loaded, setLoaded] = useState(false);
  const top = isSuperAdmin(session);
  const meId = session?.id;

  // A new line in the bell is the moment to look again, rather than waiting
  // out the minute.
  const pulse = items.map((item) => item.id).join(",");

  // Assigned to them today, from the feed: the one kind of moment that is an
  // event rather than a state of a ticket.
  const assignedToday = useMemo(() => {
    const day = new Date().toDateString();
    return items
      .filter(
        (item) =>
          !item.read &&
          item.ticket &&
          (item.event === "assigned" || item.event === "moved") &&
          item.forRaiser !== true &&
          new Date(item.createdAt).toDateString() === day,
      )
      .map((item) => ({
        key: `assigned:${item.ticket}`,
        kind: "assigned" as const,
        title:
          item.event === "moved"
            ? `${item.ticketNumber} transferred to you`
            : `${item.ticketNumber} assigned to you`,
        detail: item.body || "Now on your desk",
        href: `/assigned-to-me?ticket=${item.ticket}`,
      }));
  }, [items]);

  useEffect(() => {
    if (!meId) return;
    const controller = new AbortController();

    const load = async () => {
      const [desk, approvals, escalations] = await Promise.all([
        listTickets({ scope: "assigned" }, controller.signal).catch(() => []),
        listApprovals(controller.signal).catch(() => []),
        top ? countEscalations(controller.signal).catch(() => 0) : Promise.resolve(0),
      ]);
      if (controller.signal.aborted) return;

      const found: Moment[] = [];

      if (escalations > 0) {
        found.push({
          key: `escalation:${escalations}`,
          kind: "escalation",
          title:
            escalations === 1 ? "An escalation needs you" : `${escalations} escalations need you`,
          detail: "Waiting on your decision",
          href: "/escalations",
        });
      }

      for (const ticket of approvals) {
        const left = timeLeft(ticket.approvalDueAt);
        found.push({
          key: `approval:${ticket.id}`,
          kind: "approval",
          title: `Approve ${ticket.number}`,
          detail: left ? `${ticket.subject} · closes itself in ${left}` : ticket.subject,
          href: `/my-requests?ticket=${ticket.id}&open=1`,
        });
      }

      for (const ticket of desk) {
        const href = `/assigned-to-me?ticket=${ticket.id}`;
        if (ticket.awaitingMe && !isClosed(ticket.status)) {
          found.push({
            key: `handover:${ticket.id}`,
            kind: "handover",
            title: `${ticket.number} is being handed to you`,
            detail: ticket.subject,
            href,
          });
        } else if (isOverdue(ticket)) {
          found.push({
            key: `overdue:${ticket.id}`,
            kind: "overdue",
            title: `${ticket.number} is overdue`,
            detail: ticket.subject,
            href,
          });
        } else if (isDueTodayOnly(ticket)) {
          found.push({
            key: `due:${ticket.id}`,
            kind: "due",
            title: `${ticket.number} is due today`,
            detail: ticket.subject,
            href,
          });
        }
      }

      setMoments(found);
      setLoaded(true);
    };

    void load();
    const timer = setInterval(load, REFRESH_MS);
    const again = () => void load();
    window.addEventListener(APPROVALS_CHANGED, again);
    window.addEventListener(ESCALATIONS_CHANGED, again);
    window.addEventListener("focus", again);

    return () => {
      controller.abort();
      clearInterval(timer);
      window.removeEventListener(APPROVALS_CHANGED, again);
      window.removeEventListener(ESCALATIONS_CHANGED, again);
      window.removeEventListener("focus", again);
    };
  }, [meId, top, pulse]);

  const merged = useMemo(() => {
    // A ticket already on the list for a stronger reason is not repeated as
    // "assigned" - being due today says more than having arrived today.
    const held = new Set(moments.map((moment) => moment.key.split(":")[1]));
    return [
      ...moments,
      ...assignedToday.filter((moment) => !held.has(moment.key.split(":")[1])),
    ].sort((a, b) => KIND[a.kind].rank - KIND[b.kind].rank);
  }, [moments, assignedToday]);

  // Ready once both the tickets and the bell have answered, so what was
  // already there when the page opened is not announced as news.
  return { moments: merged, ready: loaded && !loading };
}

/* ------------------------------------------------------------------ view */

/** The small round glyph a moment wears, in its own colour. */
const GLYPH = {
  sm: { box: "size-5", icon: "size-3" },
  md: { box: "size-8", icon: "size-4" },
  lg: { box: "size-10", icon: "size-5" },
};

function Glyph({ kind, size = "sm" }: { kind: Kind; size?: keyof typeof GLYPH }) {
  const Icon = KIND[kind].icon;
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-full ring-1",
        GLYPH[size].box,
        KIND[kind].tone,
      )}
    >
      <Icon className={GLYPH[size].icon} strokeWidth={2.25} />
    </span>
  );
}

type IslandProps = {
  moments: Moment[];
  /** Whether the first look is done; only what arrives after it pops. */
  ready: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hidden: boolean;
  onHiddenChange: (hidden: boolean) => void;
  onClear: (keys: string[]) => void;
  onFollow: (moment: Moment) => void;
};

/**
 * The island itself, fed from outside - live data or the demo reel both
 * arrive here the same way, so what is shown in a demo is what people get.
 */
function Island({
  moments,
  ready,
  open,
  onOpenChange,
  hidden,
  onHiddenChange,
  onClear,
  onFollow,
}: IslandProps) {
  const [lead, setLead] = useState(0);
  const [resting, setResting] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  /*
   * Arrivals. Whatever joins the list after the first look pops the island
   * open on its own - the pill swells into a card, holds, and settles back -
   * and when several land together they wait their turn and pop one by one.
   *
   * Worked out while rendering, against the list last seen, rather than in
   * an effect: the queue is a consequence of the list changing, not a
   * separate event to synchronise.
   */
  const [seen, setSeen] = useState<{ signature: string; keys: string[] } | null>(null);
  const [queue, setQueue] = useState<Moment[]>([]);
  const signature = moments.map((moment) => moment.key).join("|");

  if (ready && seen?.signature !== signature) {
    // Open or put away, the list is either in front of them already or
    // deliberately out of sight - neither wants anything leaping out.
    const fresh =
      seen && !open && !hidden
        ? moments.filter((moment) => !seen.keys.includes(moment.key))
        : [];
    setSeen({ signature, keys: moments.map((moment) => moment.key) });
    if (fresh.length > 0) setQueue((current) => [...current, ...fresh]);
  }
  if ((open || hidden) && queue.length > 0) setQueue([]);

  const popping = queue[0] ?? null;

  const settle = () => {
    if (!popping) return;
    setQueue((current) => current.slice(1));
    // The pill comes back showing what just arrived, not wherever it was.
    const at = moments.findIndex((moment) => moment.key === popping.key);
    if (at >= 0) setLead(at);
  };

  // Taking turns: only while closed, only with more than one, and never
  // under the pointer - a line that changes as you read it is a line unread.
  const still = open || hidden || resting || popping !== null || moments.length < 2;
  useEffect(() => {
    if (still) return;
    const timer = setInterval(() => setLead((current) => current + 1), HOLD_MS);
    return () => clearInterval(timer);
  }, [still]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) onOpenChange(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onOpenChange]);

  const current = moments.length > 0 ? lead % moments.length : 0;
  const shown = moments[current] ?? null;
  const first = moments[0] ?? null;

  if (hidden) {
    // Put away, the island leaves only a hairline where it was - the way a
    // phone keeps its home bar - tinted by the most pressing thing waiting,
    // so a new escalation still shows through. Hover names it; a click
    // brings it back.
    return (
      <button
        type="button"
        onClick={() => onHiddenChange(false)}
        aria-label={
          moments.length > 0 ? `Show today · ${moments.length} waiting` : "Show today"
        }
        className="group/grab flex h-8 items-center gap-2 rounded-full px-3 transition-all duration-300 hover:bg-white hover:shadow-[0_1px_2px_rgba(15,23,42,0.05),0_8px_20px_-10px_rgba(15,23,42,0.2)] hover:ring-1 hover:ring-ink-900/[0.07]"
      >
        <span
          className={cn(
            "h-1.5 w-10 rounded-full transition-colors",
            first ? cn(KIND[first.kind].glow, "opacity-70") : "bg-ink-200 group-hover/grab:bg-ink-300",
          )}
        />
        <span className="max-w-0 overflow-hidden text-[11px] font-medium whitespace-nowrap text-ink-500 opacity-0 transition-all duration-300 group-hover/grab:max-w-32 group-hover/grab:opacity-100">
          Show today{moments.length > 0 ? ` · ${moments.length}` : ""}
        </span>
      </button>
    );
  }

  const date = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    // The pill's width, shared with the pop so it swells from exactly there.
    <div ref={root} className="relative [--pill-w:19rem] 2xl:[--pill-w:23rem]">
      {/* The capsule. */}
      <div
        onMouseEnter={() => setResting(true)}
        onMouseLeave={() => setResting(false)}
        className={cn(
          "group relative flex h-8 items-center overflow-hidden rounded-full",
          PEARL,
          "transition-[width,transform,box-shadow,opacity] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]",
          moments.length > 0 ? "w-(--pill-w) hover:scale-[1.015]" : "w-[12.75rem]",
          open && "scale-[1.015]",
          // The pop takes its place while it plays.
          popping && "opacity-0",
        )}
      >
        <button
          type="button"
          onClick={() => moments.length > 0 && onOpenChange(!open)}
          aria-expanded={open}
          aria-label={
            moments.length > 0
              ? `${moments.length} thing${moments.length === 1 ? "" : "s"} for today`
              : "Nothing needs you today"
          }
          className={cn(
            "relative flex h-full min-w-0 flex-1 items-center gap-2 pr-1 pl-1.5 text-left",
            moments.length > 0 ? "cursor-pointer" : "cursor-default",
          )}
        >
          {shown ? (
            <>
              <span className="relative grid size-5 shrink-0 place-items-center">
                {/* A slow breath of colour, kept for what is waiting on a
                    decision - everything else simply sits still. */}
                {KIND[shown.kind].rank <= 1 && (
                  <span
                    aria-hidden
                    className={cn(
                      "absolute inset-0 animate-island-breathe rounded-full",
                      KIND[shown.kind].ink,
                    )}
                  />
                )}
                <Glyph kind={shown.kind} />
              </span>

              <span key={shown.key + lead} className="min-w-0 flex-1 animate-island-line">
                <span className="block truncate text-[12px] leading-tight font-semibold tracking-[-0.01em] text-ink-900">
                  {shown.title}
                </span>
                <span className="block truncate text-[10.5px] leading-tight text-ink-500">
                  {shown.detail}
                </span>
              </span>

              {moments.length > 1 && (
                // The rest of the day, as a row of dots: which one you are
                // looking at, and that there are others behind it.
                <span className="flex shrink-0 items-center gap-1" aria-hidden>
                  {moments.slice(0, 5).map((moment, index) => (
                    <span
                      key={moment.key}
                      className={cn(
                        "h-1 rounded-full transition-all duration-500",
                        index === current ? "w-3 bg-ink-800" : "w-1 bg-ink-200",
                      )}
                    />
                  ))}
                  {moments.length > 5 && (
                    <span
                      className={cn(
                        "ml-0.5 text-[10px] font-semibold tabular-nums transition-colors",
                        current >= 5 ? "text-ink-800" : "text-ink-400",
                      )}
                    >
                      +{moments.length - 5}
                    </span>
                  )}
                </span>
              )}
            </>
          ) : (
            <>
              <span className="grid size-5 shrink-0 place-items-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100">
                <Check className="size-3" strokeWidth={2.75} />
              </span>
              <span className="truncate text-[11.5px] font-medium tracking-[-0.01em] text-ink-600">
                All clear for today
              </span>
            </>
          )}
        </button>

        {/* Put the island away. It leaves a hairline to bring it back by. */}
        <button
          type="button"
          onClick={() => {
            onOpenChange(false);
            onHiddenChange(true);
          }}
          aria-label="Hide today"
          title="Hide"
          className="relative mr-1 grid size-6 shrink-0 place-items-center rounded-full text-ink-300 transition-colors hover:bg-ink-100 hover:text-ink-600"
        >
          <X className="size-3" strokeWidth={2.5} />
        </button>
      </div>

      {/* The pop: the pill swelling into a card for one arrival. The card's
          contents are laid out at full size from the start and only
          revealed by the growing edge, so nothing reflows as it moves. */}
      {popping && (
        <div
          key={popping.key}
          role="status"
          aria-live="polite"
          onAnimationEnd={(event) => {
            if (event.target === event.currentTarget) settle();
          }}
          className={cn(
            "group/pop absolute top-0 left-1/2 z-40 -translate-x-1/2 animate-island-pop overflow-hidden hover:[animation-play-state:paused]",
            PEARL,
            "shadow-[0_2px_6px_rgba(15,23,42,0.05),0_22px_44px_-18px_rgba(15,23,42,0.35),inset_0_1px_0_#fff]",
          )}
        >
          <button
            type="button"
            onClick={() => {
              settle();
              onFollow(popping);
            }}
            className="absolute top-0 left-1/2 flex h-[4.5rem] w-[26rem] -translate-x-1/2 animate-island-pop-content items-center gap-3 px-4 text-left group-hover/pop:[animation-play-state:paused]"
          >
            <Glyph kind={popping.kind} size="lg" />
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2">
                <span
                  className={cn(
                    "text-[9.5px] leading-none font-semibold tracking-[0.09em] uppercase",
                    KIND[popping.kind].ink,
                  )}
                >
                  {KIND[popping.kind].label}
                </span>
                <span className="text-[10px] leading-none text-ink-400">now</span>
              </span>
              <span className="mt-1 block truncate text-[13.5px] leading-snug font-semibold tracking-[-0.015em] text-ink-900">
                {popping.title}
              </span>
              <span className="block truncate text-[11px] leading-snug text-ink-500">
                {popping.detail}
              </span>
            </span>
          </button>
        </div>
      )}

      {/* The day, unfolded from the pill. */}
      {open && moments.length > 0 && (
        <div
          role="dialog"
          aria-label="Today"
          className={cn(
            "absolute top-[calc(100%+8px)] left-1/2 z-50 w-[26rem] -translate-x-1/2 origin-top animate-island-open overflow-hidden rounded-[22px]",
            PEARL,
            "shadow-[0_2px_6px_rgba(15,23,42,0.04),0_28px_56px_-20px_rgba(15,23,42,0.3),inset_0_1px_0_#fff]",
          )}
        >
          <div className="flex items-end justify-between gap-3 px-4 pt-3.5 pb-2.5">
            <div className="min-w-0">
              <p className="text-[15px] leading-tight font-semibold tracking-[-0.02em] text-ink-900">
                Today
              </p>
              <p className="mt-0.5 text-[11px] text-ink-400">
                {date} · {moments.length} waiting
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                onClear(moments.map((moment) => moment.key));
                onOpenChange(false);
              }}
              className="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-900"
            >
              Clear all
            </button>
          </div>

          <ul className="max-h-[min(30rem,65vh)] space-y-0.5 overflow-y-auto px-1.5 pb-1.5">
            {moments.map((moment) => (
              <li key={moment.key} className="group/row relative">
                <button
                  type="button"
                  onClick={() => onFollow(moment)}
                  className="flex w-full items-center gap-3 rounded-2xl px-2.5 py-2 text-left transition-colors hover:bg-ink-900/[0.035]"
                >
                  <Glyph kind={moment.kind} size="md" />
                  <span className="min-w-0 flex-1 pr-7">
                    <span
                      className={cn(
                        "block text-[9.5px] leading-none font-semibold tracking-[0.09em] uppercase",
                        KIND[moment.kind].ink,
                      )}
                    >
                      {KIND[moment.kind].label}
                    </span>
                    <span className="mt-1 block truncate text-[12.5px] leading-snug font-semibold tracking-[-0.01em] text-ink-900">
                      {moment.title}
                    </span>
                    <span className="block truncate text-[11px] leading-snug text-ink-500">
                      {moment.detail}
                    </span>
                  </span>
                  <ArrowUpRight className="size-3.5 shrink-0 text-ink-300 transition-colors group-hover/row:text-ink-600" />
                </button>

                {/* Cleared from the view, not from the work: the ticket is
                    exactly as it was. */}
                <button
                  type="button"
                  onClick={() => onClear([moment.key])}
                  aria-label={`Clear “${moment.title}”`}
                  className="absolute top-1/2 right-9 grid size-6 -translate-y-1/2 place-items-center rounded-full text-ink-400 opacity-0 transition-opacity group-hover/row:opacity-100 hover:bg-ink-100 hover:text-ink-700 focus-visible:opacity-100"
                >
                  <X className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>

          <p className="border-t border-ink-900/[0.06] px-4 py-2 text-center text-[10.5px] text-ink-400">
            Clearing hides it for today. The ticket itself is unchanged.
          </p>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------- live */

function LiveIsland() {
  const router = useRouter();
  const { moments: all, ready } = useMoments();
  const [cleared, setCleared] = useState<string[]>(readCleared);
  const [hidden, setHidden] = useState(readHidden);
  const [open, setOpen] = useState(false);

  const moments = useMemo(
    () => all.filter((moment) => !cleared.includes(moment.key)),
    [all, cleared],
  );

  const clear = useCallback((keys: string[]) => {
    setCleared((current) => {
      const next = [...new Set([...current, ...keys])];
      writeCleared(next);
      return next;
    });
  }, []);

  return (
    <Island
      moments={moments}
      ready={ready}
      open={open}
      onOpenChange={setOpen}
      hidden={hidden}
      onHiddenChange={(next) => {
        setHidden(next);
        writeHidden(next);
      }}
      onClear={clear}
      onFollow={(moment) => {
        setOpen(false);
        router.push(moment.href as "/");
      }}
    />
  );
}

/* ------------------------------------------------------------------- demo */

/**
 * Sample moments for showing the island off - one of every kind, worded the
 * way the live ones are.
 */
const SAMPLE = {
  escalation: {
    key: "escalation:demo",
    kind: "escalation",
    title: "2 escalations need you",
    detail: "TK-0418 · Server room cooling failure",
    href: "#",
  },
  approval: {
    key: "approval:demo",
    kind: "approval",
    title: "Approve TK-0392",
    detail: "New laptop for Finance · closes itself in 18h",
    href: "#",
  },
  handover: {
    key: "handover:demo",
    kind: "handover",
    title: "TK-0405 is being handed to you",
    detail: "Payroll correction for March",
    href: "#",
  },
  overdue: {
    key: "overdue:demo",
    kind: "overdue",
    title: "TK-0377 is overdue",
    detail: "Replace the badge reader at Gate 2",
    href: "#",
  },
  due: {
    key: "due:demo",
    kind: "due",
    title: "TK-0411 is due today",
    detail: "Quarterly insurance claims upload",
    href: "#",
  },
  assigned: {
    key: "assigned:demo",
    kind: "assigned",
    title: "TK-0420 assigned to you",
    detail: "VPN access for the audit team",
    href: "#",
  },
  transferred: {
    key: "assigned:demo-transfer",
    kind: "assigned",
    title: "TK-0423 transferred to you",
    detail: "Moved from Operations · Printer on floor 3 offline",
    href: "#",
  },
} satisfies Record<string, Moment>;

const EVERYTHING: Moment[] = [
  SAMPLE.escalation,
  SAMPLE.approval,
  SAMPLE.handover,
  SAMPLE.overdue,
  SAMPLE.due,
  SAMPLE.assigned,
  SAMPLE.transferred,
];

type Scene = {
  name: string;
  note: string;
  moments: Moment[];
  open?: boolean;
  hidden?: boolean;
  ms: number;
};

/**
 * One arrival per step, each landing on top of the ones before - so every
 * kind gets its own pop, and the pill fills up the way a real day does.
 */
const ARRIVALS: [name: string, note: string][] = [
  ["Escalation arrives", "Super admin only: something was escalated to you."],
  ["Approval request arrives", "Your ticket was finished and waits for your sign-off."],
  ["Handover request arrives", "A colleague is asking you to take a ticket over."],
  ["Overdue arrives", "A ticket on your desk has slipped past its deadline."],
  ["Due today arrives", "A ticket on your desk is due before the day ends."],
  ["Assignment arrives", "Somebody put a ticket on your desk."],
  ["Transfer arrives", "A ticket was moved into your department."],
];

/** The reel, in the order a person would meet each state. */
const SCENES: Scene[] = [
  {
    name: "All clear",
    note: "Nothing waits on you today, so the island rests quietly.",
    moments: [],
    ms: 3600,
  },
  ...ARRIVALS.map(([name, note], index) => ({
    name,
    note,
    moments: EVERYTHING.slice(0, index + 1),
    ms: 4400,
  })),
  {
    name: "Taking turns",
    note: "Most pressing first; each takes the stage in turn. Hover to hold one.",
    moments: EVERYTHING,
    ms: 13_500,
  },
  {
    name: "Opened",
    note: "Click the pill for the whole day. Follow one, clear one, or clear all.",
    moments: EVERYTHING,
    open: true,
    ms: 7000,
  },
  {
    name: "Put away",
    note: "The × tucks it into a hairline, tinted by what is most pressing.",
    moments: EVERYTHING,
    hidden: true,
    ms: 5000,
  },
];

type DemoView = {
  index: number;
  cleared: string[];
  open: boolean;
  hidden: boolean;
};

function enter(index: number): DemoView {
  const at = (index + SCENES.length) % SCENES.length;
  return {
    index: at,
    cleared: [],
    open: SCENES[at].open ?? false,
    hidden: SCENES[at].hidden ?? false,
  };
}

/**
 * The island playing through every state it has, one after another, with a
 * small control bar at the foot of the screen. Everything stays live to the
 * touch - open it, clear things - and touching it pauses the reel so a
 * presenter can talk over a state for as long as they like.
 */
function DemoIsland({ onExit }: { onExit: () => void }) {
  const [view, setView] = useState<DemoView>(() => enter(0));
  const [playing, setPlaying] = useState(true);
  const scene = SCENES[view.index];

  useEffect(() => {
    if (!playing) return;
    const timer = setTimeout(() => setView((current) => enter(current.index + 1)), scene.ms);
    return () => clearTimeout(timer);
  }, [playing, view.index, scene.ms]);

  const moments = scene.moments.filter((moment) => !view.cleared.includes(moment.key));
  const setOpen = useCallback(
    (open: boolean) => setView((current) => ({ ...current, open })),
    [],
  );

  const control =
    "grid size-7 place-items-center rounded-full text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-900";

  return (
    <>
      <div onPointerDown={() => setPlaying(false)}>
        <Island
          moments={moments}
          ready
          open={view.open}
          onOpenChange={setOpen}
          hidden={view.hidden}
          onHiddenChange={(hidden) => setView((current) => ({ ...current, hidden }))}
          onClear={(keys) =>
            setView((current) => ({ ...current, cleared: [...current.cleared, ...keys] }))
          }
          onFollow={() => setOpen(false)}
        />
      </div>

      {/* Portalled: the island sits in a translated box, which would make a
          fixed bar position itself against the island instead of the screen. */}
      {createPortal(
        <div
          className={cn(
            "fixed bottom-5 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-3 overflow-hidden rounded-full py-1.5 pr-1.5 pl-4",
            PEARL,
          )}
        >
          <span className="text-[9.5px] font-semibold tracking-[0.12em] text-brand-600 uppercase">
            Demo
          </span>
          <span className="text-[11px] text-ink-400 tabular-nums">
            {view.index + 1} / {SCENES.length}
          </span>
          <span key={view.index} className="w-72 min-w-0 animate-island-line">
            <span className="block truncate text-[12px] leading-tight font-semibold text-ink-900">
              {scene.name}
            </span>
            <span className="block truncate text-[10.5px] leading-tight text-ink-500">
              {scene.note}
            </span>
          </span>

          <span className="flex items-center">
            <button
              type="button"
              onClick={() => setView((current) => enter(current.index - 1))}
              aria-label="Previous state"
              className={control}
            >
              <ChevronLeft className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => setPlaying((current) => !current)}
              aria-label={playing ? "Pause" : "Play"}
              className={control}
            >
              {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
            </button>
            <button
              type="button"
              onClick={() => setView((current) => enter(current.index + 1))}
              aria-label="Next state"
              className={control}
            >
              <ChevronRight className="size-4" />
            </button>
            <span className="mx-1 h-4 w-px bg-ink-200" />
            <button type="button" onClick={onExit} aria-label="Exit demo" className={control}>
              <X className="size-3.5" />
            </button>
          </span>

          {/* How long this state has left, as a hairline along the bottom. */}
          {playing && (
            <span
              key={`progress-${view.index}`}
              aria-hidden
              className="absolute bottom-0 left-0 h-[2px] animate-island-progress bg-brand-500/60"
              style={{ animationDuration: `${scene.ms}ms` }}
            />
          )}
        </div>,
        document.body,
      )}
    </>
  );
}

/* ------------------------------------------------------------------ entry */

/** `?island=demo` on any page plays the reel instead of the live island. */
function readDemo() {
  try {
    return new URLSearchParams(window.location.search).get("island") === "demo";
  } catch {
    return false;
  }
}

/**
 * The middle of the top bar, put to work: what wants you today, in one
 * pearl capsule - the way a phone uses the space around its camera.
 *
 * Collapsed, it leads with the most pressing moment and, when there are more,
 * lets each take the stage in turn. Opened, it unfolds into the whole list for
 * the day, where each can be followed or cleared. The × puts it away; the
 * hairline left behind brings it back.
 */
export function TodayIsland() {
  const [demo, setDemo] = useState(readDemo);

  if (!demo) return <LiveIsland />;

  return (
    <DemoIsland
      onExit={() => {
        setDemo(false);
        const url = new URL(window.location.href);
        url.searchParams.delete("island");
        window.history.replaceState(null, "", url);
      }}
    />
  );
}
