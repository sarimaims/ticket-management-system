"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

const CONTROL =
  "h-8 w-full rounded-md border border-line-strong bg-surface text-[13px] font-medium text-ink-900 " +
  "transition-colors placeholder:font-normal placeholder:text-ink-400 " +
  "focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/10";

export function Label({
  children,
  required,
  hint,
  htmlFor,
  className,
}: {
  children: React.ReactNode;
  required?: boolean;
  hint?: string;
  htmlFor?: string;
  className?: string;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className={cn("mb-1 block text-[12px] font-semibold text-ink-700", className)}
    >
      {children}
      {required && <span className="ml-1 text-brand-600">*</span>}
      {hint && <span className="ml-1 font-normal text-ink-400">{hint}</span>}
    </label>
  );
}

export function Field({
  label,
  required,
  hint,
  help,
  htmlFor,
  error,
  children,
  className,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  /** One short line telling the reader what belongs in this box. */
  help?: string;
  htmlFor?: string;
  error?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label required={required} hint={hint} htmlFor={htmlFor} className={help ? "mb-1" : undefined}>
        {label}
      </Label>
      {help && <p className="mb-1.5 text-xs text-ink-400">{help}</p>}
      {children}
      {error && (
        <p role="alert" className="mt-1.5 text-xs font-medium text-brand-600">
          {error}
        </p>
      )}
    </div>
  );
}

/** Leading icon slot shared by every control. */
function LeadingIcon({ children }: { children: React.ReactNode }) {
  return (
    <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-400 [&_svg]:size-4">
      {children}
    </span>
  );
}

export function Input({
  icon,
  className,
  trailing,
  invalid,
  ...props
}: React.ComponentProps<"input"> & {
  icon?: React.ReactNode;
  trailing?: React.ReactNode;
  invalid?: boolean;
}) {
  return (
    <div className="relative">
      {icon && <LeadingIcon>{icon}</LeadingIcon>}
      <input
        aria-invalid={invalid || undefined}
        className={cn(
          CONTROL,
          icon ? "pl-8" : "pl-3",
          trailing ? "pr-9" : "pr-3",
          invalid && "border-brand-400 bg-brand-50/40",
          className,
        )}
        {...props}
      />
      {trailing && (
        <span className="absolute top-1/2 right-3 -translate-y-1/2">{trailing}</span>
      )}
    </div>
  );
}

export function Select({
  icon,
  className,
  children,
  ...props
}: React.ComponentProps<"select"> & { icon?: React.ReactNode }) {
  return (
    <div className="relative">
      {icon && <LeadingIcon>{icon}</LeadingIcon>}
      <select className={cn(CONTROL, icon ? "pl-8" : "pl-3", "pr-7", className)} {...props}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-ink-400" />
    </div>
  );
}

export function Textarea({
  className,
  maxLength,
  value,
  invalid,
  ...props
}: React.ComponentProps<"textarea"> & { invalid?: boolean }) {
  const count = typeof value === "string" ? value.length : 0;
  return (
    <div className="relative">
      <textarea
        aria-invalid={invalid || undefined}
        className={cn(
          "min-h-[84px] w-full resize-y rounded-md border border-line-strong bg-surface px-3 py-2 text-[13px] text-ink-900",
          "transition-colors placeholder:text-ink-400",
          "focus:border-brand-400 focus:outline-none focus:ring-4 focus:ring-brand-500/10",
          maxLength ? "pb-9" : "",
          invalid && "border-brand-400 bg-brand-50/40",
          className,
        )}
        maxLength={maxLength}
        value={value}
        {...props}
      />
      {maxLength && (
        <span className="pointer-events-none absolute right-4 bottom-3 text-xs text-ink-400">
          {count}/{maxLength}
        </span>
      )}
    </div>
  );
}
