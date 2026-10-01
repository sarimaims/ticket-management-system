"use client";

import { useEffect } from "react";
import { Mail, Phone, X } from "lucide-react";

import { Avatar } from "@/components/ui/avatar";
import {
  Contact,
  DepartmentList,
  Fact,
  Standing,
  STATUS_LABEL,
} from "@/components/users/user-profile";
import { avatarTone, initials } from "@/lib/auth";
import { formatPhone } from "@/lib/phone";
import type { DirectoryUser } from "@/lib/users";
import { cn, formatDateOf } from "@/lib/utils";

/**
 * Everything about one member of the team, beside the list rather than over it.
 *
 * The table keeps to what is compared down a column - title, department, unit,
 * phone, standing - and the rest lives here. Kept mounted and slid out rather
 * than removed, so it leaves the way it came in; the last person shown stays
 * in it while it goes.
 */
export function MemberSheet({
  user,
  open,
  isSelf,
  onClose,
}: {
  user: DirectoryUser | null;
  open: boolean;
  isSelf?: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-40 bg-ink-900/30" onClick={onClose} aria-hidden="true" data-scroll-lock />
      )}

      <aside
        aria-hidden={!open}
        aria-label={user ? `${user.name}'s details` : "Member details"}
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex w-full max-w-[23rem] flex-col border-l border-line bg-surface shadow-2xl shadow-ink-900/10 transition-transform duration-200",
          open ? "translate-x-0" : "translate-x-full",
        )}
      >
        {user && (
          <>
            <div className="flex items-center gap-3 border-b border-line px-3.5 py-3">
              <Avatar
                initials={initials(user.name)}
                tone={avatarTone(user)}
                className="size-11 text-[14px]"
              />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-[14px] leading-tight font-semibold text-ink-900">
                  <span className="truncate">{user.name}</span>
                  {isSelf && (
                    <span className="shrink-0 rounded bg-ink-100 px-1 py-px text-[9px] font-bold tracking-wide text-ink-600 uppercase">
                      You
                    </span>
                  )}
                </p>
                <Standing user={user} className="mt-1" />
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="grid size-6 shrink-0 place-items-center self-start rounded-md text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {/* How to reach them first: it is what this is most often opened for. */}
              <section className="border-b border-line px-3.5 py-1.5">
                <Contact
                  icon={<Phone />}
                  value={formatPhone(user.phone)}
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
              </section>

              <section className="border-b border-line px-3.5 py-2.5">
                <p className="mb-1.5 text-[10px] tracking-[0.06em] text-ink-400 uppercase">
                  Departments
                </p>
                <DepartmentList user={user} />
              </section>

              <section className="grid grid-cols-3 gap-3 px-3.5 py-2.5">
                <Fact label="Status" value={STATUS_LABEL[user.status]} />
                <Fact label="Joined" value={formatDateOf(user.createdAt)} />
                <Fact label="Last active" value={formatDateOf(user.lastActiveAt)} />
              </section>
            </div>
          </>
        )}
      </aside>
    </>
  );
}
