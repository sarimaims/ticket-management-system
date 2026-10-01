"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { errorMessage } from "@/lib/api";
import { revalidateDashboard, type DashboardData } from "@/lib/tickets";

/** How long a run of failures is allowed to stretch the interval. */
const MAX_BACKOFF = 8;

/** One blip is not worth a red banner; two in a row is. */
const FAILURES_BEFORE_ERROR = 2;

/**
 * The dashboard, kept current by a conditional poll - the same loop as the
 * ticket lists, for the one call the dashboard makes.
 *
 * An unchanged page costs a 304 and no render. The loop sleeps while the tab
 * is hidden or offline, never overlaps itself, and backs off while the API is
 * failing.
 */
export function useLiveDashboard(intervalMs = 20_000) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [syncedAt, setSyncedAt] = useState<number | null>(null);

  const etag = useRef<string | null>(null);
  const inFlight = useRef<AbortController | null>(null);
  const failures = useRef(0);
  const alive = useRef(true);
  const seeded = useRef(false);

  const fetchNow = useCallback(async (force = false) => {
    if (inFlight.current) return;

    const controller = new AbortController();
    inFlight.current = controller;
    // The spinner is for a load somebody is waiting on, not the quiet poll.
    if (force || !seeded.current) setLoading(true);

    try {
      // A forced refresh asks for the whole page, whatever the tag says - the
      // button is pressed because something is believed to have moved.
      const result = await revalidateDashboard(force ? null : etag.current, controller.signal);
      if (!alive.current) return;

      etag.current = result.etag;
      failures.current = 0;
      seeded.current = true;

      // A 304 leaves the page as it is; either way it is now known current.
      if (result.changed) setData(result.data);
      setSyncedAt(Date.now());
      setError((current) => (current ? "" : current));
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      if (!alive.current) return;

      failures.current += 1;
      if (failures.current >= FAILURES_BEFORE_ERROR || !seeded.current) {
        setError(errorMessage(caught));
      }
    } finally {
      if (inFlight.current === controller) inFlight.current = null;
      if (alive.current && !controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    etag.current = null;
    seeded.current = false;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const step = async (first = false) => {
      if (stopped) return;
      const idle = document.visibilityState === "hidden" || navigator.onLine === false;
      if (first || !idle) await fetchNow();
      if (stopped) return;

      if (timer) clearTimeout(timer);
      const factor = Math.min(2 ** failures.current, MAX_BACKOFF);
      timer = setTimeout(() => void step(), intervalMs * factor);
    };

    void step(true);

    const wake = () => {
      if (document.visibilityState === "visible") void step(true);
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);

    return () => {
      stopped = true;
      alive.current = false;
      if (timer) clearTimeout(timer);
      inFlight.current?.abort();
      inFlight.current = null;
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
    };
  }, [fetchNow, intervalMs]);

  const refresh = useCallback(() => void fetchNow(true), [fetchNow]);

  return { data, loading, error, syncedAt, refresh };
}
