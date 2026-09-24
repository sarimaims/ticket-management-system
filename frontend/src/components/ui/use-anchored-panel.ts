"use client";

import { useEffect, useState, type RefObject } from "react";

/** How much room a panel wants below its trigger before it flips above it. */
const WANTS = 288;

/** The gap between a trigger and its panel. */
const GAP = 4;

export type AnchorAt = { left: number; width: number; top?: number; bottom?: number };

/**
 * Where a floating panel should sit, in viewport coordinates.
 *
 * A dropdown drawn inside its own container is at the mercy of that container:
 * a card with `overflow-hidden` clips it, a table that scrolls sideways cuts it
 * off, and a later sibling with its own stacking context covers it however high
 * the z-index goes. The way out is to draw it on the body and place it by hand,
 * which is what this works out - including flipping above the trigger when the
 * room below has run out.
 *
 * The panel itself must carry `data-anchored-panel`, so scrolling *inside* it
 * is not mistaken for the page moving underneath it.
 */
export function useAnchoredPanel(
  open: boolean,
  trigger: RefObject<HTMLElement | null>,
  minWidth = 224,
) {
  const [at, setAt] = useState<AnchorAt | null>(null);

  useEffect(() => {
    // Closing leaves the last position in place rather than clearing it: the
    // panel is not rendered either way, and reopening on the old coordinates
    // beats reopening on none while the first measurement lands.
    if (!open) return;

    const place = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;

      const width = Math.max(rect.width, minWidth);
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      const below = window.innerHeight - rect.bottom;

      setAt(
        // Below unless it would not fit and there is more room the other way.
        below >= WANTS || below >= rect.top
          ? { left, width, top: rect.bottom + GAP }
          : { left, width, bottom: window.innerHeight - rect.top + GAP },
      );
    };

    // Measuring the DOM is exactly the "synchronise with an external system"
    // case the rule allows: here the layout is the system.
    place();

    const onScroll = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest?.("[data-anchored-panel]")) return;
      place();
    };

    // Capture, because the thing that scrolls is usually an inner container
    // rather than the window.
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", place);
    };
  }, [open, trigger, minWidth]);

  return at;
}

/** True when the event happened inside any panel drawn on the body. */
export function inAnchoredPanel(target: EventTarget | null) {
  return Boolean((target as HTMLElement | null)?.closest?.("[data-anchored-panel]"));
}
