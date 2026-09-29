"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, ShieldCheck, X } from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { useNotifications } from "@/components/notifications/notification-provider";
import { listApprovals, openTicketHere, type TicketRecord } from "@/lib/tickets";

/** Fired after an approval is answered here, so the banner updates at once. */
export const APPROVALS_CHANGED = "flowdesk:approvals-changed";

/** Tells the banner to look again. Called by whatever just answered one. */
export const approvalsChanged = () => window.dispatchEvent(new Event(APPROVALS_CHANGED));

/** How often to look again when nothing has told it to. */
const EVERY_MS = 60_000;

/** "31 h", "40 min", "any minute": how long before it completes on its own. */
export function timeLeft(until: string | null) {
  if (!until) return "";
  const ms = Date.parse(until) - Date.now();
  if (ms <= 60_000) return "any minute";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.round(minutes / 60)} h`;
}

/**
 * The one thing on every page that says "somebody is waiting on you".
 *
 * A request the department has finished sits as Resolved until the person who
 * asked approves it, and a bell is easy to leave unread. So for as long as any
 * of their requests is waiting, a strip under the top bar says so on every
 * page, with the clock that runs out on it - and it only goes away when they
 * answer, not when they glance at it.
 */
export function ApprovalBanner() {
  const { session } = useAuth();
  const { items } = useNotifications();
  const [pending, setPending] = useState<TicketRecord[]>([]);
  const alive = useRef(true);

  /**
   * Which set of waiting requests was put away, if any.
   *
   * Held in memory and nowhere else, so a reload brings the strip back: it is
   * a reminder that somebody is waiting, and one that could be switched off
   * for good would stop reminding. Keyed on the requests themselves, so a new
   * one arriving shows it again even before a reload - that is news, not the
   * thing that was dismissed.
   */
  const [dismissed, setDismissed] = useState<string | null>(null);

  // A new sign-off request in the feed is the moment to look again, rather
  // than waiting out the minute.
  const asked = items
    .filter((item) => item.type === "ticket.approval")
    .map((item) => item.id)
    .join(",");

  const meId = session?.id;

  useEffect(() => {
    alive.current = true;
    if (!meId) return;

    const load = () =>
      listApprovals()
        .then((tickets) => {
          if (alive.current) setPending(tickets);
        })
        .catch(() => {
          // A failed look leaves whatever was last known; the next one tries again.
        });

    void load();
    const timer = setInterval(load, EVERY_MS);
    window.addEventListener(APPROVALS_CHANGED, load);

    return () => {
      alive.current = false;
      clearInterval(timer);
      window.removeEventListener(APPROVALS_CHANGED, load);
    };
  }, [meId, asked]);

  const key = pending.map((ticket) => ticket.id).join(",");

  if (!meId || pending.length === 0 || dismissed === key) return null;

  const one = pending.length === 1 ? pending[0] : null;
  // Sorted by the API: the first one is the next to complete on its own.
  const soonest = pending[0];
  const href = one ? `/my-requests?ticket=${one.id}&open=1` : "/my-requests?view=approval";

  return (
    <div
      role="status"
      className="sticky top-11 z-20 flex items-center border-b border-status-resolved-strong/30 bg-gradient-to-r from-status-resolved-strong via-sky-500 to-status-resolved-strong text-white shadow-sm shadow-status-resolved-strong/20"
    >
      <Link
        href={href as "/"}
        // Already on My Requests: the page is not navigated again, so it is
        // asked to open the sheet directly rather than left to read a URL it
        // has already read.
        onClick={(event) => {
          if (!one || window.location.pathname !== "/my-requests") return;
          event.preventDefault();
          openTicketHere(one.id);
        }}
        className="group flex min-w-0 flex-1 items-center gap-2.5 py-1.5 pl-3 sm:pl-4"
      >
        {/* A beacon rather than a badge: the strip is meant to be seen from
            across the page, and a still dot on a blue bar is not. */}
        <span className="relative flex size-2.5 shrink-0">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-white/80" />
          <span className="relative inline-flex size-2.5 rounded-full bg-white" />
        </span>
        <ShieldCheck className="size-4 shrink-0" />

        <p className="min-w-0 truncate text-[12.5px] leading-tight font-semibold">
          {one ? (
            <>
              <span className="font-bold">{one.number}</span> is resolved - please approve it
              <span className="ml-2 hidden font-normal text-white/85 sm:inline">
                “{one.subject}” · done by {one.resolvedByName || "the department"}
              </span>
            </>
          ) : (
            <>
              <span className="font-bold">{pending.length} requests</span> are resolved and
              waiting for your approval
              <span className="ml-2 hidden font-normal text-white/85 sm:inline">
                {pending
                  .slice(0, 3)
                  .map((ticket) => ticket.number)
                  .join(" · ")}
                {pending.length > 3 ? ` +${pending.length - 3}` : ""}
              </span>
            </>
          )}
        </p>

        <span className="ml-auto hidden shrink-0 text-[11px] text-white/85 md:inline">
          {one ? "Completes on its own in " : "Next completes on its own in "}
          <span className="font-bold text-white">{timeLeft(soonest.approvalDueAt)}</span>
        </span>

        <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-white px-2.5 py-1 text-[12px] font-bold text-status-resolved-fg shadow-sm transition-colors group-hover:bg-white/90">
          Review{one ? "" : ` ${pending.length}`}
          <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
        </span>
      </Link>

      {/* Beside the link rather than inside it: a button inside a link is a
          click that means two things at once. */}
      <button
        type="button"
        onClick={() => setDismissed(key)}
        aria-label="Hide this reminder until the page is reloaded"
        title="Hide until you reload"
        className="mx-2 grid size-6 shrink-0 place-items-center rounded-md text-white/80 transition-colors hover:bg-white/15 hover:text-white sm:mr-3"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
