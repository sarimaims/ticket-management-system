import { cn } from "@/lib/utils";

export function Logo({
  tone = "dark",
  className,
}: {
  tone?: "dark" | "light";
  className?: string;
}) {
  const light = tone === "light";

  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <svg viewBox="0 0 32 32" className="size-8" aria-hidden="true">
        <defs>
          <linearGradient id={light ? "aivin-mark-light" : "aivin-mark"} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={light ? "#ffffff" : "var(--color-brand-500)"} />
            <stop offset="100%" stopColor={light ? "#ffe4e6" : "var(--color-brand-700)"} />
          </linearGradient>
        </defs>
        <path d="M16 2 30 29H21.5L16 17.2 10.5 29H2Z" fill={`url(#${light ? "aivin-mark-light" : "aivin-mark"})`} />
        <path
          d="M16 11.5 21 22h-10Z"
          fill={light ? "var(--color-brand-600)" : "var(--color-surface)"}
        />
      </svg>
      <span
        className={cn(
          "text-xl font-extrabold tracking-tight",
          light ? "text-white" : "text-ink-900",
        )}
      >
        AIVIN
      </span>
    </span>
  );
}
