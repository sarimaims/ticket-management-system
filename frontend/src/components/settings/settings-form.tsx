"use client";

import { useState } from "react";
import { Building2, Mail, UserRound } from "lucide-react";

import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { RoleTag } from "@/components/ui/badge";
import { useAuth } from "@/components/auth/auth-provider";
import { avatarTone, initials } from "@/lib/auth";
import { cn } from "@/lib/utils";

const NOTIFICATIONS = [
  {
    key: "assigned",
    title: "Assigned to me",
    description: "Email me when a ticket lands in my queue.",
    on: true,
  },
  {
    key: "status",
    title: "Status changes",
    description: "Notify me when a request I raised changes status.",
    on: true,
  },
  {
    key: "deadline",
    title: "Deadline reminders",
    description: "Remind me the day before a ticket is due.",
    on: false,
  },
  {
    key: "digest",
    title: "Weekly digest",
    description: "A Monday summary of everything open.",
    on: false,
  },
];

function Toggle({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onToggle}
      className={cn(
        "relative h-6 w-11 shrink-0 rounded-full transition-colors",
        on ? "bg-brand-600" : "bg-ink-200",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 size-5 rounded-full bg-surface shadow-sm transition-all",
          on ? "left-[22px]" : "left-0.5",
        )}
      />
    </button>
  );
}

export function SettingsForm() {
  const { session } = useAuth();
  const [toggles, setToggles] = useState(() =>
    Object.fromEntries(NOTIFICATIONS.map((item) => [item.key, item.on])),
  );

  const name = session?.name ?? "";
  const email = session?.email ?? "";
  const memberships = session?.departments ?? [];

  return (
    <div className="grid gap-5 xl:grid-cols-3">
      <Card className="p-5 sm:p-7 xl:col-span-2">
        <h2 className="text-base font-bold text-ink-900">Profile</h2>
        <p className="mt-0.5 text-sm text-ink-500">
          This is how your name appears on every ticket you raise.
        </p>

        <div className="mt-5 flex items-center gap-4 border-b border-line pb-5">
          <Avatar initials={initials(name)} tone={avatarTone(session)} className="size-14 text-base" />
          <div>
            <p className="text-sm font-bold text-ink-900">{name}</p>
            <p className="text-sm text-ink-500">{memberships.map((item) => item.name).filter(Boolean).join(", ") || "No department yet"}</p>
          </div>
          <Button variant="outline" size="sm" className="ml-auto">
            Change photo
          </Button>
        </div>

        <form className="mt-5 space-y-5" onSubmit={(event) => event.preventDefault()}>
          <div className="grid gap-5 lg:grid-cols-2">
            <Field label="Full name" htmlFor="full-name">
              <Input
                id="full-name"
                icon={<UserRound className="text-ink-500" />}
                defaultValue={name}
                key={name}
              />
            </Field>

            <Field label="Work email" htmlFor="email">
              <Input
                id="email"
                type="email"
                icon={<Mail className="text-ink-500" />}
                defaultValue={email}
                key={email}
              />
            </Field>
          </div>

          {/* Membership is owned by the super admin on the Departments page,
              so it is shown here, not edited here. */}
          <Field label="Departments" hint="(managed by your super admin)">
            <div className="flex min-h-11 flex-wrap items-center gap-2 rounded-field border border-line-strong bg-ink-50 px-3 py-2">
              <Building2 className="size-4.5 shrink-0 text-ink-400" />
              {memberships.length === 0 ? (
                <span className="text-sm text-ink-400">Not in a department yet</span>
              ) : (
                memberships.map((item) => (
                  <span
                    key={item.id}
                    className="inline-flex items-center gap-1.5 rounded-md bg-surface px-2 py-1 text-xs font-semibold text-ink-700"
                  >
                    {item.name ?? "Department"}
                    <RoleTag role={item.role} />
                  </span>
                ))
              )}
            </div>
          </Field>

          <div className="flex justify-end border-t border-line pt-5">
            <Button type="submit">Save Changes</Button>
          </div>
        </form>
      </Card>

      <Card className="p-5 sm:p-7">
        <h2 className="text-base font-bold text-ink-900">Notifications</h2>
        <p className="mt-0.5 text-sm text-ink-500">Choose what reaches your inbox.</p>

        <ul className="mt-5 divide-y divide-line">
          {NOTIFICATIONS.map((item) => (
            <li key={item.key} className="flex items-start gap-4 py-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink-900">{item.title}</p>
                <p className="mt-0.5 text-sm text-ink-500">{item.description}</p>
              </div>
              <Toggle
                on={toggles[item.key]}
                label={item.title}
                onToggle={() =>
                  setToggles((current) => ({ ...current, [item.key]: !current[item.key] }))
                }
              />
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
