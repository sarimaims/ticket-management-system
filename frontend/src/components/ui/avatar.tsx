import { cn } from "@/lib/utils";

/** Colour follows what the person is, not who they are. */
export type AvatarTone = "head" | "team";

const TONES: Record<AvatarTone, string> = {
  head: "bg-avatar-head-bg text-avatar-head-fg",
  team: "bg-avatar-team-bg text-avatar-team-fg",
};

export function Avatar({
  initials,
  tone = "head",
  className,
}: {
  initials: string;
  tone?: AvatarTone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "grid size-9 shrink-0 place-items-center rounded-full text-xs font-bold",
        TONES[tone],
        className,
      )}
    >
      {initials}
    </span>
  );
}
