"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";

import { cn } from "@/lib/utils";

export type Option = { value: string; label: string };

/** Below this many options the eye finds it faster than the keyboard would. */
const SEARCH_FROM = 7;

/**
 * How the picked options read on the closed control.
 *
 * `chips` names every one of them, which is what a form field wants: the
 * answer is the point, and the field has the width to show it. `summary`
 * keeps to a single line - a filter sits in a toolbar beside other filters,
 * and one that grows to four lines pushes the whole bar apart.
 */
export type MultiSelectDisplay = "chips" | "summary";

/**
 * A dropdown of checkboxes. Picked options stay visible as chips on the
 * control, so a multi-choice is readable without opening it.
 *
 * Once the list is longer than {@link SEARCH_FROM} it grows a search box:
 * scrolling a list of thirty departments to find one is the slowest way to
 * answer a question you could have typed. `searchable` forces or forbids it
 * when the count alone gets the decision wrong.
 */
export function MultiSelect({
  options,
  value,
  onChange,
  placeholder = "Select one or more",
  emptyMessage = "Nothing to choose from",
  icon,
  id,
  invalid,
  disabled,
  searchable,
  display = "chips",
}: {
  options: Option[];
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  emptyMessage?: string;
  icon?: React.ReactNode;
  id?: string;
  invalid?: boolean;
  disabled?: boolean;
  searchable?: boolean;
  display?: MultiSelectDisplay;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);

  const withSearch = searchable ?? options.length >= SEARCH_FROM;
  const summarised = display === "summary";

  /** Closing forgets what was typed, so the next open starts on the whole list. */
  const close = () => {
    setOpen(false);
    setTerm("");
  };

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) close();
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

  const toggle = (option: string) =>
    onChange(
      value.includes(option) ? value.filter((item) => item !== option) : [...value, option],
    );

  const labelFor = (item: string) => options.find((option) => option.value === item)?.label ?? item;

  const needle = term.trim().toLowerCase();
  const shown = needle
    ? options.filter((option) => option.label.toLowerCase().includes(needle))
    : options;

  return (
    <div ref={root} className="relative">
      <button
        id={id}
        type="button"
        disabled={disabled}
        onClick={() => (open ? close() : setOpen(true))}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-field border bg-surface px-3.5 text-left transition-colors",
          "focus:ring-4 focus:ring-brand-500/10 focus:outline-none",
          // A summary never wraps, so it keeps the one height it started at.
          summarised ? "h-11" : "min-h-11 py-1.5",
          invalid ? "border-brand-400" : "border-line-strong focus:border-brand-400",
          disabled && "cursor-not-allowed bg-ink-50 text-ink-400",
        )}
      >
        {icon && <span className="shrink-0 text-ink-400 [&_svg]:size-4.5">{icon}</span>}

        {value.length === 0 ? (
          <span className="flex-1 truncate text-sm text-ink-400">
            {options.length === 0 ? emptyMessage : placeholder}
          </span>
        ) : summarised ? (
          // One name reads better than "1 selected"; past that, the count is
          // the only thing that fits and the list is a click away.
          <span className="flex-1 truncate text-sm font-semibold text-ink-900">
            {value.length === 1 ? labelFor(value[0]) : `${value.length} selected`}
          </span>
        ) : (
          <span className="flex flex-1 flex-wrap gap-1.5">
            {value.map((item) => (
              <span
                key={item}
                className="inline-flex items-center gap-1 rounded-md bg-brand-50 py-1 pr-1.5 pl-2 text-xs font-semibold text-brand-700"
              >
                {labelFor(item)}
                <span
                  role="button"
                  tabIndex={-1}
                  aria-label={"Remove " + labelFor(item)}
                  onClick={(event) => {
                    event.stopPropagation();
                    onChange(value.filter((option) => option !== item));
                  }}
                  className="grid size-4 place-items-center rounded-full text-brand-500 hover:bg-brand-100 hover:text-brand-700"
                >
                  <X className="size-3" strokeWidth={3} />
                </span>
              </span>
            ))}
          </span>
        )}

        {/* Undoing a filter is a thing people do constantly, and unticking
            four boxes to get back to "all" is four clicks too many. */}
        {summarised && value.length > 0 && (
          <span
            role="button"
            tabIndex={-1}
            aria-label="Clear this filter"
            onClick={(event) => {
              event.stopPropagation();
              onChange([]);
            }}
            className="grid size-5 shrink-0 place-items-center rounded-full text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700"
          >
            <X className="size-3.5" strokeWidth={3} />
          </span>
        )}

        <ChevronDown
          className={cn("size-4.5 shrink-0 text-ink-400 transition-transform", open && "rotate-180")}
        />
      </button>

      {/* The panel is wider than the control when the control is narrow: a
          filter box is sized for its summary, not for the longest option in
          it. */}
      {open && options.length > 0 && (
        <div className="absolute z-30 mt-2 w-full min-w-60 overflow-hidden rounded-field border border-line bg-surface shadow-xl shadow-ink-900/10">
          {withSearch && (
            <div className="relative border-b border-line">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-400" />
              <input
                ref={search}
                value={term}
                onChange={(event) => setTerm(event.target.value)}
                placeholder="Search..."
                aria-label="Search the list"
                className="h-10 w-full bg-transparent pr-3 pl-9 text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none"
              />
            </div>
          )}

          {shown.length === 0 ? (
            <p className="px-3 py-3 text-center text-sm text-ink-400">Nothing matches “{term}”</p>
          ) : (
            <ul role="listbox" aria-multiselectable="true" className="max-h-64 overflow-y-auto p-1.5">
              {shown.map((option) => {
                const selected = value.includes(option.value);
                return (
                  <li key={option.value}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => toggle(option.value)}
                      className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm whitespace-nowrap text-ink-700 transition-colors hover:bg-ink-50"
                    >
                      <span
                        className={cn(
                          "grid size-4.5 shrink-0 place-items-center rounded border transition-colors",
                          selected
                            ? "border-brand-600 bg-brand-600 text-white"
                            : "border-line-strong bg-surface",
                        )}
                      >
                        {selected && <Check className="size-3" strokeWidth={3.5} />}
                      </span>
                      {option.label}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
