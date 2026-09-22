"use client";

import { useState } from "react";
import { Building2, Eye, EyeOff, KeyRound, Lock, Mail, ShieldCheck, UserRound } from "lucide-react";

import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { RoleTag } from "@/components/ui/badge";
import { useAuth } from "@/components/auth/auth-provider";
import { useToast } from "@/components/ui/toast";
import { avatarTone, changePassword, initials } from "@/lib/auth";
import { errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";

/** The same floor the API enforces, said out loud before it is hit. */
const MIN_PASSWORD = 8;

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

/** One password box: its own eye, because they are filled at different times. */
function SecretField({
  id,
  label,
  hint,
  autoComplete,
  value,
  onChange,
  error,
}: {
  id: string;
  label: string;
  hint?: string;
  autoComplete: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
}) {
  const [shown, setShown] = useState(false);

  return (
    <Field label={label} required hint={hint} htmlFor={id} error={error}>
      <Input
        id={id}
        type={shown ? "text" : "password"}
        autoComplete={autoComplete}
        icon={<Lock className="text-ink-500" />}
        placeholder={shown ? undefined : "••••••••"}
        value={value}
        invalid={Boolean(error)}
        onChange={(event) => onChange(event.target.value)}
        trailing={
          <button
            type="button"
            onClick={() => setShown((current) => !current)}
            className="grid size-8 place-items-center rounded-lg text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700"
            aria-label={shown ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          >
            {shown ? <EyeOff className="size-4.5" /> : <Eye className="size-4.5" />}
          </button>
        }
      />
    </Field>
  );
}

/**
 * Changing your own password. Everything is checked here before the request is
 * made, so the only errors the API adds are the ones only it can know - chiefly
 * that the current password is wrong.
 */
function PasswordCard() {
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  const edit = (setter: (value: string) => void, key: string) => (value: string) => {
    setter(value);
    setErrors((current) => {
      if (!current[key]) return current;
      const rest = { ...current };
      delete rest[key];
      return rest;
    });
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();

    const found: Record<string, string> = {};
    if (!current) found.current = "Enter your current password.";
    if (!next) found.next = "Enter a new password.";
    else if (next.length < MIN_PASSWORD) found.next = `At least ${MIN_PASSWORD} characters.`;
    else if (next === current) found.next = "This is your current password.";
    if (!confirm) found.confirm = "Type the new password again.";
    else if (next && confirm !== next) found.confirm = "The two do not match.";

    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }

    setPending(true);
    try {
      await changePassword(current, next);
      setCurrent("");
      setNext("");
      setConfirm("");
      setErrors({});
      toast.success("Password changed", "Use the new one the next time you sign in.");
    } catch (caught) {
      const message = errorMessage(caught);
      // The API only rejects the current password once it has checked the
      // hash, so that answer belongs on that field rather than in a toast.
      setErrors(/current password/i.test(message) ? { current: message } : {});
      if (!/current password/i.test(message)) toast.error("Could not change your password", message);
    } finally {
      setPending(false);
    }
  };

  return (
    <Card className="p-5 sm:p-7 xl:col-span-2">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-ink-100 text-ink-600">
          <KeyRound className="size-4.5" />
        </span>
        <div>
          <h2 className="text-base font-bold text-ink-900">Password</h2>
          <p className="mt-0.5 text-sm text-ink-500">
            Your current one is asked for as well, so an unattended screen cannot lock you out.
          </p>
        </div>
      </div>

      <form className="mt-5 space-y-5" onSubmit={submit}>
        <div className="lg:max-w-sm">
          <SecretField
            id="current-password"
            label="Current password"
            autoComplete="current-password"
            value={current}
            onChange={edit(setCurrent, "current")}
            error={errors.current}
          />
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <SecretField
            id="new-password"
            label="New password"
            hint={`(at least ${MIN_PASSWORD} characters)`}
            autoComplete="new-password"
            value={next}
            onChange={edit(setNext, "next")}
            error={errors.next}
          />

          <SecretField
            id="confirm-password"
            label="Confirm new password"
            autoComplete="new-password"
            value={confirm}
            onChange={edit(setConfirm, "confirm")}
            error={errors.confirm}
          />
        </div>

        <div className="flex flex-col-reverse items-center gap-3 border-t border-line pt-5 sm:flex-row sm:justify-between">
          <p className="flex items-center gap-2 text-xs text-ink-400">
            <ShieldCheck className="size-4 shrink-0" />
            You stay signed in on this device.
          </p>
          <Button type="submit" disabled={pending}>
            {pending ? "Changing..." : "Change password"}
          </Button>
        </div>
      </form>
    </Card>
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

          {/* Membership is owned by the department head, so it is shown here,
              not edited here. */}
          <Field label="Departments" hint="(managed by your head)">
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

      <PasswordCard />
    </div>
  );
}
