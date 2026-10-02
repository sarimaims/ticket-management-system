"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Building, ChevronUp, LogOut, UserRound } from "lucide-react";

import { Avatar } from "@/components/ui/avatar";
import { RoleTag } from "@/components/ui/badge";
import { useAuth } from "@/components/auth/auth-provider";
import { avatarTone, DEPARTMENT_ROLE_LABEL, initials, isAdmin, ROLE_LABEL } from "@/lib/auth";
import { cn } from "@/lib/utils";

/**
 * Who is signed in, parked at the foot of the sidebar the way a workspace app
 * does it: the account sits under the navigation it belongs to, and the menu
 * opens upward so it never covers the nav.
 */
export function SidebarProfile({
  onNavigate,
  collapsed = false,
}: {
  onNavigate?: () => void;
  /** The sidebar is folded to icons on a desktop: the avatar alone. */
  collapsed?: boolean;
}) {
  const { session, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (!session) return null;

  const name = session.name ?? "";
  const departments = session.departments ?? [];
  const manager = isAdmin(session);

  // Departments are listed under the unit they belong to, so the menu shows
  // the whole of where someone sits: unit, department, and role in it.
  const byUnit = new Map<string, { id: string; name: string; departments: typeof departments }>();
  for (const membership of departments) {
    const key = membership.unit?.id ?? "none";
    const group = byUnit.get(key) ?? {
      id: key,
      name: membership.unit?.name ?? "No unit",
      departments: [],
    };
    group.departments.push(membership);
    byUnit.set(key, group);
  }
  const units = [...byUnit.values()];

  /*
   * Under the name, one line: their standing as a badge, then what they do.
   * The badge is the system role for a manager and the department role for
   * everyone else, so the same words never appear twice on the button.
   *
   * The department leads with the one they head, across every unit. Several
   * read as the first and a count, and the unit rides along only when there
   * is more than one to tell apart.
   */
  const here = departments;
  const primary = here.find((item) => item.role === "head") ?? here[0];
  // What they are in *that* department, when it says; otherwise what the
  // account says about them in general.
  const designation =
    primary?.designation?.trim() || session.designation?.trim() || "";

  const place = primary
    ? [
        primary.name ?? "Department",
        here.length > 1 ? `+${here.length - 1}` : "",
        units.length > 1 ? `· ${primary.unit?.name ?? ""}` : "",
      ]
        .filter(Boolean)
        .join(" ")
    : "";

  // The tag beside the name: the system role for a manager, the department role for everyone else.
  const badgeLabel = manager
    ? ROLE_LABEL[session.role]
    : primary
      ? DEPARTMENT_ROLE_LABEL[primary.role]
      : "";
  // A line of its own for where they sit. A manager sits above departments.
  const department = manager ? "" : place || "Not in a department yet";

  const tooltip = [name, badgeLabel, designation, place].filter(Boolean).join(" · ");


  return (
    <div ref={root} className={cn("relative shrink-0 border-t border-line p-2.5", collapsed && "lg:px-1.5")}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={collapsed ? tooltip : undefined}
        className={cn(
          "flex w-full items-center gap-2 rounded-lg border p-1.5 text-left transition-colors",
          collapsed && "lg:justify-center",
          open
            ? "border-brand-200 bg-brand-50/60"
            : "border-transparent hover:border-line hover:bg-ink-50",
        )}
      >
        <Avatar initials={initials(name)} tone={avatarTone(session)} className="size-8 shrink-0" />

        {/* Name and where they sit, nothing else: the rest is one click
            away in the menu above. */}
        <span className={cn("min-w-0 flex-1", collapsed && "lg:hidden")} title={tooltip}>
          <span className="block truncate text-[13px] leading-tight font-semibold text-ink-900">
            {name}
          </span>
          <span className="mt-0.5 block truncate text-[11px] leading-tight text-ink-500">
            {manager ? badgeLabel : department}
          </span>
        </span>

        <ChevronUp
          className={cn(
            "size-4 shrink-0 text-ink-400 transition-transform",
            open && "rotate-180",
            collapsed && "lg:hidden",
          )}
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute bottom-full left-2.5 z-50 mb-1.5 w-[min(14rem,calc(100vw-1.5rem))] overflow-hidden rounded-lg border border-line bg-surface shadow-lg shadow-ink-900/10"
        >
          {/* Who this is: their picture, name and address, then what they do -
              labelled, so it reads as a fact about them rather than a line of
              small print. */}
          <div className="border-b border-line px-2.5 py-2.5">
            <div className="flex items-center gap-2.5">
              <Avatar
                initials={initials(name)}
                tone={avatarTone(session)}
                className="size-9 shrink-0 text-[12px]"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] leading-tight font-semibold text-ink-900">{name}</p>
                <p className="truncate text-[11px] leading-tight text-ink-400">{session.email}</p>
              </div>
            </div>

            <div className="mt-2 rounded-md bg-ink-50 px-2 py-1.5">
              <p className="text-[9.5px] font-bold tracking-[0.08em] text-ink-400 uppercase">
                Designation
              </p>
              <p
                className={cn(
                  "mt-0.5 text-[12px] leading-snug break-words",
                  designation ? "font-semibold text-ink-800" : "text-ink-400",
                )}
              >
                {designation || "Not set yet"}
              </p>
            </div>
          </div>

          {/* Where they sit: each unit, the departments in it, and what they are
              in each. Read-only - every list shows all of their units. */}
          {units.length > 0 && (
            <div className="max-h-56 overflow-y-auto border-b border-line py-1">
              <p className="px-2.5 pt-1 pb-0.5 text-[10px] font-bold tracking-wide text-ink-400 uppercase">
                Departments
              </p>

              {units.map((unit) => (
                <div key={unit.id} className="pb-0.5">
                  <p className="flex h-7 items-center gap-1.5 px-2.5 text-[12px] font-semibold text-ink-900">
                    <Building className="size-3.5 shrink-0 text-ink-400" />
                    <span className="min-w-0 flex-1 truncate">{unit.name}</span>
                  </p>

                  {unit.departments.map((membership) => (
                    <div
                      key={membership.id}
                      className="flex items-center gap-1.5 py-0.5 pr-2.5 pl-[1.65rem] text-[11px]"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-ink-600">
                          {membership.name ?? "Department"}
                        </span>
                        {membership.designation && (
                          <span className="block truncate text-[10px] leading-tight text-ink-400">
                            {membership.designation}
                          </span>
                        )}
                      </span>
                      <RoleTag role={membership.role} className="px-1 py-0 text-[9px]" />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          <div className="p-1">
            <Link
              href="/settings"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onNavigate?.();
              }}
              className="flex h-8 items-center gap-2 rounded-md px-2 text-[13px] font-medium text-ink-700 transition-colors hover:bg-ink-50"
            >
              {/* Your own page: who you are, how to reach you, your password. */}
              <UserRound className="size-4 text-ink-400" />
              Profile
            </Link>

            <button
              type="button"
              role="menuitem"
              onClick={signOut}
              className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-[13px] font-medium text-brand-600 transition-colors hover:bg-brand-50"
            >
              <LogOut className="size-4" />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
