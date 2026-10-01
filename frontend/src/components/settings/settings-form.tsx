"use client";

import { useState } from "react";
import {
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Mail,
  Pencil,
  Phone,
  ShieldCheck,
  UserRound,
} from "lucide-react";

import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { PhoneInput } from "@/components/ui/phone-input";
import { RoleTag } from "@/components/ui/badge";
import { useAuth } from "@/components/auth/auth-provider";
import { useToast } from "@/components/ui/toast";
import { WorkEmailInput } from "@/components/ui/work-email-input";
import {
  avatarTone,
  changeName,
  changePassword,
  changePhone,
  initials,
  isAdmin,
  isSuperAdmin,
  ROLE_LABEL,
  updateOwnProfile,
} from "@/lib/auth";
import { formatPhone, isPhone, PHONE_HELP, toStoredPhone } from "@/lib/phone";
import { errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";

/** The same floor the API enforces, said out loud before it is hit. */
const MIN_PASSWORD = 8;

/** A label above a group of things, at the size of a card's own. */
function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-semibold tracking-[0.08em] text-ink-400 uppercase">
      {children}
    </p>
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
function PasswordForm({ onClose }: { onClose: () => void }) {
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
      toast.success(
        "Password changed",
        "Use the new one the next time you sign in.",
      );
      onClose();
    } catch (caught) {
      const message = errorMessage(caught);
      // The API only rejects the current password once it has checked the
      // hash, so that answer belongs on that field rather than in a toast.
      setErrors(/current password/i.test(message) ? { current: message } : {});
      if (!/current password/i.test(message))
        toast.error("Could not change your password", message);
      setPending(false);
    }
  };

  return (
    <form className="space-y-3.5" onSubmit={submit} noValidate>
      <SecretField
        id="current-password"
        label="Current password"
        autoComplete="current-password"
        value={current}
        onChange={edit(setCurrent, "current")}
        error={errors.current}
      />

      {/* The new one and its repeat side by side: they are typed as a pair. */}
      <div className="grid gap-3.5 sm:grid-cols-2">
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

      <div className="flex items-center justify-between gap-3 border-t border-line pt-3.5">
        <p className="flex items-center gap-1.5 text-[11px] text-ink-400">
          <ShieldCheck className="size-3.5 shrink-0" />
          You stay signed in on this device.
        </p>
        <div className="flex shrink-0 gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Changing…" : "Change password"}
          </Button>
        </div>
      </div>
    </form>
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

/** The same ceiling the API and the model enforce. */
const MAX_NAME = 80;

/**
 * Your name, in place - for the super admin and admins.
 *
 * Everybody else's name is set by an admin, so for them this is plain text
 * with no button. A manager has nobody above them to ask, so theirs can be
 * corrected here; like the phone number, it can be changed but not emptied.
 */
function NameLine() {
  const { session, setSession } = useAuth();
  const toast = useToast();

  const current = session?.name ?? "";
  const editable = isAdmin(session);
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

    const next = draft.trim();
    if (!next) {
      setError("A name cannot be removed, only changed.");
      return;
    }
    if (next.length > MAX_NAME) {
      setError(`At most ${MAX_NAME} characters.`);
      return;
    }
    if (next === current) {
      setEditing(false);
      return;
    }

    setPending(true);
    try {
      const saved = await changeName(next);
      setSession(saved);
      setEditing(false);
      toast.success("Name saved", saved.name);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  };

  if (!editing) {
    return (
      <p className="mt-0.5 flex items-center gap-1.5 text-[14px] leading-tight font-bold text-ink-900">
        <span className="truncate">{current || "Your account"}</span>
        {editable && (
          <button
            type="button"
            onClick={open}
            className="shrink-0 rounded px-1 text-[11px] font-semibold text-brand-600 transition-colors hover:bg-brand-50"
          >
            Edit
          </button>
        )}
      </p>
    );
  }

  return (
    <form className="mt-1 flex items-start gap-1.5" onSubmit={submit}>
      <span className="min-w-0 flex-1">
        <Input
          autoFocus
          id="profile-name"
          className="h-8 text-[12px]"
          autoComplete="name"
          maxLength={MAX_NAME}
          aria-label="Your name"
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

type AccountTab = "profile" | "password";

const ACCOUNT_TABS: Record<AccountTab, { label: string; title: string; description: string }> = {
  profile: {
    label: "Profile",
    title: "Edit profile",
    description: "How you appear on every ticket, and the address you sign in with.",
  },
  password: {
    label: "Password",
    title: "Change password",
    description:
      "Your current one is asked for as well, so an unattended screen cannot lock you out.",
  },
};

/**
 * Everything about your own account that is yours to change, in one place.
 *
 * The super admin edits their whole profile here - name, designation, email
 * and phone - with the password one tab along. Everybody else edits their
 * name and number in place on the page, so for them this opens on the
 * password alone and shows no tabs at all: a tab strip with one tab in it is
 * a label pretending to be a choice.
 *
 * Mounted fresh on every open, so a half-typed password never waits in a
 * closed modal for the next person at the screen.
 */
function AccountModal({
  start,
  withProfile,
  onClose,
}: {
  start: AccountTab;
  withProfile: boolean;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<AccountTab>(withProfile ? start : "password");
  const tabs: AccountTab[] = withProfile ? ["profile", "password"] : ["password"];

  return (
    <Modal
      open
      onClose={onClose}
      title={ACCOUNT_TABS[tab].title}
      description={ACCOUNT_TABS[tab].description}
      className="max-w-md"
    >
      {tabs.length > 1 && (
        <div
          role="tablist"
          aria-label="Account"
          className="mb-3.5 grid grid-cols-2 gap-0.5 rounded-lg bg-ink-100 p-0.5"
        >
          {tabs.map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={tab === item}
              onClick={() => setTab(item)}
              className={cn(
                "inline-flex items-center justify-center gap-1.5 rounded-md py-1.5 text-[12px] font-semibold transition-colors",
                tab === item
                  ? "bg-surface text-ink-900 shadow-sm"
                  : "text-ink-500 hover:text-ink-800",
              )}
            >
              {item === "profile" ? (
                <UserRound className="size-3.5" />
              ) : (
                <KeyRound className="size-3.5" />
              )}
              {ACCOUNT_TABS[item].label}
            </button>
          ))}
        </div>
      )}

      {tab === "profile" ? <ProfileForm onClose={onClose} /> : <PasswordForm onClose={onClose} />}
    </Modal>
  );
}

/**
 * The super admin's whole profile in one form: name, designation, email and
 * phone. Everybody else has some of these set by an admin; the super admin has
 * nobody above them to ask.
 *
 * The current password is asked for only once the email is changed - that is
 * what the account signs in with - and not for a new title or number.
 */
function ProfileForm({ onClose }: { onClose: () => void }) {
  const { session, setSession } = useAuth();
  const toast = useToast();

  const [name, setName] = useState(session?.name ?? "");
  const [title, setTitle] = useState(session?.designation ?? "");
  const [email, setEmail] = useState(session?.email ?? "");
  const [phone, setPhone] = useState(session?.phone ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const emailChanged = email.toLowerCase() !== (session?.email ?? "").toLowerCase();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!name.trim()) return setError("Enter your name.");
    if (name.trim().length > MAX_NAME) return setError(`Name: at most ${MAX_NAME} characters.`);
    if (title.trim().length < 2) return setError("Enter your designation.");
    if (!email) return setError("Enter your email.");
    // A number, once set, can be changed but not emptied.
    if (phone.trim() && !isPhone(phone)) return setError(PHONE_HELP);
    if (!phone.trim() && session?.phone) return setError("A phone number cannot be removed, only changed.");
    if (emailChanged && !password) return setError("Enter your current password to change your email.");

    const changes: Parameters<typeof updateOwnProfile>[0] = {};
    if (name.trim() !== session?.name) changes.name = name.trim();
    if (title.trim() !== (session?.designation ?? "")) changes.designation = title.trim();
    if (phone.trim() && toStoredPhone(phone) !== (session?.phone ?? "")) {
      changes.phone = toStoredPhone(phone);
    }
    if (emailChanged) {
      changes.email = email;
      changes.currentPassword = password;
    }
    if (Object.keys(changes).length === 0) return onClose();

    setPending(true);
    try {
      const saved = await updateOwnProfile(changes);
      setSession(saved);
      toast.success(
        "Profile saved",
        emailChanged ? `Sign in with ${saved.email} from now on.` : undefined,
      );
      onClose();
    } catch (caught) {
      setError(errorMessage(caught));
      setPending(false);
    }
  };

  const edit = (setter: (value: string) => void) => (value: string) => {
    setter(value);
    setError("");
  };

  return (
    <form className="space-y-3.5" onSubmit={submit} noValidate>
      {error && (
        <p
          role="alert"
          className="rounded-md border border-brand-200 bg-brand-50 px-3 py-2 text-[12px] font-medium text-brand-700"
        >
          {error}
        </p>
      )}

      <div className="grid gap-3.5 sm:grid-cols-2">
        <Field label="Full name" required htmlFor="profile-name">
          <Input
            id="profile-name"
            autoComplete="name"
            maxLength={MAX_NAME}
            value={name}
            onChange={(event) => edit(setName)(event.target.value)}
          />
        </Field>

        <Field label="Designation" required htmlFor="profile-designation">
          <Input
            id="profile-designation"
            maxLength={80}
            placeholder="e.g. Chief Executive Officer"
            value={title}
            onChange={(event) => edit(setTitle)(event.target.value)}
          />
        </Field>

        <Field label="Email" required htmlFor="profile-email">
          <WorkEmailInput id="profile-email" value={email} onChange={edit(setEmail)} />
        </Field>

        <Field label="Phone number" htmlFor="profile-phone">
          <PhoneInput
            id="profile-phone"
            placeholder="+971 50 123 4567"
            value={phone}
            onChange={edit(setPhone)}
          />
        </Field>
      </div>

      {/* Only when it is needed: a new sign-in address. */}
      {emailChanged && (
        <Field
          label="Current password"
          required
          hint="(to change your email)"
          htmlFor="profile-current-password"
        >
          <Input
            id="profile-current-password"
            type="password"
            autoComplete="current-password"
            icon={<Lock className="text-ink-400" />}
            value={password}
            onChange={(event) => edit(setPassword)(event.target.value)}
          />
        </Field>
      )}

      <div className="flex justify-end gap-2 border-t border-line pt-3.5">
        <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save profile"}
        </Button>
      </div>
    </form>
  );
}

/**
 * One value on a membership row. On a phone the column heading is gone, so
 * each value carries its own small label; on a wide screen the heading above
 * says it once.
 */
function MembershipCell({
  label,
  strong = false,
  className,
  children,
}: {
  label: string;
  strong?: boolean;
  /** Where it sits in the row's grid. */
  className?: string;
  children: React.ReactNode;
}) {
  // Written out in full: a title cut to "Digital Marketing Mana..." says less
  // than the two lines it would take to show it.
  return (
    <span className={cn("min-w-0", className)}>
      <span className="block text-[9.5px] font-semibold tracking-[0.06em] text-ink-400 uppercase sm:hidden">
        {label}
      </span>
      <span
        className={cn(
          "block text-[12.5px] leading-snug break-words",
          strong ? "font-semibold text-ink-900" : "font-medium text-ink-700",
        )}
      >
        {children}
      </span>
    </span>
  );
}

export function SettingsForm() {
  const { session } = useAuth();
  // Which tab the account modal opens on, or null while it is closed.
  const [account, setAccount] = useState<AccountTab | null>(null);
  const owner = isSuperAdmin(session);
  const manager = isAdmin(session);

  const name = session?.name ?? "";
  const memberships = session?.departments ?? [];

  return (
    // One column, held to a readable width and centred: with the notification
    // switches gone there is one thing to do on this page, and a full-width
    // sheet of cards made it look like there were several.
    <div className="mx-auto w-full max-w-2xl space-y-3">
      {/* Who you are, rather than a form for it. Email and membership are set
          by an admin, and so is a member's name - the boxes that used to be
          here had nowhere to save to, and a Save button that does nothing is
          worse than none. A manager's name and everyone's phone edit in place. */}
      <Card className="overflow-hidden">
        <div className="flex items-center gap-3 px-3.5 py-3">
          <Avatar
            initials={initials(name)}
            tone={avatarTone(session)}
            className="size-10 text-[13px]"
          />
          <div className="min-w-0 flex-1">
            <Eyebrow>Profile</Eyebrow>
            {owner ? (
              // Everything edits in one form, so no links scattered per line.
              <>
                <p className="mt-0.5 truncate text-[14px] leading-tight font-bold text-ink-900">
                  {name || "Your account"}
                </p>
                {session?.designation && (
                  <p className="truncate text-[12px] font-medium text-ink-600">
                    {session.designation}
                  </p>
                )}
                <p className="flex items-center gap-1.5 truncate text-[11px] text-ink-400">
                  <Mail className="size-3 shrink-0" />
                  <span className="truncate">{session?.email}</span>
                </p>
                <p className="flex items-center gap-1.5 truncate text-[11px] text-ink-400">
                  <Phone className="size-3 shrink-0" />
                  {formatPhone(session?.phone) || "No phone number yet"}
                </p>
              </>
            ) : (
              <>
                <NameLine />
                {session?.designation && (
                  <p className="truncate text-[12px] font-medium text-ink-600">
                    {session.designation}
                  </p>
                )}
                <p className="flex items-center gap-1.5 truncate text-[11px] text-ink-400">
                  <Mail className="size-3 shrink-0" />
                  <span className="truncate">{session?.email}</span>
                </p>
                {/* The number colleagues are given when a ticket has to be
                    chased off the thread. Yours to set and to change. */}
                <PhoneLine />
              </>
            )}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2 self-start">
            {session?.role && (
              <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[11px] font-semibold text-ink-600">
                {ROLE_LABEL[session.role]}
              </span>
            )}
            {owner ? (
              <Button size="sm" variant="outline" onClick={() => setAccount("profile")}>
                <Pencil className="size-3.5" />
                Edit profile
              </Button>
            ) : (
              // Name and number edit in place; the password is the one thing
              // here that needs a form of its own.
              <Button size="sm" variant="outline" onClick={() => setAccount("password")}>
                <KeyRound className="size-3.5" />
                Change password
              </Button>
            )}
          </div>
        </div>

        <div className="border-t border-line px-3.5 py-2.5">
          <div className="flex items-baseline justify-between gap-3">
            <Eyebrow>Departments</Eyebrow>
            {!manager && <span className="text-[10px] text-ink-300">set by your head</span>}
          </div>

          {memberships.length === 0 ? (
            <p className="mt-1.5 text-[12px] text-ink-400">
              {/* A manager sits above the departments rather than in one. */}
              {manager ? "Works across every department" : "Not in a department yet"}
            </p>
          ) : (
            // One row per role: where it sits, what they are there, and their
            // standing. Laid out like a table so the three read down as
            // columns, without being one.
            <div className="mt-2 overflow-hidden rounded-lg border border-line">
              <div className="hidden grid-cols-[1fr_1.15fr_1.25fr_4.5rem] gap-3 border-b border-line bg-ink-50 px-3 py-1.5 text-[10px] font-semibold tracking-[0.06em] text-ink-400 uppercase sm:grid">
                <span>Unit</span>
                <span>Department</span>
                <span>Designation</span>
                <span className="text-right">Role</span>
              </div>
              <ul className="divide-y divide-line">
                {memberships.map((item) => (
                  <li
                    key={item.id}
                    className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1.5 px-3 py-2.5 sm:grid-cols-[1fr_1.15fr_1.25fr_4.5rem] sm:items-start"
                  >
                    {/* Pinned to their columns: on a phone the role rides on
                        the unit's line and the rest stack under it; on a wide
                        screen all four share one line. */}
                    <MembershipCell
                      label="Unit"
                      className="col-start-1 row-start-1 sm:col-start-1"
                    >
                      {item.unit?.name ?? "No unit"}
                    </MembershipCell>
                    <span className="col-start-2 row-start-1 justify-self-end sm:col-start-4">
                      <RoleTag role={item.role} />
                    </span>
                    <MembershipCell
                      label="Department"
                      strong
                      className="col-span-2 row-start-2 sm:col-span-1 sm:col-start-2 sm:row-start-1"
                    >
                      {item.name ?? "Department"}
                    </MembershipCell>
                    {/* Their title in this one: it can differ from the next. */}
                    <MembershipCell
                      label="Designation"
                      className="col-span-2 row-start-3 sm:col-span-1 sm:col-start-3 sm:row-start-1"
                    >
                      {item.designation || "Not set"}
                    </MembershipCell>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <p className="border-t border-line px-3.5 py-2 text-[11px] text-ink-400">
          {owner
            ? "Your name, designation, email and phone number appear on every ticket you raise. All of them are yours to keep current."
            : manager
              ? "Your name, email and phone number appear on every ticket you raise. The name and number are yours to keep current; your email is changed from the directory."
              : "Your name, email and phone number appear on every ticket you raise. The number is yours to keep current; ask an admin to change your name or email."}
        </p>
      </Card>

      {account && (
        <AccountModal
          key={account}
          start={account}
          withProfile={owner}
          onClose={() => setAccount(null)}
        />
      )}
    </div>
  );
}
