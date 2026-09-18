"use client";

import { useEffect, useRef, useState } from "react";
import { Bell,
  Check, ChevronDown, LogOut, Menu, Settings, ShieldCheck } from "lucide-react";
import Link from "next/link";

import { Avatar } from "@/components/ui/avatar";
import { useAuth } from "@/components/auth/auth-provider";
import { usePageTitle } from "@/components/layout/page-title";
import { avatarTone, initials, isAdmin, ROLE_LABEL } from "@/lib/auth";
import { useActiveDepartment } from "@/components/layout/active-department";
import { RoleTag } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function Topbar({ onMenu }: { onMenu: () => void }) {
  const { session, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRoot = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!menuRoot.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [menuOpen]);

  const name = session?.name ?? "";
  const pageTitle = usePageTitle();
  const { active, departments, setActive } = useActiveDepartment();

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between gap-4 border-b border-line bg-surface px-4 sm:px-6 lg:px-8">
      <button
        type="button"
        onClick={onMenu}
        className="grid size-10 place-items-center rounded-lg text-ink-500 hover:bg-ink-50 lg:hidden"
        aria-label="Open navigation"
      >
        <Menu className="size-5" />
      </button>

      <h1 className="truncate text-lg font-bold tracking-tight text-ink-900">{pageTitle}</h1>

      <div className="ml-auto flex items-center gap-4">
        <button
          type="button"
          className="relative grid size-10 place-items-center rounded-lg text-ink-500 transition-colors hover:bg-ink-50 hover:text-ink-700"
          aria-label="Notifications, 3 unread"
        >
          <Bell className="size-5" />
          <span className="absolute top-1 right-1 grid size-4 place-items-center rounded-full bg-brand-600 text-[10px] font-bold text-white">
            3
          </span>
        </button>

        <span className="h-8 w-px bg-line" />

        <div ref={menuRoot} className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((current) => !current)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="flex items-center gap-2.5 rounded-lg py-1 pr-2 pl-1 transition-colors hover:bg-ink-50"
          >
            <Avatar initials={initials(name)} tone={avatarTone(session)} />
            <span className="hidden text-left sm:block">
              <span className="block text-sm leading-tight font-semibold text-ink-900">{name}</span>
              {departments.length > 0 && (
                <span className="block text-[11px] leading-tight text-ink-400">
                  {active ? active.name : "All departments"}
                </span>
              )}
            </span>
            <ChevronDown
              className={cn("size-4 text-ink-400 transition-transform", menuOpen && "rotate-180")}
            />
          </button>

          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 z-40 mt-2 w-64 rounded-field border border-line bg-surface p-1.5 shadow-xl shadow-ink-900/10"
            >
              <div className="border-b border-line px-3 py-2.5">
                <p className="truncate text-sm font-bold text-ink-900">{name}</p>
                <p className="truncate text-xs text-ink-500">{session?.email}</p>
                {isAdmin(session) && session && (
                  <span className="mt-2 inline-flex items-center gap-1 rounded-md bg-brand-50 px-2 py-0.5 text-[11px] font-bold text-brand-700">
                    <ShieldCheck className="size-3" />
                    {ROLE_LABEL[session.role]}
                  </span>
                )}
              </div>

              {departments.length > 0 && (
                <div className="border-b border-line py-1.5">
                  <p className="px-3 pt-1 pb-1.5 text-[11px] font-bold tracking-wide text-ink-400 uppercase">
                    My departments
                  </p>

                  {departments.map((membership) => {
                    const selected = active?.id === membership.id;
                    return (
                      <button
                        key={membership.id}
                        type="button"
                        role="menuitemradio"
                        aria-checked={selected}
                        onClick={() => {
                          setActive(membership.id);
                          setMenuOpen(false);
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-ink-50"
                      >
                        <Check
                          className={cn(
                            "size-4 shrink-0 text-brand-600",
                            !selected && "invisible",
                          )}
                          strokeWidth={3}
                        />
                        <span className="min-w-0 flex-1 truncate font-medium text-ink-800">
                          {membership.name ?? "Department"}
                        </span>
                        <RoleTag role={membership.role} className="px-1.5 py-0 text-[10px]" />
                      </button>
                    );
                  })}

                  {departments.length > 1 && (
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={active === null}
                      onClick={() => {
                        setActive(null);
                        setMenuOpen(false);
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-ink-50"
                    >
                      <Check
                        className={cn(
                          "size-4 shrink-0 text-brand-600",
                          active !== null && "invisible",
                        )}
                        strokeWidth={3}
                      />
                      <span className="font-medium text-ink-600">All departments</span>
                    </button>
                  )}
                </div>
              )}

              <Link
                href="/settings"
                role="menuitem"
                onClick={() => setMenuOpen(false)}
                className="mt-1 flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-ink-700 transition-colors hover:bg-ink-50"
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
          )}
        </div>
      </div>
    </header>
  );
}
