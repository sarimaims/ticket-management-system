"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

import type { TicketPriority } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Roughly how tall the open list is, used to decide which way it opens. */
const LIST_HEIGHT = 140;

const PRIORITIES: TicketPriority[] = ["Low", "Medium", "High", "Critical"];

/** A dot per level, so the list reads by colour before it is read by word. */
const DOTS: Record<TicketPriority, string> = {
  Low: "bg-priority-low-dot",
  Medium: "bg-priority-medium-dot",
  High: "bg-priority-high-dot",
  Critical: "bg-priority-critical-dot",
};

/**
 * Picks a priority.
 *
 * A dropdown rather than four segments on show: in a row beside Subject and
 * Deadline the segmented control was three times the width of either, which
 * made the least important question on the form look like the largest. Built
 * rather than a native `<select>` for the same reason as the status one - the
 * browser paints its option list in the operating system's colours, and the
 * colour is half of what a priority means here.
 */
export function PriorityPicker({
  value,
  onChange,
  id,
  disabled,
  className,
}: {
  value: TicketPriority;
  onChange: (value: TicketPriority) => void;
  id?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  /** Where the list is pinned, in viewport coordinates. */
  const [at, setAt] = useState<{ left: number; width: number; top?: number; bottom?: number } | null>(
    null,
  );
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  /** Drawn on the body, so a card or a scrolling panel cannot clip it. */
  const place = () => {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;

    const room = window.innerHeight - rect.bottom;
    setAt({
      left: rect.left,
      width: rect.width,
      ...(room > LIST_HEIGHT
        ? { top: rect.bottom + 4 }
        : { bottom: Math.max(8, window.innerHeight - rect.top + 4) }),
    });
  };

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      const inRoot = root.current?.contains(event.target as Node);
      const inList = (event.target as HTMLElement).closest?.("[data-priority-list]");
      if (!inRoot && !inList) setOpen(false);
    };
    const onScroll = () => setOpen(false);
    const onResize = () => place();
    // Caught on the way down: a form inside a sheet closes on Escape too, and
    // one key press should shut one thing.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        id={id}
        ref={trigger}
        type="button"
        disabled={disabled}
        onClick={() => {
          place();
          setOpen((current) => !current);
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Priority"
        className={cn(
          "flex h-8 w-full items-center gap-2 rounded-md border border-line-strong bg-surface px-2.5",
          "text-[13px] font-medium text-ink-900 transition-colors",
          "focus:border-brand-400 focus:ring-2 focus:ring-brand-500/10 focus:outline-none",
          disabled && "cursor-not-allowed bg-ink-50 text-ink-400",
          className,
        )}
      >
        <span className={cn("size-2 shrink-0 rounded-full", DOTS[value])} />
        <span className="min-w-0 flex-1 truncate text-left">{value}</span>
        <ChevronDown
          className={cn("size-4 shrink-0 text-ink-400 transition-transform", open && "rotate-180")}
        />
      </button>

      {open &&
        at &&
        createPortal(
          <ul
            role="listbox"
            aria-label="Priority"
            data-priority-list
            style={{ left: at.left, width: at.width, top: at.top, bottom: at.bottom }}
            className="fixed z-50 overflow-hidden rounded-md border border-line bg-surface p-1 shadow-xl shadow-ink-900/10"
          >
            {PRIORITIES.map((level) => {
              const current = level === value;
              return (
                <li key={level}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={current}
                    onClick={() => {
                      setOpen(false);
                      if (!current) onChange(level);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] font-medium transition-colors",
                      current ? "bg-ink-50 font-semibold text-ink-900" : "text-ink-600 hover:bg-ink-50",
                    )}
                  >
                    <span className={cn("size-2 shrink-0 rounded-full", DOTS[level])} />
                    <span className="flex-1">{level}</span>
                    {current && <Check className="size-3.5 shrink-0 text-ink-400" strokeWidth={3} />}
                  </button>
                </li>
              );
            })}
          </ul>,
          document.body,
        )}
    </div>
  );
}
