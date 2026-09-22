"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

import { statusToneClasses } from "@/components/ui/badge";
import type { TicketStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const STATUSES: TicketStatus[] = [
  "New",
  "Accepted",
  "In Progress",
  "Waiting",
  "Completed",
  "Overdue",
];

/** A filled dot per status, so the list reads by colour before it is read. */
const DOTS: Record<TicketStatus, string> = {
  New: "bg-status-new-fg",
  Accepted: "bg-status-accepted-fg",
  "In Progress": "bg-status-progress-fg",
  Waiting: "bg-status-waiting-fg",
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
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
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
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  return (
    <div ref={root} className="relative" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
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

      {open && (
        <ul
          role="listbox"
          aria-label={label}
          className="absolute right-0 z-30 mt-1 w-36 overflow-hidden rounded-md border border-line bg-surface p-1 shadow-lg shadow-ink-900/10"
        >
          {STATUSES.map((status) => {
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
        </ul>
      )}
    </div>
  );
}
