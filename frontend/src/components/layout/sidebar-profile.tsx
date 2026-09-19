"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Building, ChevronUp, LogOut, Settings, ShieldCheck } from "lucide-react";

import { Avatar } from "@/components/ui/avatar";
import { RoleTag } from "@/components/ui/badge";
import { useAuth } from "@/components/auth/auth-provider";
import { avatarTone, initials, isAdmin, ROLE_LABEL } from "@/lib/auth";
import { cn } from "@/lib/utils";

/**
 * Who is signed in, parked at the foot of the sidebar the way a workspace app
 * does it: the account sits under the navigation it belongs to, and the menu
 * opens upward so it never covers the nav.
 */
export function SidebarProfile({ onNavigate }: { onNavigate?: () => void }) {
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
  const byUnit = new Map<string, { name: string; departments: typeof departments }>();
  for (const membership of departments) {
    const key = membership.unit?.id ?? "none";
    const group = byUnit.get(key) ?? {
      name: membership.unit?.name ?? "No unit",
      departments: [],
    };
    group.departments.push(membership);
    byUnit.set(key, group);
  }
  const units = [...byUnit.values()];

  // The second line says what they are here: their rank if they have one,
  // otherwise where they work, falling back to the address they signed in with.
  const subtitle = manager
    ? ROLE_LABEL[session.role]
    : units.length === 1
      ? units[0].name
      : units.length > 1
        ? `${units.length} units · ${departments.length} departments`
        : session.email;

  return (
    <div ref={root} className="relative shrink-0 border-t border-line p-3">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-xl border p-2 text-left transition-colors",
          open
            ? "border-brand-200 bg-brand-50/60"
            : "border-transparent hover:border-line hover:bg-ink-50",
        )}
      >
        <Avatar initials={initials(name)} tone={avatarTone(session)} className="shrink-0" />

        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] leading-tight font-bold text-ink-900">
            {name}
          </span>
          <span className="block truncate text-[11px] leading-tight text-ink-400">{subtitle}</span>
        </span>

        <ChevronUp
          className={cn(
            "size-4 shrink-0 text-ink-400 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute bottom-full left-3 z-50 mb-2 w-[min(17.5rem,calc(100vw-1.5rem))] overflow-hidden rounded-card border border-line bg-surface shadow-xl shadow-ink-900/10"
        >
          <div className="border-b border-line px-3 py-2.5">
            <p className="truncate text-sm font-bold text-ink-900">{name}</p>
            <p className="truncate text-xs text-ink-500">{session.email}</p>
            {manager && (
              <span className="mt-2 inline-flex items-center gap-1 rounded-md bg-brand-50 px-2 py-0.5 text-[11px] font-bold text-brand-700">
                <ShieldCheck className="size-3" />
                {ROLE_LABEL[session.role]}
              </span>
            )}
          </div>

          {/* What they belong to, stated not chosen: every department they are
              in is in scope at all times. */}
          {units.length > 0 && (
            <div className="border-b border-line py-1.5">
              <p className="px-3 pt-1 pb-1 text-[11px] font-bold tracking-wide text-ink-400 uppercase">
                {units.length === 1 ? "Unit" : "Units"}
              </p>

              {units.map((unit) => (
                <div key={unit.name} className="pb-1">
                  <p className="flex items-center gap-1.5 px-3 py-1 text-[13px] font-bold text-ink-900">
                    <Building className="size-3.5 shrink-0 text-ink-400" />
                    <span className="min-w-0 truncate">{unit.name}</span>
                  </p>

                  {unit.departments.map((membership) => (
                    <div
                      key={membership.id}
                      className="flex items-center gap-2 py-1 pr-3 pl-[1.85rem] text-sm"
                    >
                      <span className="min-w-0 flex-1 truncate text-ink-700">
                        {membership.name ?? "Department"}
                      </span>
                      <RoleTag role={membership.role} className="px-1.5 py-0 text-[10px]" />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          <div className="p-1.5">
            <Link
              href="/settings"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onNavigate?.();
              }}
              className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-ink-700 transition-colors hover:bg-ink-50"
            >
              <Settings className="size-4.5 text-ink-400" />
              Settings
            </Link>

            <button
              type="button"
              role="menuitem"
              onClick={signOut}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-brand-600 transition-colors hover:bg-brand-50"
            >
              <LogOut className="size-4.5" />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
