"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building,
  FileText,
  History,
  Layers,
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
import { SidebarProfile } from "@/components/layout/sidebar-profile";
import { useAuth } from "@/components/auth/auth-provider";
import { canSeeAllTickets, isAdmin, isHead } from "@/lib/auth";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  accent?: boolean;
  /** The top of the org chart is an admin's concern, so it is hidden here. */
  adminOnly?: boolean;
  /**
   * Offered to whoever oversees rather than takes part: an admin across the
   * workspace, a head across their own departments.
   */
  overseersOnly?: boolean;
  /**
   * Only for someone who runs a department. An admin is not one - managers
   * hold no departments - and has the whole directory under /admin instead.
   */
  headsOnly?: boolean;
};

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/create-ticket", label: "Create Ticket", icon: Plus, accent: true },
  { href: "/units", label: "Units", icon: Building, adminOnly: true },
  { href: "/departments", label: "Departments", icon: Users },
  { href: "/assigned-to-me", label: "Assigned to Me", icon: UserRound },
  { href: "/my-requests", label: "My Requests", icon: FileText },
  { href: "/team", label: "Users", icon: UserCog, headsOnly: true },
  { href: "/all-tickets", label: "All Tickets", icon: Layers },
  { href: "/activity", label: "Activity", icon: History },
  { href: "/settings", label: "Settings", icon: Settings },
];

/** Only rendered for the super admin role. */
const ADMIN_NAV: NavItem[] = [
  { href: "/admin/users", label: "Users", icon: UserCog },
  { href: "/admin/staff", label: "Admin Access", icon: UsersRound },
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
          "group flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] font-semibold transition-colors",
          active ? "bg-brand-50 text-brand-700" : "text-ink-600 hover:bg-ink-50 hover:text-ink-900",
        )}
      >
        {accent ? (
          <span className="grid size-6 shrink-0 place-items-center rounded-md bg-brand-600 text-white shadow-sm shadow-brand-600/30">
            <Icon className="size-3.5" strokeWidth={2.5} />
          </span>
        ) : (
          <span
            className={cn(
              "grid size-6 shrink-0 place-items-center rounded-md",
              active ? "text-brand-600" : "text-ink-400 group-hover:text-ink-600",
            )}
          >
            <Icon className="size-4" strokeWidth={2} />
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
          "fixed inset-y-0 left-0 z-50 flex w-52 flex-col border-r border-line bg-surface transition-transform duration-200 lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-11 shrink-0 items-center justify-between px-3">
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

        <nav className="flex-1 space-y-px overflow-y-auto px-2 py-2">
          {NAV.filter(
            (item) =>
              (!item.adminOnly || isAdmin(session)) &&
              (!item.overseersOnly || canSeeAllTickets(session)) &&
              (!item.headsOnly || isHead(session)),
          ).map(renderItem)}

          {isAdmin(session) && (
            <>
              <span aria-hidden className="my-2 block border-t border-line" />
              {ADMIN_NAV.map(renderItem)}
            </>
          )}
        </nav>

        <SidebarProfile onNavigate={onClose} />
      </aside>
    </>
  );
}
