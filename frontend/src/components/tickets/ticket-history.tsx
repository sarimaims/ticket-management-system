"use client";

import { useEffect, useState } from "react";
import { AlertCircle, ArrowRight, History } from "lucide-react";

import { OriginTag } from "@/components/ui/badge";
import { errorMessage } from "@/lib/api";
import { listHistory, type AssignmentRecord, type TicketEvent } from "@/lib/assignments";
import type { TicketRecord } from "@/lib/tickets";
import { cn, formatDateOf, formatTime } from "@/lib/utils";

/** The people on one side of a move, or "Nobody" when there are none. */
const names = (people: { name?: string }[]) =>
  people.length === 0 ? "Nobody" : people.map((person) => person.name ?? "Someone").join(", ");

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
  | ({ at: string; sort: number } & { type: "handover"; entry: AssignmentRecord })
  | ({ at: string; sort: number } & { type: "event"; entry: TicketEvent });

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
        ];
        setTrail(moments.sort((a, b) => a.sort - b.sort));
      })
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
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

      {trail === null && (
        <p className="py-8 text-center text-sm text-ink-400">Loading the history...</p>
      )}

      {trail?.length === 0 && !error && (
        <div className="py-10 text-center">
          <History className="mx-auto size-6 text-ink-300" />
          <p className="mt-2 text-sm font-semibold text-ink-700">Nothing recorded yet</p>
          <p className="mt-0.5 text-sm text-ink-400">
            This ticket was raised before the trail was kept. Every handover from now on is
            listed here.
          </p>
        </div>
      )}

      {trail && trail.length > 0 && (
        <ol className="mt-4">
          {trail.map((moment, index) => {
            const last = index === trail.length - 1;
            const opening = moment.type === "handover" && moment.entry.kind === "raised";
            const by =
              moment.type === "handover" ? moment.entry.by : { ...moment.entry.by, id: null };

            return (
              <li key={`${moment.type}-${moment.entry.id}`} className="flex gap-3">
                {/* The dot marks the moment; the line carries the eye to the
                    next one, and stops at the last. */}
                <span className="flex flex-col items-center">
                  <span
                    className={cn(
                      "mt-1.5 size-2.5 shrink-0 rounded-full",
                      opening ? "bg-brand-600" : "bg-ink-300",
                    )}
                  />
                  {!last && <span className="w-px flex-1 bg-line" />}
                </span>

                <div className={cn("min-w-0 flex-1", last ? "pb-1" : "pb-5")}>
                  <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-ink-900">
                    {moment.type === "handover" ? (
                      opening ? (
                        <>
                          <span className="rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-brand-700 uppercase">
                            Raised
                          </span>
                          {names(moment.entry.to)}
                        </>
                      ) : (
                        <>
                          <span className="text-ink-500">{names(moment.entry.from)}</span>
                          <ArrowRight className="size-3.5 shrink-0 text-ink-300" />
                          {names(moment.entry.to)}
                        </>
                      )
                    ) : (
                      <>
                        <span
                          className={cn(
                            "rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide uppercase",
                            moment.entry.event === "raised"
                              ? "bg-brand-50 text-brand-700"
                              : "bg-status-waiting-bg text-status-waiting-fg",
                          )}
                        >
                          {moment.entry.event === "raised" ? "Raised" : "Edited"}
                        </span>
                        <span className="font-medium text-ink-700">{moment.entry.body}</span>
                      </>
                    )}
                  </p>

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
