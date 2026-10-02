"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Layers, type LucideIcon, Send, UserCheck, Users } from "lucide-react";

import { inAnchoredPanel, useAnchoredPanel } from "@/components/ui/use-anchored-panel";
import { cn } from "@/lib/utils";

/** Whose tickets All Tickets is showing. */
export type Whose = "any" | "mine" | "others" | "assigned";

const OPTIONS: {
  value: Whose;
  label: string;
  hint: string;
  icon: LucideIcon;
  /** The icon's chip in the list, and the trigger's tint while it is chosen. */
  chip: string;
  chosen: string;
}[] = [
  {
    value: "any",
    label: "All tickets",
    hint: "Everything in your queue",
    icon: Layers,
    chip: "bg-ink-100 text-ink-600",
    chosen: "border-line-strong bg-surface text-ink-800",
  },
  {
    value: "mine",
    label: "My requests",
    hint: "Tickets you raised",
    icon: Send,
    chip: "bg-violet-100 text-violet-700",
    chosen: "border-violet-300 bg-violet-50 text-violet-800",
  },
  {
    value: "others",
    label: "Raised by others",
    hint: "Everyone's but your own",
    icon: Users,
    chip: "bg-sky-100 text-sky-700",
    chosen: "border-sky-300 bg-sky-50 text-sky-800",
  },
  {
    value: "assigned",
    label: "Assigned to me",
    hint: "On your desk by name",
    icon: UserCheck,
    chip: "bg-brand-50 text-brand-700",
    chosen: "border-brand-300 bg-brand-50 text-brand-700",
  },
];

/**
 * One control for whose tickets the list shows: all of them, the ones you
 * raised, everyone else's, or the ones on you by name. Each with its count,
 * so the choice says what it holds before it is made.
 *
 * The panel is drawn on the body, like the other filters, so the toolbar's
 * card cannot clip it.
 */
export function WhoseSelect({
  value,
  counts,
  onChange,
}: {
  value: Whose;
  counts: Record<Whose, number>;
  onChange: (next: Whose) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const at = useAnchoredPanel(open, trigger, 272);

  const current = OPTIONS.find((option) => option.value === value) ?? OPTIONS[0];
  const narrowed = value !== "any";

  const show = () => {
    setActive(Math.max(0, OPTIONS.findIndex((option) => option.value === value)));
    setOpen(true);
  };
  const close = (refocus = false) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };
  const choose = (next: Whose) => {
    onChange(next);
    close(true);
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (root.current?.contains(event.target as Node)) return;
      if (inAnchoredPanel(event.target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  // The highlighted option takes the focus, so the keys work from the first press.
  useEffect(() => {
    if (open) items.current[active]?.focus();
  }, [open, active, at]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((index) => (index + step + OPTIONS.length) % OPTIONS.length);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(OPTIONS[active].value);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setActive(event.key === "Home" ? 0 : OPTIONS.length - 1);
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  };

  return (
    <div ref={root} className="relative shrink-0">
      <button
        ref={trigger}
        type="button"
        onClick={() => (open ? close() : show())}
        onKeyDown={(event) => {
          if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            event.preventDefault();
            show();
          }
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Show: ${current.label}`}
        className={cn(
          "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border pr-2 pl-2.5 text-[13px] font-semibold transition-colors",
          "focus:ring-4 focus:ring-brand-500/10 focus:outline-none",
          narrowed ? current.chosen : "border-line-strong bg-surface text-ink-700 hover:bg-ink-50",
        )}
      >
        <current.icon className={cn("size-3.5", !narrowed && "text-ink-400")} />
        <span className="whitespace-nowrap">{current.label}</span>
        <span
          className={cn(
            "rounded-full px-1.5 py-0.5 text-[11px] leading-none font-bold tabular-nums",
            narrowed ? "bg-white/70" : "bg-ink-100 text-ink-600",
          )}
        >
          {counts[current.value]}
        </span>
        <ChevronDown className={cn("size-4 text-ink-400 transition-transform duration-200", open && "rotate-180")} />
      </button>

      {open &&
        at &&
        createPortal(
          <div
            data-anchored-panel
            onKeyDown={onKeyDown}
            style={{ left: at.left, top: at.top, bottom: at.bottom, width: at.width }}
            className="fixed z-50 overflow-hidden rounded-lg border border-line bg-surface p-1 shadow-xl shadow-ink-900/10"
          >
            <p className="px-2 pt-1 pb-1.5 text-[10px] font-bold tracking-wider text-ink-400 uppercase">Show</p>
            <ul role="listbox" aria-label="Show">
              {OPTIONS.map((option, index) => {
                const selected = option.value === value;
                return (
                  <li key={option.value}>
                    {/* Assigned to me is a different question from who raised it. */}
                    {option.value === "assigned" && <div aria-hidden className="mx-2 my-1 h-px bg-line" />}
                    <button
                      ref={(element) => {
                        items.current[index] = element;
                      }}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      tabIndex={index === active ? 0 : -1}
                      onMouseEnter={() => setActive(index)}
                      onClick={() => choose(option.value)}
                      className={cn(
                        "flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors focus:outline-none",
                        index === active ? "bg-ink-50" : "",
                      )}
                    >
                      <span className={cn("grid size-7 shrink-0 place-items-center rounded-md", option.chip)}>
                        <option.icon className="size-3.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={cn("block text-[13px] leading-tight", selected ? "font-bold text-ink-900" : "font-semibold text-ink-800")}>
                          {option.label}
                        </span>
                        <span className="block truncate text-[11px] leading-tight text-ink-400">{option.hint}</span>
                      </span>
                      <span className="shrink-0 rounded-full bg-ink-100 px-1.5 py-0.5 text-[11px] leading-none font-bold text-ink-600 tabular-nums">
                        {counts[option.value]}
                      </span>
                      <span className="grid size-4 shrink-0 place-items-center">
                        {selected && <Check className="size-3.5 text-brand-600" strokeWidth={3} />}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>,
          document.body,
        )}
    </div>
  );
}
