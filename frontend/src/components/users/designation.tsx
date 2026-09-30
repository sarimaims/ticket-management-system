import { cn } from "@/lib/utils";

/**
 * A person's title, set under or beside their name.
 *
 * One component so it reads the same everywhere a name appears - a ticket
 * row, a chat bubble, a picker - and so "what does this person do" is always
 * answered in the same place and the same voice. Renders nothing when there is
 * no title, rather than an empty line or a dash: most older roles have none
 * yet, and a placeholder on every one of them would be noise.
 */
export function Designation({
  value,
  inline = false,
  className,
}: {
  value?: string | null;
  /** Beside the name, after a dot, rather than on its own line under it. */
  inline?: boolean;
  className?: string;
}) {
  if (!value) return null;

  if (inline) {
    return (
      <span className={cn("font-normal text-ink-500", className)} title={value}>
        · {value}
      </span>
    );
  }

  return (
    <span
      className={cn("block truncate text-[10.5px] leading-tight font-medium text-ink-500", className)}
      title={value}
    >
      {value}
    </span>
  );
}
