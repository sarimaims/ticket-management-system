"use client";

import { Phone } from "lucide-react";

import { Input } from "@/components/ui/field";
import { acceptPhone } from "@/lib/phone";

/**
 * A phone box that only accepts what a phone number is made of.
 *
 * Letters are refused as they are typed rather than after the form is sent,
 * and the value handed back is exactly what was typed - forms send it through
 * toStoredPhone(), so what the API stores is the same whichever way it was
 * spaced out.
 */
export function PhoneInput({
  value,
  onChange,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "value" | "onChange" | "type"> & {
  value: string;
  onChange: (phone: string) => void;
}) {
  return (
    <Input
      {...props}
      type="tel"
      inputMode="tel"
      autoComplete="tel"
      spellCheck={false}
      icon={props.icon ?? <Phone className="text-ink-400" />}
      value={value}
      onChange={(event) => onChange(acceptPhone(event.target.value))}
    />
  );
}
