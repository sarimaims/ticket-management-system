"use client";

import { Calendar, X } from "lucide-react";

import { cn, formatDate } from "@/lib/utils";

/**
 * Native date input, our chrome. The real <input type="date"> is stretched
 * transparently over the control so clicking anywhere opens the OS picker,
 * while the visible text keeps the product's "20 Sep 2025" format.
 *
 * `bare` drops the border/background so several of these can sit inside one
 * shared shell (the date-range filter).
 */
export function DateField({
  value,
  onChange,
  id,
  placeholder = "Select a date",
  clearable = true,
  bare = false,
  showIcon = true,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  placeholder?: string;
  clearable?: boolean;
  bare?: boolean;
  showIcon?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative flex items-center gap-3",
        bare
          ? "h-full px-1"
          : "h-12 rounded-field border border-line-strong bg-surface px-4 transition-colors focus-within:border-brand-400 focus-within:ring-4 focus-within:ring-brand-500/10",
        className,
      )}
    >
      {showIcon && <Calendar className="size-4.5 shrink-0 text-ink-400" />}
      <span
        className={cn(
          "flex-1 truncate font-medium",
          bare ? "text-[13px]" : "text-sm",
          // a caller-supplied text size wins over both

          value ? "text-ink-900" : "text-ink-400",
        )}
      >
        {value ? formatDate(value) : placeholder}
      </span>

      <input
        id={id}
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="absolute inset-0 cursor-pointer opacity-0"
        aria-label={placeholder}
      />

      {clearable && value && (
        <button
          type="button"
          onClick={() => onChange("")}
          className="relative z-10 grid size-5 shrink-0 place-items-center rounded-full bg-ink-300 text-white transition-colors hover:bg-ink-400"
          aria-label="Clear date"
        >
          <X className="size-3" strokeWidth={3} />
        </button>
      )}
    </div>
  );
}
