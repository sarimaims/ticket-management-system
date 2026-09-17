"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  FileText,
  LayoutDashboard,
  Plus,
  Settings,
  UserCog,
  UserRound,
  Users,
  UsersRound,
  X,
  type LucideIcon,
} from "lucide-react";

import { Logo } from "@/components/layout/logo";
import { useAuth } from "@/components/auth/auth-provider";
import { isAdmin } from "@/lib/auth";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; icon: LucideIcon; accent?: boolean };

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/create-ticket", label: "Create Ticket", icon: Plus, accent: true },
  { href: "/departments", label: "Departments", icon: Users },
  { href: "/assigned-to-me", label: "Assigned to Me", icon: UserRound },
  { href: "/my-requests", label: "My Requests", icon: FileText },
  { href: "/settings", label: "Settings", icon: Settings },
];

/** Only rendered for the super admin role. */
const ADMIN_NAV: NavItem[] = [
  { href: "/admin/users", label: "Users", icon: UserCog },
  { href: "/admin/staff", label: "Staff", icon: UsersRound },
];

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const { session } = useAuth();

  const renderItem = ({ href, label, icon: Icon, accent }: NavItem) => {
    // A child route such as /departments/<id> keeps its section highlighted;
    // the trailing slash stops /admin/users matching /admin/users-archive.
    const active = pathname === href || pathname.startsWith(href + "/");
    return (
      <Link
        key={href}
        href={href}
        onClick={onClose}
        aria-current={active ? "page" : undefined}
        className={cn(
          "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-semibold transition-colors",
          active ? "bg-brand-50 text-brand-700" : "text-ink-600 hover:bg-ink-50 hover:text-ink-900",
        )}
      >
        {accent ? (
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-600 text-white shadow-sm shadow-brand-600/30">
            <Icon className="size-4.5" strokeWidth={2.5} />
          </span>
        ) : (
          <span
            className={cn(
              "grid size-8 shrink-0 place-items-center rounded-lg",
              active ? "text-brand-600" : "text-ink-400 group-hover:text-ink-600",
            )}
          >
            <Icon className="size-5" strokeWidth={2} />
          </span>
        )}
        {label}
      </Link>
    );
  };

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-40 bg-ink-900/40 lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r border-line bg-surface transition-transform duration-200 lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-16 shrink-0 items-center justify-between px-5">
          <Link href="/dashboard" onClick={onClose}>
            <Logo />
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="text-ink-400 hover:text-ink-700 lg:hidden"
            aria-label="Close navigation"
          >
            <X className="size-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {NAV.map(renderItem)}

          {isAdmin(session) && (
            <>
              <p className="px-3 pt-5 pb-2 text-[11px] font-bold tracking-wider text-ink-400 uppercase">
                Administration
              </p>
              {ADMIN_NAV.map(renderItem)}
            </>
          )}
        </nav>
      </aside>
    </>
  );
}
