"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

import { statusToneClasses } from "@/components/ui/badge";
import { SETTABLE_STATUSES } from "@/lib/types";
import type { TicketStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Roughly how tall the open list is, used to decide which way it opens. */
const LIST_HEIGHT = 196;

/** A filled dot per status, so the list reads by colour before it is read. */
const DOTS: Record<TicketStatus, string> = {
  New: "bg-status-new-fg",
  "In Progress": "bg-status-progress-fg",
  Completed: "bg-status-completed-fg",
  Overdue: "bg-status-overdue-fg",
};

/**
 * Sets a ticket's status from the row.
 *
 * Built rather than borrowed from `<select>`: a native dropdown paints its own
 * list in the operating system's colours, so the options cannot carry the
 * status colours that the rest of the table is read by. This keeps the trigger
 * tinted like a badge and colours every option to match.
 */
export function StatusPicker({
  value,
  onChange,
  disabled,
  label,
  className,
}: {
  value: TicketStatus;
  onChange: (next: TicketStatus) => void;
  disabled?: boolean;
  /** For screen readers: which ticket this belongs to. */
  label: string;
  /** Size and spacing, for a caller whose row is taller than a table row's. */
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  /** Where the list is pinned, in viewport coordinates. */
  const [at, setAt] = useState<{ right: number; top?: number; bottom?: number } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  /**
   * The table scrolls sideways inside its own box, which clipped a list drawn
   * in it - the last row's options were cut off entirely. The list is drawn on
   * the body instead and pinned to its trigger, opening upwards when the row is
   * near the bottom of the window.
   */
  const place = () => {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;

    const room = window.innerHeight - rect.bottom;
    setAt({
      right: Math.max(8, window.innerWidth - rect.right),
      ...(room > LIST_HEIGHT
        ? { top: rect.bottom + 4 }
        : { bottom: Math.max(8, window.innerHeight - rect.top + 4) }),
    });
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const inRoot = root.current?.contains(event.target as Node);
      const inList = (event.target as HTMLElement).closest?.("[data-status-list]");
      if (!inRoot && !inList) setOpen(false);
    };
    // A list pinned to a row cannot follow it, so it closes when the page moves.
    const onScroll = () => setOpen(false);
    const onResize = () => place();
    // Caught on the way down, and stopped there: whatever is behind this
    // list - the detail sheet, say - also closes on Escape, and one key press
    // should only shut one thing.
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
    <div ref={root} className="relative" onClick={(event) => event.stopPropagation()}>
      <button
        ref={trigger}
        type="button"
        disabled={disabled}
        onClick={() => {
          place();
          setOpen((current) => !current);
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        className={cn(
          "inline-flex h-6 w-full items-center gap-1 rounded px-1.5 text-[11px] font-semibold transition-shadow",
          "hover:ring-1 hover:ring-ink-300 focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:outline-none",
          statusToneClasses(value),
          disabled && "pointer-events-none opacity-60",
          className,
        )}
      >
        <span className={cn("size-1.5 shrink-0 rounded-full", DOTS[value])} />
        <span className="min-w-0 flex-1 truncate text-left">{value}</span>
        <ChevronDown className={cn("size-3 shrink-0 opacity-60 transition-transform", open && "rotate-180")} />
      </button>

      {open &&
        at &&
        createPortal(
        <ul
          role="listbox"
          aria-label={label}
          data-status-list
          style={{ right: at.right, top: at.top, bottom: at.bottom }}
          className="fixed z-50 w-36 overflow-hidden rounded-md border border-line bg-surface p-1 shadow-xl shadow-ink-900/10"
        >
          {SETTABLE_STATUSES.map((status) => {
            const current = status === value;
            return (
              <li key={status}>
                <button
                  type="button"
                  role="option"
                  aria-selected={current}
                  onClick={() => {
                    setOpen(false);
                    if (!current) onChange(status);
                  }}
                  className={cn(
                    "flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-[11px] font-semibold transition-colors",
                    current ? statusToneClasses(status) : "text-ink-600 hover:bg-ink-50",
                  )}
                >
                  <span className={cn("size-1.5 shrink-0 rounded-full", DOTS[status])} />
                  <span className="flex-1">{status}</span>
                  {current && <Check className="size-3 shrink-0" strokeWidth={3} />}
                </button>
              </li>
            );
          })}

          {/* Nothing in the list is current, which would otherwise look like a
              ticket with no status at all. It has one - the deadline gave it. */}
          {value === "Overdue" && (
            <li className="mt-1 border-t border-line px-1.5 pt-1 text-[10px] leading-tight text-ink-400">
              Overdue comes from the deadline. Finish it, or move the date.
            </li>
          )}
        </ul>,
        document.body,
      )}
    </div>
  );
}
