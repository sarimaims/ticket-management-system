"use client";

import { useEffect, useState } from "react";
import { AlertCircle, ArrowRight, History } from "lucide-react";

import { OriginTag } from "@/components/ui/badge";
import { errorMessage } from "@/lib/api";
import { listAssignments, type AssignmentRecord } from "@/lib/assignments";
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
export function TicketHistory({ ticket }: { ticket: TicketRecord }) {
  const [trail, setTrail] = useState<AssignmentRecord[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    listAssignments(ticket.id, controller.signal)
      .then(setTrail)
      .catch((caught) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setTrail([]);
        setError(errorMessage(caught));
      });

    return () => controller.abort();
  }, [ticket.id]);

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
          {trail.map((entry, index) => {
            const last = index === trail.length - 1;

            return (
              <li key={entry.id} className="flex gap-3">
                {/* The dot marks the moment; the line carries the eye to the
                    next one, and stops at the last. */}
                <span className="flex flex-col items-center">
                  <span
                    className={cn(
                      "mt-1.5 size-2.5 shrink-0 rounded-full",
                      entry.kind === "raised" ? "bg-brand-600" : "bg-ink-300",
                    )}
                  />
                  {!last && <span className="w-px flex-1 bg-line" />}
                </span>

                <div className={cn("min-w-0 flex-1", last ? "pb-1" : "pb-5")}>
                  <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-ink-900">
                    {entry.kind === "raised" ? (
                      <>
                        <span className="rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-brand-700 uppercase">
                          Raised
                        </span>
                        {names(entry.to)}
                      </>
                    ) : (
                      <>
                        <span className="text-ink-500">{names(entry.from)}</span>
                        <ArrowRight className="size-3.5 shrink-0 text-ink-300" />
                        {names(entry.to)}
                      </>
                    )}
                  </p>

                  <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-500">
                    by {entry.by.name}
                    <OriginTag role={entry.by.role} />
                    <span className="text-ink-400">
                      · {formatDateOf(entry.createdAt)} {formatTime(entry.createdAt)}
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
