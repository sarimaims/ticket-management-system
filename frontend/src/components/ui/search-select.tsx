"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search } from "lucide-react";

import { inAnchoredPanel, useAnchoredPanel } from "@/components/ui/use-anchored-panel";
import { cn } from "@/lib/utils";

export type SearchOption = { value: string; label: string; hint?: string };

/** Below this many options the eye finds it faster than the keyboard would. */
const SEARCH_FROM = 7;

/**
 * One choice out of a list you can type into. The multi-select next door
 * answers "which of these"; this answers "which one", closes on the answer,
 * and can be cleared back to nothing.
 */
export function SearchSelect({
  options,
  value,
  onChange,
  placeholder = "Select one",
  emptyMessage = "Nothing to choose from",
  clearLabel,
  icon,
  id,
  invalid,
  disabled,
  searchable,
}: {
  options: SearchOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  emptyMessage?: string;
  /** When given, the list opens with this as a way back to "no choice". */
  clearLabel?: string;
  icon?: React.ReactNode;
  id?: string;
  invalid?: boolean;
  disabled?: boolean;
  searchable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);

  const withSearch = searchable ?? options.length >= SEARCH_FROM;

  /** Closing forgets what was typed, so the next open starts on the whole list. */
  const close = () => {
    setOpen(false);
    setTerm("");
  };

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (root.current?.contains(event.target as Node)) return;
      // The panel is drawn on the body, so it is not inside the root.
      if (inAnchoredPanel(event.target)) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Opening puts the caret where the typing goes.
  useEffect(() => {
    if (open && withSearch) search.current?.focus();
  }, [open, withSearch]);

  const chosen = options.find((option) => option.value === value);

  const at = useAnchoredPanel(open, trigger);

  const needle = term.trim().toLowerCase();
  const shown = needle
    ? options.filter((option) => option.label.toLowerCase().includes(needle))
    : options;

  const pick = (next: string) => {
    onChange(next);
    close();
  };

  return (
    <div ref={root} className="relative">
      <button
        id={id}
        ref={trigger}
        type="button"
        disabled={disabled}
        onClick={() => (open ? close() : setOpen(true))}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          "flex h-8 w-full items-center gap-2 rounded-md border bg-surface px-2.5 text-left transition-colors",
          "focus:ring-4 focus:ring-brand-500/10 focus:outline-none",
          invalid ? "border-brand-400" : "border-line-strong focus:border-brand-400",
          disabled && "cursor-not-allowed bg-ink-50 text-ink-400",
        )}
      >
        {icon && <span className="shrink-0 text-ink-400 [&_svg]:size-4">{icon}</span>}

        <span
          className={cn(
            "flex-1 truncate text-[13px]",
            chosen ? "font-semibold text-ink-900" : "text-ink-400",
          )}
        >
          {chosen?.label ?? (options.length === 0 ? emptyMessage : placeholder)}
        </span>

        <ChevronDown
          className={cn("size-4 shrink-0 text-ink-400 transition-transform", open && "rotate-180")}
        />
      </button>

      {/* Drawn on the body, for the same reason as the multi-select: nothing
          the trigger happens to sit inside can clip it or cover it. */}
      {open &&
        at &&
        createPortal(
          <div
            data-anchored-panel
            style={{ left: at.left, top: at.top, bottom: at.bottom, width: at.width }}
            className="fixed z-50 overflow-hidden rounded-md border border-line bg-surface shadow-xl shadow-ink-900/10"
          >
          {withSearch && (
            <div className="relative border-b border-line">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-400" />
              <input
                ref={search}
                value={term}
                onChange={(event) => setTerm(event.target.value)}
                placeholder="Search..."
                aria-label="Search the list"
                className="h-8 w-full bg-transparent pr-2.5 pl-8 text-[13px] text-ink-900 placeholder:text-ink-400 focus:outline-none"
              />
            </div>
          )}

          {options.length === 0 ? (
            <p className="px-2.5 py-2 text-center text-[12px] text-ink-400">{emptyMessage}</p>
          ) : shown.length === 0 ? (
            <p className="px-2.5 py-2 text-center text-[12px] text-ink-400">
              Nothing matches “{term}”
            </p>
          ) : (
            <ul role="listbox" className="max-h-60 overflow-y-auto p-1">
              {clearLabel && !needle && (
                <li>
                  <button
                    type="button"
                    role="option"
                    aria-selected={value === ""}
                    onClick={() => pick("")}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] text-ink-500 transition-colors hover:bg-ink-50"
                  >
                    <span className="size-3.5 shrink-0" />
                    {clearLabel}
                  </button>
                </li>
              )}

              {shown.map((option) => {
                const selected = option.value === value;
                return (
                  <li key={option.value}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => pick(option.value)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-ink-50",
                        selected ? "font-semibold text-brand-700" : "text-ink-700",
                      )}
                    >
                      <span className="grid size-3.5 shrink-0 place-items-center">
                        {selected && <Check className="size-3.5" strokeWidth={3} />}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{option.label}</span>
                      {option.hint && (
                        <span className="shrink-0 text-[11px] text-ink-400">{option.hint}</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          </div>,
          document.body,
        )}
    </div>
  );
}
