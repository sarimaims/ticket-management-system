"use client";

import { useState } from "react";
import { Eye, EyeOff, Lock, Phone, ShieldCheck } from "lucide-react";

import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { RoleTag } from "@/components/ui/badge";
import { useAuth } from "@/components/auth/auth-provider";
import { useToast } from "@/components/ui/toast";
import { avatarTone, changePassword, changePhone, initials, ROLE_LABEL } from "@/lib/auth";
import { formatPhone } from "@/lib/phone";
import { errorMessage } from "@/lib/api";

/** The same floor the API enforces, said out loud before it is hit. */
const MIN_PASSWORD = 8;

/**
 * The head of a card: what it is, and one line on why.
 *
 * A small capitalised label rather than a heading in a tinted icon tile - on a
 * page of three cards the tiles were the loudest thing on screen, and none of
 * them was the point.
 */
function CardHead({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="border-b border-line px-3.5 py-2.5">
      <h2 className="text-[10px] font-semibold tracking-[0.08em] text-ink-400 uppercase">
        {title}
      </h2>
      {children && (
        <p className="mt-1 text-[11px] leading-snug text-ink-500">{children}</p>
      )}
    </div>
  );
}

/** A label above a group of things, at the size of a card's own. */
function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-semibold tracking-[0.08em] text-ink-400 uppercase">
      {children}
    </p>
  );
}

/** A footer holding one action, and the one caveat worth printing beside it. */
function CardFoot({
  note,
  children,
}: {
  note?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-line px-3.5 py-2.5">
      {note ? (
        <p className="flex items-center gap-1.5 text-[11px] text-ink-400">
          {note}
        </p>
      ) : (
        <span />
      )}
      {children}
    </div>
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
        icon={<Lock className="text-ink-400" />}
        placeholder={shown ? undefined : "••••••••"}
        value={value}
        invalid={Boolean(error)}
        onChange={(event) => onChange(event.target.value)}
        trailing={
          <button
            type="button"
            onClick={() => setShown((current) => !current)}
            className="grid size-5 place-items-center rounded text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700"
            aria-label={
              shown
                ? `Hide ${label.toLowerCase()}`
                : `Show ${label.toLowerCase()}`
            }
          >
            {shown ? (
              <EyeOff className="size-3.5" />
            ) : (
              <Eye className="size-3.5" />
            )}
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

  const edit =
    (setter: (value: string) => void, key: string) => (value: string) => {
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
    else if (next.length < MIN_PASSWORD)
      found.next = `At least ${MIN_PASSWORD} characters.`;
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
      toast.success(
        "Password changed",
        "Use the new one the next time you sign in.",
      );
    } catch (caught) {
      const message = errorMessage(caught);
      // The API only rejects the current password once it has checked the
      // hash, so that answer belongs on that field rather than in a toast.
      setErrors(/current password/i.test(message) ? { current: message } : {});
      if (!/current password/i.test(message))
        toast.error("Could not change your password", message);
    } finally {
      setPending(false);
    }
  };

  return (
    <Card className="overflow-hidden">
      <CardHead title="Password">
        Your current one is asked for as well, so an unattended screen cannot
        lock you out.
      </CardHead>

      <form onSubmit={submit}>
        {/* Three boxes on one line on a wide screen: they are filled in one
            pass, and stacking them made a short form look like a long one. */}
        <div className="grid gap-x-3 gap-y-2.5 px-3.5 py-3 lg:grid-cols-3">
          <SecretField
            id="current-password"
            label="Current password"
            autoComplete="current-password"
            value={current}
            onChange={edit(setCurrent, "current")}
            error={errors.current}
          />

          <SecretField
            id="new-password"
            label="New password"
            hint={`(min ${MIN_PASSWORD})`}
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

        <CardFoot
          note={
            <>
              <ShieldCheck className="size-3.5 shrink-0" />
              You stay signed in on this device.
            </>
          }
        >
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Changing..." : "Change password"}
          </Button>
        </CardFoot>
      </form>
    </Card>
  );
}

/**
 * Your own number, in place.
 *
 * Set it once and it can be changed as often as you like; what it cannot be is
 * emptied. Colleagues are given this number on every ticket you raise, so an
 * account that can quietly blank it is an account nobody can reach - and the
 * button that would do it is simply not here, rather than being offered and
 * refused.
 */
function PhoneLine() {
  const { session, setSession } = useAuth();
  const toast = useToast();

  const current = session?.phone ?? "";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(current);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const open = () => {
    setDraft(current);
    setError("");
    setEditing(true);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!draft.trim()) {
      setError("A number cannot be removed, only changed.");
      return;
    }

    setPending(true);
    try {
      const saved = await changePhone(draft.trim());
      setSession(saved);
      setEditing(false);
      toast.success("Phone number saved", formatPhone(saved.phone));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  };

  if (!editing) {
    return (
      <p className="flex items-center gap-1.5 truncate text-[11px] text-ink-400">
        <Phone className="size-3 shrink-0" />
        {formatPhone(current) || "No phone number yet"}
        <button
          type="button"
          onClick={open}
          className="rounded px-1 font-semibold text-brand-600 transition-colors hover:bg-brand-50"
        >
          {current ? "Change" : "Add"}
        </button>
      </p>
    );
  }

  return (
    <form className="mt-1 flex items-start gap-1.5" onSubmit={submit}>
      <span className="min-w-0 flex-1">
        <Input
          autoFocus
          id="profile-phone"
          className="h-8 text-[12px]"
          inputMode="tel"
          placeholder="+971 50 123 4567"
          aria-label="Your phone number"
          value={draft}
          invalid={Boolean(error)}
          onChange={(event) => {
            setDraft(event.target.value);
            setError("");
          }}
        />
        {error && <span className="mt-0.5 block text-[10px] font-medium text-brand-600">{error}</span>}
      </span>

      <Button type="submit" size="sm" className="h-8 shrink-0" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-8 shrink-0"
        onClick={() => setEditing(false)}
        disabled={pending}
      >
        Cancel
      </Button>
    </form>
  );
}

export function SettingsForm() {
  const { session } = useAuth();

  const name = session?.name ?? "";
  const email = session?.email ?? "";
  const memberships = session?.departments ?? [];

  return (
    // One column, held to a readable width and centred: with the notification
    // switches gone there is one thing to do on this page, and a full-width
    // sheet of cards made it look like there were several.
    <div className="mx-auto w-full max-w-2xl space-y-3">
      {/* Who you are, rather than a form for it. Name, email and membership are
          all set by an admin - the boxes that used to be here had nowhere to
          save to, and a Save button that does nothing is worse than none. */}
      <Card className="overflow-hidden">
        <div className="flex items-center gap-3 px-3.5 py-3">
          <Avatar
            initials={initials(name)}
            tone={avatarTone(session)}
            className="size-10 text-[13px]"
          />
          <div className="min-w-0 flex-1">
            <Eyebrow>Profile</Eyebrow>
            <p className="mt-0.5 truncate text-[14px] leading-tight font-bold text-ink-900">
              {name || "Your account"}
            </p>
            <p className="truncate text-[11px] text-ink-400">{email}</p>
            {/* The number colleagues are given when a ticket has to be
                chased off the thread. Yours to set and to change. */}
            <PhoneLine />
          </div>
          {session?.role && (
            <span className="shrink-0 rounded bg-ink-100 px-1.5 py-0.5 text-[11px] font-semibold text-ink-600">
              {ROLE_LABEL[session.role]}
            </span>
          )}
        </div>

        <div className="border-t border-line px-3.5 py-2.5">
          <div className="flex items-baseline justify-between gap-3">
            <Eyebrow>Departments</Eyebrow>
            <span className="text-[10px] text-ink-300">set by your head</span>
          </div>

          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {memberships.length === 0 ? (
              <span className="text-[12px] text-ink-400">Not in a department yet</span>
            ) : (
              memberships.map((item) => (
                <span
                  key={item.id}
                  className="inline-flex items-center gap-1.5 rounded-md border border-line bg-ink-50 py-1 pr-1 pl-2 text-[11px] font-semibold text-ink-700"
                >
                  {item.name ?? "Department"}
                  <RoleTag role={item.role} />
                </span>
              ))
            )}
          </div>
        </div>

        <p className="border-t border-line px-3.5 py-2 text-[11px] text-ink-400">
          Your name, email and phone number appear on every ticket you raise. The number is
          yours to keep current; ask an admin to change your name or email.
        </p>
      </Card>

      <PasswordCard />
    </div>
  );
}
