"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";

import { cn } from "@/lib/utils";

export function MultiSelect({
  options,
  value,
  onChange,
  placeholder = "Select one or more",
  icon,
  id,
  invalid,
}: {
  options: string[];
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  icon?: React.ReactNode;
  id?: string;
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const toggle = (option: string) =>
    onChange(
      value.includes(option) ? value.filter((item) => item !== option) : [...value, option],
    );

  return (
    <div ref={root} className="relative">
      <button
        id={id}
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          "flex min-h-12 w-full items-center gap-3 rounded-field border bg-surface px-4 py-2 text-left transition-colors",
          "focus:outline-none focus:ring-4 focus:ring-brand-500/10",
          invalid ? "border-brand-400" : "border-line-strong focus:border-brand-400",
        )}
      >
        {icon && <span className="shrink-0 text-ink-400 [&_svg]:size-4.5">{icon}</span>}

        {value.length === 0 ? (
          <span className="flex-1 text-sm text-ink-400">{placeholder}</span>
        ) : (
          <span className="flex flex-1 flex-wrap gap-1.5">
            {value.map((item) => (
              <span
                key={item}
                className="inline-flex items-center gap-1 rounded-md bg-brand-50 py-1 pr-1.5 pl-2 text-xs font-semibold text-brand-700"
              >
                {item}
                <span
                  role="button"
                  tabIndex={-1}
                  aria-label={"Remove " + item}
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

        <ChevronDown
          className={cn("size-4.5 shrink-0 text-ink-400 transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <ul
          role="listbox"
          aria-multiselectable="true"
          className="absolute z-30 mt-2 max-h-64 w-full overflow-y-auto rounded-field border border-line bg-surface p-1.5 shadow-xl shadow-ink-900/10"
        >
          {options.map((option) => {
            const selected = value.includes(option);
            return (
              <li key={option}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => toggle(option)}
                  className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm text-ink-700 transition-colors hover:bg-ink-50"
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
                  {option}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
