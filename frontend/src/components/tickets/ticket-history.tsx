"use client";

import { useEffect, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  CalendarCheck,
  CalendarClock,
  History,
} from "lucide-react";

import { OriginTag } from "@/components/ui/badge";
import { errorMessage } from "@/lib/api";
import {
  listHistory,
  type AssignmentRecord,
  type CommitmentRecord,
  type TicketEvent,
} from "@/lib/assignments";
import type { TicketRecord } from "@/lib/tickets";
import { cn, formatDateOf, formatTime } from "@/lib/utils";

/** The people on one side of a move, or "Nobody" when there are none. */
const names = (people: { name?: string }[]) =>
  people.length === 0
    ? "Nobody"
    : people.map((person) => person.name ?? "Someone").join(", ");

/**
 * Who has held this ticket, oldest first.
 *
 * Written only by raising a ticket and by handing it over, never posted to, so
 * it is a record rather than a notes field. Names are the people's at the time
 * of each handover, which is why a rename does not rewrite the past.
 */
/**
 * One moment in the ticket's life, whichever record it came from.
 *
 * A handover carries who it moved between, so it keeps its own shape; an edit
 * carries the line describing it. Merged and sorted, they read as one story
 * rather than two tabs.
 */
type Moment =
  | ({ at: string; sort: number } & {
      type: "handover";
      entry: AssignmentRecord;
    })
  | ({ at: string; sort: number } & { type: "event"; entry: TicketEvent })
  | ({ at: string; sort: number } & {
      type: "promise";
      entry: CommitmentRecord;
    });

/** How each kind of promise announces itself, and in what colour. */
const PROMISE_META: Record<
  CommitmentRecord["kind"],
  { label: string; dot: string; chip: string; icon: typeof CalendarCheck }
> = {
  promised: {
    label: "Promised",
    dot: "bg-status-completed-fg",
    chip: "bg-status-completed-bg text-status-completed-fg",
    icon: CalendarCheck,
  },
  extended: {
    label: "Extended",
    dot: "bg-status-waiting-fg",
    chip: "bg-status-waiting-bg text-status-waiting-fg",
    icon: CalendarClock,
  },
  "pulled-in": {
    label: "Brought forward",
    dot: "bg-status-progress-fg",
    chip: "bg-status-progress-bg text-status-progress-fg",
    icon: CalendarClock,
  },
  withdrawn: {
    label: "Withdrawn",
    dot: "bg-status-overdue-fg",
    chip: "bg-status-overdue-bg text-status-overdue-fg",
    icon: CalendarClock,
  },
};

/**
 * What each kind of event calls itself in the trail.
 *
 * A correction to the request and a correction to something said about it are
 * different things, and a trail that called both "Edited" would make the
 * second look like the first.
 */
const EVENT_META: Record<string, { label: string; chip: string }> = {
  raised: { label: "Raised", chip: "bg-brand-50 text-brand-700" },
  edited: {
    label: "Edited",
    chip: "bg-status-waiting-bg text-status-waiting-fg",
  },
  "message.edited": {
    label: "Message edited",
    chip: "bg-chat-accent-soft text-chat-accent-strong",
  },
  "message.deleted": {
    label: "Message withdrawn",
    chip: "bg-ink-100 text-ink-600",
  },
};

/** "4 days later", which is the thing being asked when a date moves. */
function distance(from: string, to: string) {
  const days = Math.round(
    (Date.parse(to.slice(0, 10)) - Date.parse(from.slice(0, 10))) / 86_400_000,
  );
  if (days === 0) return null;
  const count = Math.abs(days);
  return `${count} day${count === 1 ? "" : "s"} ${days > 0 ? "later" : "earlier"}`;
}

export function TicketHistory({ ticket }: { ticket: TicketRecord }) {
  const [trail, setTrail] = useState<Moment[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    listHistory(ticket.id, controller.signal)
      .then((data) => {
        const moments: Moment[] = [
          ...data.assignments.map((entry) => ({
            type: "handover" as const,
            entry,
            at: entry.createdAt,
            sort: Date.parse(entry.createdAt),
          })),
          ...data.events.map((entry) => ({
            type: "event" as const,
            entry,
            at: entry.createdAt,
            sort: Date.parse(entry.createdAt),
          })),
          ...(data.commitments ?? []).map((entry) => ({
            type: "promise" as const,
            entry,
            at: entry.createdAt,
            sort: Date.parse(entry.createdAt),
          })),
        ];
        setTrail(moments.sort((a, b) => a.sort - b.sort));
      })
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === "AbortError")
          return;
        setTrail([]);
        setError(errorMessage(caught));
      });

    return () => controller.abort();
  }, [ticket.id, ticket.updatedAt]);

  return (
    <div className="flex-1 overflow-y-auto px-3 py-2.5">
      <p className="flex items-center justify-between gap-3 rounded-md bg-ink-50 px-2.5 py-1.5">
        <span className="text-xs font-semibold tracking-wide text-ink-400 uppercase">
          Sitting with
        </span>
        <span className="truncate text-sm font-bold text-ink-900">
          {ticket.assignees.length > 0 ? (
            names(ticket.assignees)
          ) : (
            <span className="font-normal text-ink-400">Nobody yet</span>
          )}
        </span>
      </p>

      {error && (
        <p
          role="alert"
          className="mt-3 flex items-start gap-2 rounded-field bg-brand-50 px-3 py-2 text-xs font-medium text-brand-700"
        >
          <AlertCircle className="mt-px size-4 shrink-0" />
          {error}
        </p>
      )}

      {/* The same shape the trail is about to take, so the pane does not
          jump when it lands. */}
      {trail === null && (
        <ul aria-hidden="true" className="space-y-3">
          {[0, 1, 2].map((row) => (
            <li key={row} className="flex items-start gap-2.5">
              <span
                style={{ animationDelay: `${row * 120}ms` }}
                className="mt-0.5 size-6 shrink-0 animate-pulse rounded-full bg-ink-100"
              />
              <span className="min-w-0 flex-1 space-y-1.5">
                <span
                  style={{ animationDelay: `${row * 120}ms` }}
                  className="block h-3 w-3/5 animate-pulse rounded bg-ink-100"
                />
                <span
                  style={{ animationDelay: `${row * 120 + 60}ms` }}
                  className="block h-2.5 w-2/5 animate-pulse rounded bg-ink-100"
                />
              </span>
            </li>
          ))}
        </ul>
      )}

      {trail?.length === 0 && !error && (
        <div className="py-10 text-center">
          <History className="mx-auto size-6 text-ink-300" />
          <p className="mt-2 text-sm font-semibold text-ink-700">
            Nothing recorded yet
          </p>
          <p className="mt-0.5 text-sm text-ink-400">
            This ticket was raised before the trail was kept. Every handover,
            and every date promised for it, is listed here from now on.
          </p>
        </div>
      )}

      {trail && trail.length > 0 && (
        <ol className="mt-4">
          {trail.map((moment, index) => {
            const last = index === trail.length - 1;
            const opening =
              moment.type === "handover" && moment.entry.kind === "raised";
            const by =
              moment.type === "handover"
                ? moment.entry.by
                : { ...moment.entry.by, id: null };

            return (
              <li
                key={`${moment.type}-${moment.entry.id}`}
                className="flex gap-3"
              >
                {/* The dot marks the moment; the line carries the eye to the
                    next one, and stops at the last. */}
                <span className="flex flex-col items-center">
                  <span
                    className={cn(
                      "mt-1.5 size-2.5 shrink-0 rounded-full",
                      moment.type === "promise"
                        ? PROMISE_META[moment.entry.kind].dot
                        : opening
                          ? "bg-brand-600"
                          : "bg-ink-300",
                    )}
                  />
                  {!last && <span className="w-px flex-1 bg-line" />}
                </span>

                <div className={cn("min-w-0 flex-1", last ? "pb-1" : "pb-5")}>
                  <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-ink-900">
                    {moment.type === "promise" ? (
                      (() => {
                        const meta = PROMISE_META[moment.entry.kind];
                        const Icon = meta.icon;
                        const moved =
                          moment.entry.previousDate && moment.entry.date
                            ? distance(
                                moment.entry.previousDate,
                                moment.entry.date,
                              )
                            : null;

                        return (
                          <>
                            <span
                              className={cn(
                                "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide uppercase",
                                meta.chip,
                              )}
                            >
                              <Icon className="size-3" />
                              {meta.label}
                            </span>

                            {/* The move itself: what was promised, what it
                                became, and how much later that is. */}
                            {moment.entry.previousDate && (
                              <>
                                <span className="text-ink-400 line-through">
                                  {formatDateOf(moment.entry.previousDate)}
                                </span>
                                <ArrowRight className="size-3.5 shrink-0 text-ink-300" />
                              </>
                            )}
                            <span>
                              {moment.entry.date
                                ? formatDateOf(moment.entry.date)
                                : "no date"}
                            </span>
                            {moved && (
                              <span className="text-xs font-medium text-ink-400">
                                ({moved})
                              </span>
                            )}
                          </>
                        );
                      })()
                    ) : moment.type === "handover" ? (
                      opening ? (
                        <>
                          <span className="rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-brand-700 uppercase">
                            Raised
                          </span>
                          {names(moment.entry.to)}
                        </>
                      ) : (
                        <>
                          <span className="text-ink-500">
                            {names(moment.entry.from)}
                          </span>
                          <ArrowRight className="size-3.5 shrink-0 text-ink-300" />
                          {names(moment.entry.to)}
                        </>
                      )
                    ) : (
                      <>
                        <span
                          className={cn(
                            "rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide uppercase",
                            (
                              EVENT_META[moment.entry.event ?? "edited"] ??
                              EVENT_META.edited
                            ).chip,
                          )}
                        >
                          {
                            (
                              EVENT_META[moment.entry.event ?? "edited"] ??
                              EVENT_META.edited
                            ).label
                          }
                        </span>
                        <span className="font-medium text-ink-700">
                          {moment.entry.body}
                        </span>
                      </>
                    )}
                  </p>

                  {moment.type === "promise" && (
                    <p className="mt-1 rounded-md border-l-2 border-line-strong bg-ink-50 px-2 py-1.5 text-[13px] leading-snug text-ink-700">
                      {moment.entry.reason}
                    </p>
                  )}

                  <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-500">
                    by {by.name}
                    <OriginTag role={by.role} />
                    <span className="text-ink-400">
                      · {formatDateOf(moment.at)} {formatTime(moment.at)}
                    </span>
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
