import {
  AlertTriangle,
  BellRing,
  Building,
  CalendarClock,
  CheckCircle2,
  FileText,
  Flame,
  Hand,
  History,
  Layers,
  LayoutDashboard,
  type LucideIcon,
  MessageSquareText,
  Paperclip,
  Plus,
  Settings,
  ShieldAlert,
  UserCog,
  UserRound,
  Users,
  UsersRound,
} from "lucide-react";

import { canSeeAllTickets, isAdmin, isHead, isSuperAdmin, type Session } from "@/lib/auth";

/** Something the search box can do rather than find. */
export type SpotAction = {
  id: string;
  label: string;
  /** One line on what it does, shown beside it and in the preview. */
  hint: string;
  group: "Create" | "Go to" | "Views";
  icon: LucideIcon;
  href: string;
  /** Other words it answers to: "new" finds Create ticket. */
  keywords: string[];
  /** The letters that run it, as Tahoe's quick keys: "ct" is Create ticket. */
  quickKey: string;
};

type Draft = Omit<SpotAction, "quickKey"> & { show?: (session: Session | null) => boolean };

/** First letter of each word: "Assigned to Me" is "atm". */
const initialsOf = (label: string) =>
  label
    .split(/[\s/-]+/)
    .filter(Boolean)
    .map((word) => word[0].toLowerCase())
    .join("");

/**
 * Every action, for whoever may take it. The ticket lists that a view opens
 * on are the reader's own: a head or an admin watches the whole queue, a
 * member their own desk.
 */
export function actionsFor(session: Session | null): SpotAction[] {
  const queue = canSeeAllTickets(session) ? "/all-tickets" : "/assigned-to-me";

  const drafts: Draft[] = [
    {
      id: "create-ticket",
      label: "Create Ticket",
      hint: "Raise a new request to any department",
      group: "Create",
      icon: Plus,
      href: "/create-ticket",
      keywords: ["new", "raise", "request", "add"],
    },

    { id: "go-escalations", label: "Escalations", hint: "Tickets escalated to you", group: "Go to", icon: ShieldAlert, href: "/escalations", keywords: ["escalated", "super"], show: isSuperAdmin },
    { id: "go-dashboard", label: "Dashboard", hint: "Your overview", group: "Go to", icon: LayoutDashboard, href: "/dashboard", keywords: ["home", "overview"] },
    { id: "go-all", label: "All Tickets", hint: "Every ticket in your reach", group: "Go to", icon: Layers, href: "/all-tickets", keywords: ["queue", "department"], show: canSeeAllTickets },
    { id: "go-assigned", label: "Assigned to Me", hint: "What is on your desk", group: "Go to", icon: UserRound, href: "/assigned-to-me", keywords: ["my work", "desk", "todo"] },
    { id: "go-requests", label: "My Requests", hint: "What you have asked for", group: "Go to", icon: FileText, href: "/my-requests", keywords: ["raised", "mine"] },
    { id: "go-attachments", label: "Attachments", hint: "Every file and link from your tickets", group: "Go to", icon: Paperclip, href: "/attachments", keywords: ["files", "images", "documents", "links", "media"] },
    { id: "go-departments", label: "Departments", hint: "The departments you belong to", group: "Go to", icon: Users, href: "/departments", keywords: ["teams"] },
    { id: "go-units", label: "Units", hint: "Sites and the departments in them", group: "Go to", icon: Building, href: "/units", keywords: ["sites", "branches"], show: isAdmin },
    { id: "go-activity", label: "Activity", hint: "What has happened, and who did it", group: "Go to", icon: History, href: "/activity", keywords: ["history", "log", "audit"] },
    { id: "go-team", label: "Users", hint: "The people in the departments you run", group: "Go to", icon: UserCog, href: "/team", keywords: ["team", "members", "people"], show: (s) => isHead(s) && !isAdmin(s) },
    { id: "go-users", label: "Users", hint: "Everyone in the workspace", group: "Go to", icon: UserCog, href: "/admin/users", keywords: ["directory", "members", "people", "staff"], show: isAdmin },
    { id: "go-admins", label: "Admin Access", hint: "Who runs the workspace", group: "Go to", icon: UsersRound, href: "/admin/staff", keywords: ["admins", "staff"], show: isAdmin },
    { id: "go-settings", label: "Settings", hint: "Your profile, phone and password", group: "Go to", icon: Settings, href: "/settings", keywords: ["profile", "password", "phone", "account"] },

    { id: "view-today", label: "Due Today", hint: "Promised for today and not yet done", group: "Views", icon: CalendarClock, href: `${queue}?view=today`, keywords: ["deadline", "today"] },
    { id: "view-overdue", label: "Overdue Tickets", hint: "Past their date", group: "Views", icon: AlertTriangle, href: `${queue}?view=past`, keywords: ["late", "past"] },
    { id: "view-unread", label: "New Replies", hint: "Conversations with something unread", group: "Views", icon: MessageSquareText, href: `${queue}?view=unread`, keywords: ["unread", "messages", "chat"] },
    { id: "view-urgent", label: "Urgent Tickets", hint: "High and critical, still open", group: "Views", icon: Flame, href: `${queue}?view=urgent`, keywords: ["critical", "high", "priority"] },
    { id: "view-approval", label: "Waiting for My Approval", hint: "Done by the department, waiting on your sign-off", group: "Views", icon: CheckCircle2, href: "/my-requests?view=approval", keywords: ["approve", "sign off", "resolved"] },
    { id: "view-asked", label: "Asked of Me", hint: "Handovers waiting for your answer", group: "Views", icon: Hand, href: "/assigned-to-me?view=asked", keywords: ["handover", "transfer"] },
    { id: "view-unassigned", label: "Not Picked Up", hint: "Nobody has taken these yet", group: "Views", icon: BellRing, href: "/all-tickets?view=unassigned", keywords: ["unassigned", "nobody"], show: canSeeAllTickets },
  ];

  return drafts
    .filter((draft) => !draft.show || draft.show(session))
    .map((draft) => {
      const action: SpotAction & { show?: unknown } = { ...draft, quickKey: initialsOf(draft.label) };
      delete action.show;
      return action;
    });
}

/**
 * How well an action answers what was typed, lower is better, or null for
 * not at all: its quick key exactly, then its name from the start, then every
 * word starting one of its words, then one of the words it answers to.
 */
export function actionScore(action: SpotAction, text: string): number | null {
  const query = text.trim().toLowerCase();
  if (!query) return 3;
  if (action.quickKey === query) return 0;

  const label = action.label.toLowerCase();
  if (label.startsWith(query)) return 1;

  const labelWords = label.split(/\s+/);
  const typed = query.split(/\s+/);
  if (typed.every((word) => labelWords.some((part) => part.startsWith(word)))) return 2;
  // Inside a word only once there is enough typed to mean it.
  if (query.length >= 3 && label.includes(query)) return 3;
  if (action.keywords.some((keyword) => keyword.startsWith(query) || query.startsWith(keyword))) return 4;
  if (action.hint.toLowerCase().includes(query)) return 5;
  return null;
}
