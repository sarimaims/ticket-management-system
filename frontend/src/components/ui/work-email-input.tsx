"use client";

import { Input } from "@/components/ui/field";
import { EMAIL_DOMAIN, localPart, toWorkEmail } from "@/lib/email";

/**
 * An email box with the workspace's domain fixed on the end.
 *
 * Only the name is typed; the value going in and out is still the whole
 * address, so a form swaps this for a plain input without changing what it
 * submits. Pasting a full address keeps just the part before the "@".
 */
export function WorkEmailInput({
  value,
  onChange,
  className,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "value" | "onChange" | "type" | "trailing"> & {
  value: string;
  onChange: (email: string) => void;
}) {
  // An account made before the domain was fixed keeps its address until
  // somebody edits it, and should say so rather than pose as a work one.
  const elsewhere = value.includes("@") && !value.toLowerCase().endsWith(`@${EMAIL_DOMAIN}`);

  return (
    <>
      <Input
        {...props}
        type="text"
        inputMode="email"
        autoCapitalize="none"
        spellCheck={false}
        value={localPart(value)}
        onChange={(event) => onChange(toWorkEmail(event.target.value))}
        // Wide enough for the suffix, whatever the domain is set to.
        style={{ paddingRight: `${EMAIL_DOMAIN.length + 2.5}ch` }}
        className={className}
        trailing={
          <span className="pointer-events-none text-[13px] font-medium text-ink-500 select-none">
            @{EMAIL_DOMAIN}
          </span>
        }
      />
      {elsewhere && (
        <p className="mt-1 text-[11px] text-ink-400">
          Currently <span className="font-semibold text-ink-600">{value}</span>. Editing it moves
          the account to @{EMAIL_DOMAIN}.
        </p>
      )}
    </>
  );
}
