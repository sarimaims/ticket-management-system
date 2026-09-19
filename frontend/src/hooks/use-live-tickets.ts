"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { errorMessage } from "@/lib/api";
import { revalidateTickets, type TicketRecord } from "@/lib/tickets";

/** How long a run of failures is allowed to stretch the interval. */
const MAX_BACKOFF = 8;

/** One blip is not worth a red banner; two in a row is. */
const FAILURES_BEFORE_ERROR = 2;

/**
 * Folds a fresh list into the one on screen while changing as little as
 * possible.
 *
 * Rows that did not move keep their old object, so a memoised row skips
 * rendering entirely; if nothing at all moved the previous array is returned
 * unchanged and React bails out of the update. A row that is older than the
 * one held locally is dropped - that is a poll that was already in the air
 * when we wrote, and it must not resurrect the old value.
 */
function reconcile(previous: TicketRecord[], next: TicketRecord[]) {
  const byId = new Map(previous.map((ticket) => [ticket.id, ticket]));
  let identical = previous.length === next.length;

  const merged = next.map((incoming, index) => {
    const held = byId.get(incoming.id);
    const keep =
      held && Date.parse(held.updatedAt) >= Date.parse(incoming.updatedAt) ? held : incoming;

    if (identical && previous[index] !== keep) identical = false;
    return keep;
  });

  return identical ? previous : merged;
}

type Options = {
  scope: "mine" | "assigned";
  /** Milliseconds between polls, or null to load once and stop. */
  intervalMs?: number | null;
};

/**
 * The ticket list, kept current by a conditional poll.
 *
 * Every request carries the tag from the last answer, so an unchanged queue
 * costs a 304 with no body and touches no state. The loop sleeps while the
 * tab is hidden or the browser is offline, never lets two requests overlap,
 * and backs off when the API is failing.
 */
export function useLiveTickets({ scope, intervalMs = null }: Options) {
  const [tickets, setTickets] = useState<TicketRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [syncedAt, setSyncedAt] = useState<number | null>(null);

  const etag = useRef<string | null>(null);
  const inFlight = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failures = useRef(0);
  const holds = useRef(0);
  const alive = useRef(true);
  /** Whether a list has ever arrived - until it has, any failure is worth showing. */
  const seeded = useRef(false);

  /**
   * Pauses the poll for the length of a write. Returns the release, so callers
   * can put it in a `finally` and never leave the loop stopped.
   */
  const hold = useCallback(() => {
    holds.current += 1;
    let released = false;

    return () => {
      if (released) return;
      released = true;
      holds.current = Math.max(0, holds.current - 1);
    };
  }, []);

  const fetchNow = useCallback(async () => {
    // One request at a time: a slow answer must not let the next tick stack on
    // top of it.
    if (inFlight.current) return;

    const controller = new AbortController();
    inFlight.current = controller;

    try {
      const result = await revalidateTickets(scope, etag.current, controller.signal);
      if (!alive.current) return;

      etag.current = result.etag;
      failures.current = 0;
      seeded.current = true;

      // A 304 means the queue has not moved, so nothing here is called and the
      // table does not re-render.
      if (result.changed) {
        setTickets((current) => reconcile(current, result.data.tickets));
        setSyncedAt(Date.now());
      }

      // Functional, so an already-empty error is the same value and React
      // skips the render.
      setError((current) => (current ? "" : current));
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      if (!alive.current) return;

      failures.current += 1;
      // Mid-poll blips stay quiet; a first load that never arrived does not.
      if (failures.current >= FAILURES_BEFORE_ERROR || !seeded.current) {
        setError(errorMessage(caught));
      }
    } finally {
      if (inFlight.current === controller) inFlight.current = null;
      if (alive.current) setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    alive.current = true;
    etag.current = null;
    seeded.current = false;
    let stopped = false;

    const clear = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };

    const step = async (force = false) => {
      if (stopped) return;

      const idle =
        document.visibilityState === "hidden" ||
        navigator.onLine === false ||
        holds.current > 0;

      if (force || !idle) await fetchNow();
      if (stopped || intervalMs === null) return;

      clear();
      // A failing API is backed off rather than hammered on every tick.
      const factor = Math.min(2 ** failures.current, MAX_BACKOFF);
      timer.current = setTimeout(() => void step(), intervalMs * factor);
    };

    // The first load always runs, even if the tab opened in the background.
    void step(true);

    const wake = () => {
      if (document.visibilityState === "visible") void step(true);
    };

    if (intervalMs !== null) {
      document.addEventListener("visibilitychange", wake);
      window.addEventListener("online", wake);
    }

    return () => {
      stopped = true;
      alive.current = false;
      clear();
      inFlight.current?.abort();
      inFlight.current = null;

      if (intervalMs !== null) {
        document.removeEventListener("visibilitychange", wake);
        window.removeEventListener("online", wake);
      }
    };
  }, [fetchNow, intervalMs]);

  const refresh = useCallback(() => {
    void fetchNow();
  }, [fetchNow]);

  return { tickets, setTickets, loading, error, syncedAt, hold, refresh };
}
