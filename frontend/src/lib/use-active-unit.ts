"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import {
  activeUnit,
  activeUnitOnServer,
  setActiveUnit,
  subscribeActiveUnit,
} from "@/lib/active-unit";

/**
 * The unit this person is working in, checked against the units they have.
 *
 * The preference lives in the browser and outlives the workspace it was made
 * in: a unit that is renamed keeps its id, but one that is deleted - or a
 * database rebuilt from a seed - leaves an id behind that matches nothing.
 * Filtering by it then hides every row, which reads as "you have no tickets"
 * rather than "you are looking at a unit that no longer exists".
 *
 * So an id nobody belongs to is treated as no narrowing at all, and forgotten
 * on the way past. A manager belongs to no unit and sees the whole workspace,
 * which is the same answer for a different reason.
 */
export function useActiveUnit() {
  const { session } = useAuth();
  const stored = useSyncExternalStore(subscribeActiveUnit, activeUnit, activeUnitOnServer);

  const mine = useMemo(
    () =>
      new Set(
        (session?.departments ?? [])
          .map((membership) => membership.unit?.id)
          .filter((id): id is string => Boolean(id)),
      ),
    [session],
  );

  /** Whether the stored id is still one this person could have chosen. */
  const stale = stored !== "" && !mine.has(stored);

  useEffect(() => {
    // Written rather than only ignored, so the switcher stops showing a unit
    // that is not there and the next reload starts clean.
    if (stale) setActiveUnit("");
  }, [stale]);

  return stale ? "" : stored;
}
