"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Building2, Check, Copy, Mail, Phone, X } from "lucide-react";

import { Avatar } from "@/components/ui/avatar";
import { OriginTag, RoleTag } from "@/components/ui/badge";
import { avatarTone, initials, ROLE_LABEL } from "@/lib/auth";
import { errorMessage } from "@/lib/api";
import { formatPhone } from "@/lib/phone";
import { getUserProfile, type DirectoryUser } from "@/lib/users";
import { cn, formatDateOf } from "@/lib/utils";

/**
 * Anybody's card, from anywhere their name is printed.
 *
 * Opened by id rather than handed an object: the same name appears in a
 * directory row that has everything about the person and on a ticket that has
 * only their name, and both should open the same card. One provider holds the
 * open card so a page with fifty names still has one dialog in it.
 */
type Opener = (id: string, name?: string) => void;

const ProfileContext = createContext<Opener | null>(null);

export function UserProfileProvider({ children }: { children: React.ReactNode }) {
  const [shown, setShown] = useState<{ id: string; name?: string } | null>(null);

  const open = useCallback<Opener>((id, name) => setShown({ id, name }), []);
  const close = useCallback(() => setShown(null), []);

  return (
    <ProfileContext.Provider value={open}>
      {children}
      {shown && (
        // Keyed by who it is: opening a second person starts a fresh card
        // rather than showing the first one's details under a new name.
        <ProfileCard key={shown.id} id={shown.id} name={shown.name} onClose={close} />
      )}
    </ProfileContext.Provider>
  );
}

/** Opens somebody's card. Outside the provider it is a no-op, never a crash. */
export function useUserProfile(): Opener {
  const open = useContext(ProfileContext);
  return open ?? (() => {});
}

/**
 * A name that can be opened.
 *
 * Underlined on hover so it reads as something to click before it is clicked,
 * and the click is kept off whatever is behind it - most of these names sit
 * inside a row that opens something else.
 */
export function UserLink({
  id,
  name,
  className,
}: {
  id?: string | null;
  name: React.ReactNode;
  className?: string;
}) {
  const open = useUserProfile();

  if (!id) return <span className={className}>{name}</span>;

  return (
    <button
      type="button"
      title="See profile"
      onClick={(event) => {
        event.stopPropagation();
        event.preventDefault();
        open(id, typeof name === "string" ? name : undefined);
      }}
      className={cn(
        "cursor-pointer text-left underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none",
        className,
      )}
    >
      {name}
    </button>
  );
}

/* ----------------------------------------------------------------- card */

/**
 * Their standing as a badge, then what they do - the line under a name.
 *
 * A manager's title is their own; a member goes by the role they lead with,
 * and every other role is listed wherever the rest of the person is.
 */
export function Standing({ user, className }: { user: DirectoryUser; className?: string }) {
  const manager = user.role === "superadmin" || user.role === "admin";
  const primary = user.departments.find((item) => item.role === "head") ?? user.departments[0];
  const title = manager ? user.designation : primary?.designation || user.designation;

  return (
    <p className={cn("flex min-w-0 items-center gap-1.5", className)}>
      {manager ? (
        <OriginTag role={user.role} className="shrink-0 rounded px-1.5 py-px text-[9.5px]" />
      ) : (
        primary && (
          <RoleTag
            role={primary.role}
            className="shrink-0 px-1.5 py-px text-[9.5px] font-bold tracking-wide uppercase"
          />
        )
      )}
      <span className="min-w-0 truncate text-[12px] text-ink-500">
        {title || (manager ? "" : ROLE_LABEL[user.role])}
      </span>
    </p>
  );
}

/** Every role somebody holds: department and standing, then title and unit. */
export function DepartmentList({ user }: { user: DirectoryUser }) {
  if (user.departments.length === 0) {
    return (
      <p className="text-[12px] text-ink-400">
        {user.role === "user" ? "Not in a department" : "Works across every department"}
      </p>
    );
  }

  return (
    <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
      {user.departments.map((item) => (
        <li key={item.id} className="flex items-center gap-2 px-2.5 py-1.5">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] font-semibold text-ink-800">
              {item.name ?? "Department"}
            </p>
            <p className="flex min-w-0 items-center gap-1 text-[11px] text-ink-500">
              {item.designation && <span className="truncate">{item.designation}</span>}
              {item.designation && item.unit?.name && (
                <span aria-hidden className="text-ink-300">·</span>
              )}
              {item.unit?.name && (
                <span className="inline-flex shrink-0 items-center gap-1 text-ink-400">
                  <Building2 className="size-3" />
                  {item.unit.name}
                </span>
              )}
            </p>
          </div>
          <RoleTag
            role={item.role}
            className="shrink-0 px-1.5 py-px text-[9.5px] font-bold tracking-wide uppercase"
          />
        </li>
      ))}
    </ul>
  );
}

/** One line of the card: an icon, what it is, and a way to take it away. */
export function Contact({
  icon,
  value,
  href,
  copy,
  missing,
}: {
  icon: React.ReactNode;
  value: string;
  href?: string;
  copy?: string;
  missing?: string;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <div className="flex items-center gap-2 py-1.5">
      <span className="grid size-6 shrink-0 place-items-center rounded-md bg-ink-50 text-ink-400 [&_svg]:size-3.5">
        {icon}
      </span>

      {value ? (
        <a
          href={href}
          className="min-w-0 flex-1 truncate text-[12px] font-semibold text-ink-800 hover:text-brand-600"
        >
          {value}
        </a>
      ) : (
        <span className="min-w-0 flex-1 truncate text-[12px] text-ink-400">{missing}</span>
      )}

      {value && copy && (
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(copy).then(() => setCopied(true));
          }}
          aria-label={copied ? "Copied" : "Copy"}
          className="grid size-6 shrink-0 place-items-center rounded-md text-ink-300 transition-colors hover:bg-ink-100 hover:text-ink-700"
        >
          {copied ? (
            <Check className="size-3.5 text-emerald-600" />
          ) : (
            <Copy className="size-3.5" />
          )}
        </button>
      )}
    </div>
  );
}

/** A fact under the card, said in as few words as it takes. */
export function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] tracking-[0.06em] text-ink-400 uppercase">{label}</p>
      <p className="mt-0.5 truncate text-[12px] font-semibold text-ink-800">{value}</p>
    </div>
  );
}

export const STATUS_LABEL: Record<DirectoryUser["status"], string> = {
  active: "Active",
  invited: "Invited",
  suspended: "Suspended",
};

function ProfileCard({
  id,
  name,
  onClose,
}: {
  id: string;
  name?: string;
  onClose: () => void;
}) {
  const [user, setUser] = useState<DirectoryUser | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    getUserProfile(id, controller.signal)
      .then(setUser)
      .catch((caught) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setError(errorMessage(caught));
      });

    return () => controller.abort();
  }, [id]);

  useEffect(() => {
    // Captured and stopped, so a sheet or a modal behind this one does not
    // close along with it.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  const shownName = user?.name ?? name ?? "";
  const phone = formatPhone(user?.phone);

  return createPortal(
    <div className="fixed inset-0 z-[70] grid place-items-center p-4">
      <div className="absolute inset-0 bg-ink-900/40" onClick={onClose} aria-hidden="true" />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={shownName ? `${shownName}'s profile` : "Profile"}
        className="relative w-full max-w-[21rem] overflow-hidden rounded-xl border border-line bg-surface shadow-2xl shadow-ink-900/20"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-2.5 right-2.5 grid size-6 place-items-center rounded-md text-ink-300 transition-colors hover:bg-ink-100 hover:text-ink-700"
        >
          <X className="size-3.5" />
        </button>

        {/* Who it is. The name is there from the click, so the card never
            opens blank while the rest of it is on its way. */}
        <div className="flex items-center gap-3 px-3.5 py-3">
          <Avatar
            initials={initials(shownName || "?")}
            tone={avatarTone(user)}
            className="size-11 text-[14px]"
          />
          <div className="min-w-0 flex-1 pr-6">
            <p className="truncate text-[14px] leading-tight font-semibold text-ink-900">
              {shownName || "Profile"}
            </p>
            {/* The same line the sidebar shows. */}
            {user ? (
              <Standing user={user} className="mt-1" />
            ) : (
              <p className="mt-1 text-[11px] text-ink-400">Loading…</p>
            )}
          </div>
        </div>

        {error ? (
          <p className="border-t border-line px-3.5 py-3 text-[12px] text-brand-600">{error}</p>
        ) : !user ? (
          <div className="border-t border-line px-3.5 py-3">
            <div className="space-y-2">
              <span className="block h-3 w-2/3 animate-pulse rounded bg-ink-100" />
              <span className="block h-3 w-1/2 animate-pulse rounded bg-ink-100" />
              <span className="block h-3 w-3/4 animate-pulse rounded bg-ink-100" />
            </div>
          </div>
        ) : (
          <>
            {/* How to reach them, which is what this card is chiefly for. */}
            <div className="border-t border-line px-3.5 py-1.5">
              <Contact
                icon={<Phone />}
                value={phone}
                href={`tel:${user.phone}`}
                copy={user.phone}
                missing="No phone number yet"
              />
              <Contact
                icon={<Mail />}
                value={user.email}
                href={`mailto:${user.email}`}
                copy={user.email}
              />
            </div>

            <div className="border-t border-line px-3.5 py-2.5">
              <p className="mb-1.5 text-[10px] tracking-[0.06em] text-ink-400 uppercase">
                Departments
              </p>
              <DepartmentList user={user} />
            </div>

            <div className="grid grid-cols-3 gap-3 border-t border-line px-3.5 py-2.5">
              <Fact label="Status" value={STATUS_LABEL[user.status]} />
              <Fact label="Joined" value={formatDateOf(user.createdAt)} />
              <Fact label="Last active" value={formatDateOf(user.lastActiveAt)} />
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
