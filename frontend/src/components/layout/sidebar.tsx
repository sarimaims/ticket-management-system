"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building,
  Building2,
  ChevronDown,
  FileText,
  History,
  Layers,
  LayoutDashboard,
  Paperclip,
  Plus,
  Settings,
  Siren,
  Ticket,
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
import { useNotifications } from "@/components/notifications/notification-provider";
import { ESCALATIONS_CHANGED } from "@/components/tickets/escalation-card";
import {
  canSeeAllTickets,
  homeFor,
  isAdmin,
  isHead,
  isSuperAdmin,
} from "@/lib/auth";
import { countEscalations } from "@/lib/tickets";
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
  /** How many are waiting, shown as a pill beside the label when above zero. */
  count?: number;
};

/** How often the escalation count is asked for when nothing has changed it. */
const COUNT_EVERY_MS = 60_000;

/**
 * Open escalations, for the super admin's sidebar.
 *
 * Asked again whenever an escalation arrives in the feed or is closed here,
 * and once a minute otherwise - so the number next to the tab is never the
 * reason one is missed.
 */
function useOpenEscalations(enabled: boolean) {
  const [open, setOpen] = useState(0);
  const { items } = useNotifications();
  const arrived = items
    .filter((item) => item.type === "ticket.escalated")
    .map((item) => item.id)
    .join(",");

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = () =>
      countEscalations()
        .then((count) => {
          if (alive) setOpen(count);
        })
        .catch(() => {
          // Keeps the last number; the next look tries again.
        });

    void load();
    const timer = setInterval(load, COUNT_EVERY_MS);
    window.addEventListener(ESCALATIONS_CHANGED, load);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener(ESCALATIONS_CHANGED, load);
    };
  }, [enabled, arrived]);

  return enabled ? open : 0;
}

/** Who may see an item, read off the session. */
type Rule = (session: ReturnType<typeof useAuth>["session"]) => boolean;

const everyone: Rule = () => true;

type NavEntry =
  | ({ kind: "item"; show: Rule } & NavItem)
  | {
      kind: "group";
      id: string;
      label: string;
      icon: LucideIcon;
      items: ({ show: Rule } & NavItem)[];
    };

/**
 * The sidebar, top to bottom: the things done every day first, then the org
 * chart, the ticket lists, the files, and the workspace's own administration.
 *
 * Related pages are gathered under a heading that folds, so a long list reads
 * as five decisions rather than thirteen. Every item keeps its own rule about
 * who sees it; a group only shows what its viewer may open.
 */
const NAV: NavEntry[] = [
  {
    kind: "item",
    href: "/create-ticket",
    label: "Create Ticket",
    icon: Plus,
    accent: true,
    show: everyone,
  },
  {
    kind: "item",
    href: "/dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    show: everyone,
  },
  {
    kind: "group",
    id: "organisation",
    label: "Organisation",
    icon: Building2,
    items: [
      { href: "/units", label: "Units", icon: Building, show: isAdmin },
      {
        href: "/departments",
        label: "Departments",
        icon: Users,
        show: everyone,
      },
    ],
  },
  {
    kind: "group",
    id: "tickets",
    label: "Tickets",
    icon: Ticket,
    items: [
      {
        href: "/all-tickets",
        label: "All Tickets",
        icon: Layers,
        show: canSeeAllTickets,
      },
      {
        href: "/assigned-to-me",
        label: "Assigned to Me",
        icon: UserRound,
        show: everyone,
      },
      {
        href: "/my-requests",
        label: "My Requests",
        icon: FileText,
        show: everyone,
      },
    ],
  },
  // Every file and link from the tickets above, searchable in one place.
  {
    kind: "item",
    href: "/attachments",
    label: "Attachments",
    icon: Paperclip,
    show: everyone,
  },
  {
    kind: "group",
    id: "administration",
    label: "Settings",
    icon: Settings,
    items: [
      { href: "/activity", label: "Activity", icon: History, show: everyone },
      // "Users" is two pages: a head's own team, and the admin's whole
      // directory. Nobody is both - an admin holds no departments.
      {
        href: "/team",
        label: "Users",
        icon: UserCog,
        show: (session) => isHead(session) && !isAdmin(session),
      },
      { href: "/admin/users", label: "Users", icon: UserCog, show: isAdmin },
      {
        href: "/admin/staff",
        label: "Admin Access",
        icon: UsersRound,
        show: isAdmin,
      },
    ],
  },
];

/** Which groups the viewer has folded away. Kept per browser, like the unit. */
const CLOSED_KEY = "flowdesk.nav.closed";

function readClosed(): string[] {
  try {
    const raw = localStorage.getItem(CLOSED_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function writeClosed(ids: string[]) {
  try {
    localStorage.setItem(CLOSED_KEY, JSON.stringify(ids));
  } catch {
    // A browser that will not keep it simply opens every group next time.
  }
}

export function Sidebar({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const pathname = usePathname();
  const { session } = useAuth();
  const top = isSuperAdmin(session);
  const escalations = useOpenEscalations(top);

  // Open unless folded; the sidebar only mounts once the session is known, so
  // reading storage here never disagrees with a server render.
  const [closed, setClosed] = useState<string[]>(readClosed);

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");

  const toggle = (id: string) => {
    setClosed((current) => {
      const next = current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id];
      writeClosed(next);
      return next;
    });
  };

  const renderItem = (
    { href, label, icon: Icon, accent, count }: NavItem,
    nested = false,
  ) => {
    // A child route such as /departments/<id> keeps its section highlighted;
    // the trailing slash stops /admin/users matching /admin/users-archive.
    const active = isActive(href);
    return (
      <Link
        key={href}
        href={href}
        onClick={onClose}
        aria-current={active ? "page" : undefined}
        className={cn(
          "group flex items-center gap-2 rounded-md py-1.5 pr-2 text-[13px] font-semibold transition-colors",
          nested ? "pl-4" : "pl-2",
          active
            ? "bg-brand-50 text-brand-700"
            : "text-ink-600 hover:bg-ink-50 hover:text-ink-900",
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
              active
                ? "text-brand-600"
                : "text-ink-400 group-hover:text-ink-600",
            )}
          >
            <Icon className="size-4" strokeWidth={2} />
          </span>
        )}
        {label}
        {count !== undefined && count > 0 && (
          <span className="ml-auto rounded-full bg-status-escalated-strong px-1.5 py-px text-[10px] leading-4 font-bold text-white tabular-nums">
            {count}
          </span>
        )}
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
          <Link href={homeFor(session) as "/"} onClick={onClose}>
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
          {/* The super admin's own desk comes first: what people escalate to
              them is the reason they open the app. */}
          {top &&
            renderItem({
              href: "/escalations",
              label: "Escalations",
              icon: Siren,
              count: escalations,
            })}

          {NAV.map((entry) => {
            if (entry.kind === "item")
              return entry.show(session) ? renderItem(entry) : null;

            const items = entry.items.filter((item) => item.show(session));
            if (items.length === 0) return null;
            // A heading over a single page is a click spent opening a list of
            // one, so that page stands on its own instead.
            if (items.length === 1) return renderItem(items[0]);

            const holdsActive = items.some((item) => isActive(item.href));
            // The heading always folds and unfolds - including the group you
            // are in. Folded, it keeps the brand colour, so where you are is
            // still plain from the heading alone.
            const open = !closed.includes(entry.id);
            const Icon = entry.icon;

            return (
              <div key={entry.id} className="pt-0.5">
                <button
                  type="button"
                  onClick={() => toggle(entry.id)}
                  aria-expanded={open}
                  className={cn(
                    "group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] font-semibold transition-colors",
                    holdsActive && !open
                      ? "text-brand-700"
                      : "text-ink-600 hover:bg-ink-50 hover:text-ink-900",
                  )}
                >
                  <span
                    className={cn(
                      "grid size-6 shrink-0 place-items-center rounded-md",
                      holdsActive
                        ? "text-brand-600"
                        : "text-ink-400 group-hover:text-ink-600",
                    )}
                  >
                    <Icon className="size-4" strokeWidth={2} />
                  </span>
                  <span className="flex-1">{entry.label}</span>
                  <ChevronDown
                    className={cn(
                      "size-3.5 shrink-0 text-ink-400 transition-transform",
                      open ? "rotate-0" : "-rotate-90",
                    )}
                  />
                </button>

                {open && (
                  // A hairline down the left ties the pages to their heading.
                  <div className="mt-px ml-4 space-y-px border-l border-line pl-1">
                    {items.map((item) => renderItem(item, true))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        <SidebarProfile onNavigate={onClose} />
      </aside>
    </>
  );
}
