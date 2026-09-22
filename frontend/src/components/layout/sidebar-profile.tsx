"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Building, Check, ChevronUp, Layers, LogOut, Settings } from "lucide-react";

import { Avatar } from "@/components/ui/avatar";
import { RoleTag } from "@/components/ui/badge";
import { useAuth } from "@/components/auth/auth-provider";
import { avatarTone, initials, isAdmin, ROLE_LABEL } from "@/lib/auth";
import {
  activeUnit,
  activeUnitOnServer,
  setActiveUnit,
  subscribeActiveUnit,
} from "@/lib/active-unit";
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
  const chosenUnit = useSyncExternalStore(
    subscribeActiveUnit,
    activeUnit,
    activeUnitOnServer,
  );

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

  /**
   * The unit they are working in. A stored choice only counts while they are
   * still in that unit - an admin moving them somewhere else must not leave
   * them looking at a unit they have left.
   */
  const viewing = units.find((unit) => unit.id === chosenUnit) ?? null;

  // The second line says where they are working right now: the unit in view,
  // then their rank, then where they work, then the address they signed in
  // with - whichever of those is the first that exists.
  const subtitle = viewing
    ? viewing.name
    : manager
      ? ROLE_LABEL[session.role]
      : units.length === 1
        ? units[0].name
        : units.length > 1
          ? `${units.length} units · ${departments.length} departments`
          : session.email;

  return (
    <div ref={root} className="relative shrink-0 border-t border-line p-2.5">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          "flex w-full items-center gap-2 rounded-lg border p-1.5 text-left transition-colors",
          open
            ? "border-brand-200 bg-brand-50/60"
            : "border-transparent hover:border-line hover:bg-ink-50",
        )}
      >
        <Avatar initials={initials(name)} tone={avatarTone(session)} className="size-8 shrink-0" />

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
          className="absolute bottom-full left-2.5 z-50 mb-1.5 w-[min(14rem,calc(100vw-1.5rem))] overflow-hidden rounded-lg border border-line bg-surface shadow-lg shadow-ink-900/10"
        >
          {/* Name and address only. The role badge that used to sit here said
              what the button below already says, and a pill on its own line is
              most of why the box was tall. */}
          <div className="border-b border-line px-2.5 py-2">
            <p className="truncate text-[13px] leading-tight font-semibold text-ink-900">{name}</p>
            <p className="truncate text-[11px] leading-tight text-ink-400">{session.email}</p>
          </div>

          {/* Which unit they are working in. Picking one narrows what they
              look at; it never widens what they may read, because every unit
              here is already one they belong to. */}
          {units.length > 0 && (
            <div className="border-b border-line py-1">
              <p className="px-2.5 pt-1 pb-0.5 text-[10px] font-bold tracking-wide text-ink-400 uppercase">
                Working in
              </p>

              {units.length > 1 && (
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={viewing === null}
                  onClick={() => setActiveUnit("")}
                  className={cn(
                    "flex h-7 w-full items-center gap-1.5 px-2.5 text-left text-[12px] font-semibold transition-colors",
                    viewing === null ? "text-brand-700" : "text-ink-700 hover:bg-ink-50",
                  )}
                >
                  <Layers className="size-3.5 shrink-0 text-ink-400" />
                  <span className="min-w-0 flex-1 truncate">All units</span>
                  {viewing === null && <Check className="size-3.5 shrink-0 text-brand-600" />}
                </button>
              )}

              {units.map((unit) => {
                const current = viewing?.id === unit.id;
                return (
                  <div key={unit.id} className="pb-0.5">
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={current}
                      onClick={() => setActiveUnit(current && units.length > 1 ? "" : unit.id)}
                      className={cn(
                        "flex h-7 w-full items-center gap-1.5 px-2.5 text-left text-[12px] font-semibold transition-colors",
                        current ? "bg-brand-50/60 text-brand-700" : "text-ink-900 hover:bg-ink-50",
                      )}
                    >
                      <Building
                        className={cn(
                          "size-3.5 shrink-0",
                          current ? "text-brand-600" : "text-ink-400",
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate">{unit.name}</span>
                      {current && <Check className="size-3.5 shrink-0 text-brand-600" />}
                    </button>

                    {unit.departments.map((membership) => (
                      <div
                        key={membership.id}
                        className="flex items-center gap-1.5 py-0.5 pr-2.5 pl-[1.65rem] text-[11px]"
                      >
                        <span className="min-w-0 flex-1 truncate text-ink-600">
                          {membership.name ?? "Department"}
                        </span>
                        <RoleTag role={membership.role} className="px-1 py-0 text-[9px]" />
                      </div>
                    ))}
                  </div>
                );
              })}

              {units.length > 1 && (
                <p className="px-2.5 pt-0.5 pb-1 text-[10px] leading-snug text-ink-400">
                  My Requests and Assigned to Me follow this.
                </p>
              )}
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
              <Settings className="size-4 text-ink-400" />
              Settings
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
