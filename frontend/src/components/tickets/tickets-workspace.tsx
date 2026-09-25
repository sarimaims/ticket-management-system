"use client";

import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  AlertCircle,
  Building,
  Trash2,
  Inbox,
  MessagesSquare,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  UserCheck,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { OriginTag, PriorityBadge, StatusBadge } from "@/components/ui/badge";
import { Input } from "@/components/ui/field";
import { MultiSelect } from "@/components/ui/multi-select";
import { SearchSelect } from "@/components/ui/search-select";
import {
  DeadlineVerdict,
  TicketDetailSheet,
  type SheetTab,
} from "@/components/tickets/ticket-detail-sheet";
import { StatusPicker } from "@/components/tickets/status-picker";
import { ScopeFilter, type ScopeOption } from "@/components/ui/scope-filter";
import { useNotifications } from "@/components/notifications/notification-provider";
import {
  listDepartmentMembers,
  listDepartmentOptions,
  type DepartmentOption,
  type MemberOption,
} from "@/lib/departments";
import { useToast } from "@/components/ui/toast";
import type { SortDirection } from "@/components/ui/table";
import { Pagination, TableCell, TableHead } from "@/components/ui/table";
import { TableSkeleton } from "@/components/ui/skeleton";
import { StatTiles } from "@/components/ui/stat-tiles";
import {
  deleteTickets,
  reassignTickets,
  updateTicket,
  type TicketRecord,
  type TicketScope,
} from "@/lib/tickets";
import { errorMessage } from "@/lib/api";
import { useLiveTickets } from "@/hooks/use-live-tickets";
import { useAuth } from "@/components/auth/auth-provider";
import { DEPARTMENT_ROLE_LABEL, isAdmin } from "@/lib/auth";
import { activeUnit, activeUnitOnServer, subscribeActiveUnit } from "@/lib/active-unit";
import { cn, formatDate, formatDateOf, formatTime } from "@/lib/utils";
import type { Stat, TicketStatus } from "@/lib/types";

/**
 * Every status a ticket can read as, in lifecycle order - which is what the
 * filter offers and what the Status column sorts by. Overdue is in the list
 * because it is worth filtering for, even though nobody can set it.
 */
const STATUSES: TicketStatus[] = ["New", "In Progress", "Completed", "Overdue"];

const PRIORITIES = ["Low", "Medium", "High", "Critical"];

/**
 * What a column is ordered by when its heading is clicked.
 *
 * Each one names a fact on the row rather than a column, because two columns
 * can read the same field - the deadline shows what was asked for and what was
 * promised - and only one of them is the thing being sorted by.
 */
type SortKey =
  | "number"
  | "subject"
  | "fromUnit"
  | "fromDepartment"
  | "raisedBy"
  | "toUnit"
  | "toDepartment"
  | "assignees"
  | "priority"
  | "status"
  | "createdAt"
  | "deadline";

/**
 * Which way a column opens on its first click.
 *
 * Dates and urgency answer "what is most pressing", so they start at the top
 * of the scale; names answer "where is X", so they start at A. Anything not
 * named here opens ascending.
 */
const OPENS_DESCENDING: SortKey[] = ["createdAt", "priority"];

/** How the queue arrives before anybody has clicked a heading. */
const DEFAULT_SORT: { key: SortKey; direction: SortDirection } = {
  key: "createdAt",
  direction: "desc",
};

/** How often a live queue asks the API whether anything moved. */
const REFRESH_MS = 7000;

/**
 * How long somebody has to take back a ticket they raised. The API holds the
 * same number; this one only decides whether to offer the button.
 */
const DELETE_WINDOW_MS = 15 * 60 * 1000;

/** How long a row arrived at from a notification keeps its outline. */
const FLASH_MS = 4000;

/**
 * A ticket counts as belonging to a unit when either end of it does: the
 * department working it, or a department it was raised on behalf of.
 *
 * Matching only the receiving end would hide your own request the moment you
 * switched to the unit you raised it from, which is exactly when you would go
 * looking for it.
 */
function inUnit(ticket: TicketRecord, unitId: string) {
  if (!unitId) return true;
  if (ticket.department.unit?.id === unitId) return true;
  return ticket.fromDepartments.some((item) => item.unit?.id === unitId);
}

function isToday(value: string | null) {
  if (!value) return false;
  return new Date(value).toDateString() === new Date().toDateString();
}

function statsFor(tickets: TicketRecord[], scope: TicketScope): Stat[] {
  const count = (predicate: (ticket: TicketRecord) => boolean) => tickets.filter(predicate).length;

  return [
    {
      label: scope === "mine" ? "Open Requests" : "New",
      value: count((ticket) => ticket.status === "New"),
      caption: "",
      tone: "new",
    },
    {
      label: "In Progress",
      value: count((ticket) => ticket.status === "In Progress"),
      caption: "",
      tone: "progress",
    },
    {
      label: "Completed",
      value: count((ticket) => ticket.status === "Completed"),
      caption: "",
      tone: "completed",
    },
    {
      label: "Due Today",
      value: count((ticket) => ticket.status !== "Completed" && isToday(ticket.deadline)),
      caption: "",
      tone: "due",
    },
    {
      label: "Overdue",
      value: count((ticket) => ticket.status === "Overdue"),
      caption: "",
      tone: "overdue",
    },
  ];
}

/**
 * What one ticket is worth under one ordering: a number where the column is a
 * scale, a lower-cased string where it is a name.
 *
 * A ticket with nothing in the column sorts to the end rather than the start,
 * whichever way the arrow points - an empty cell is never the answer somebody
 * clicked a heading looking for.
 */
function sortValue(ticket: TicketRecord, key: SortKey): string | number {
  const names = (list: { name?: string }[]) =>
    list
      .map((item) => item.name ?? "")
      .join(", ")
      .toLowerCase();

  switch (key) {
    case "number":
      return ticket.number.toLowerCase();
    case "subject":
      return ticket.subject.toLowerCase();
    case "fromUnit":
      return names(ticket.fromDepartments.map((item) => item.unit ?? {}));
    case "fromDepartment":
      return names(ticket.fromDepartments);
    case "raisedBy":
      return (ticket.raisedBy.name ?? "").toLowerCase();
    case "toUnit":
      return (ticket.department.unit?.name ?? "").toLowerCase();
    case "toDepartment":
      return (ticket.department.name ?? "").toLowerCase();
    case "assignees":
      return names(ticket.assignees);
    case "priority":
      return PRIORITIES.indexOf(ticket.priority);
    case "status":
      return STATUSES.indexOf(ticket.status);
    case "createdAt":
      return new Date(ticket.createdAt).getTime();
    case "deadline":
      return ticket.deadline ? new Date(ticket.deadline).getTime() : Number.POSITIVE_INFINITY;
  }
}

/** Every cell in this table, tight enough that the whole row fits on screen. */
const CELL = "px-2 py-1.5 text-[12px] align-middle";

/**
 * The rules that frame a band: its own colour at the two edges, and a fainter
 * one between the columns inside it. A grey hairline did the job of a table
 * that had no bands; these say where one side of a request ends.
 */
const FROM_EDGE = "border-l border-route-from-fg/30";
const FROM_INNER = "border-l border-route-from-fg/10";
const TO_EDGE = "border-l border-route-to-fg/30";
const TO_INNER = "border-l border-route-to-fg/10";

/**
 * The two sides of a request, each washed in its own hue so a column belongs
 * to one of them at a glance.
 *
 * Half-strength over the rows: a row already carries a colour of its own when
 * it is done, or waiting on you, or the one you have open, and those have to
 * keep reading straight across the table.
 */
const FROM = "bg-route-from-bg/70";
const TO = "bg-route-to-bg/70";

/** Full strength in the header, where there is no row colour to share with. */
const FROM_HEAD = "bg-route-from-bg";
const TO_HEAD = "bg-route-to-bg";

/** A sub-heading inside a band: quieter than the group name above it. */
const SUB = "px-2 pt-0 pb-1.5 text-[10px] font-medium text-ink-400";

/** A fact this ticket does not carry. */
const Blank = () => <span className="text-ink-300">—</span>;

/**
 * One row, held apart from the table so a refresh only repaints the tickets
 * that actually moved. The poll reuses the object of an unchanged ticket, so
 * every prop here is reference-equal and React skips the row entirely.
 *
 * Every column earns its width: what was two department columns is one route,
 * what was two date columns is one deadline with the promise under it, and the
 * request type - which almost no ticket carries - sits under the subject
 * rather than holding a column of dashes open.
 */
const TicketRow = memo(function TicketRow({
  ticket,
  scope,
  mine,
  byMe,
  selected,
  flashed,
  unreadMessages,
  askedOfMe,
  showPick,
  canPick,
  canDelete,
  picked,
  onPick,
  onOpen,
  onStatus,
  onDelete,
}: {
  ticket: TicketRecord;
  scope: TicketScope;
  mine: boolean;
  /** My department's queue, but I am the one who asked for it. */
  byMe: boolean;
  selected: boolean;
  /** Arrived here from a notification: hold the eye on this row for a moment. */
  flashed: boolean;
  /** How many messages on this ticket the reader has not opened yet. */
  unreadMessages: number;
  /** Somebody has asked this person to take this ticket on. */
  askedOfMe: boolean;
  /** Whether this reader may remove tickets at all. */
  /** Whether the table is showing the tick column at all. */
  showPick: boolean;
  /** Whether this reader can do anything with this row in a batch. */
  canPick: boolean;
  canDelete: boolean;
  picked: boolean;
  onPick: (id: string, picked: boolean) => void;
  onOpen: (ticket: TicketRecord, tab?: SheetTab) => void;
  onStatus: (ticket: TicketRecord, next: TicketStatus) => void;
  onDelete: (ticket: TicketRecord) => void;
}) {
  const messages = unreadMessages > 0 ? unreadMessages : ticket.messageCount;

  // Named once each: several departments of one unit all say the same thing.
  const fromUnits = [
    ...new Set(
      ticket.fromDepartments
        .map((item) => item.unit?.name)
        .filter((name): name is string => Boolean(name)),
    ),
  ];

  return (
    <tr
      id={`ticket-row-${ticket.id}`}
      onClick={() => onOpen(ticket)}
      className={cn(
        "cursor-pointer border-b border-line transition-colors last:border-0",
        // No row-wide fill any more. The columns carry the colour now, and a
        // row tinted underneath them left the table with two colour systems
        // arguing across the same cell. What a ticket is, the status column
        // says; what is waiting on you, the chip beside its number says.
        "hover:bg-ink-50/70",
        // Which is why the two things that are about *this* row rather than
        // about the ticket are outlines: the one you have open, and the one a
        // notification just brought you to.
        selected && "ring-1 ring-royal-300 ring-inset",
        flashed && "ring-2 ring-status-waiting-fg ring-inset",
      )}
    >
      {showPick && (
        <TableCell className={cn(CELL, "w-8")}>
          {/* A row nobody may act on keeps the column's width and offers
              nothing, rather than a box that refuses when it is used. */}
          {canPick && (
            <input
              type="checkbox"
              checked={picked}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => onPick(ticket.id, event.target.checked)}
              aria-label={`Select ${ticket.number}`}
              className="size-4 cursor-pointer accent-brand-600"
            />
          )}
        </TableCell>
      )}

      <TableCell className={cn(CELL, "relative")}>
        {/* Only on a list that holds other people's work too. On Assigned to
            Me every row is yours, and marking all of them marks none. */}
        {mine && <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-brand-600" />}
        <span className="block font-bold whitespace-nowrap text-brand-600">#{ticket.number}</span>
        {/* The one thing on a row that is a question rather than a fact. */}
        {askedOfMe && (
          <span className="mt-0.5 inline-block rounded bg-brand-600 px-1 py-px text-[9px] font-bold tracking-wide text-white uppercase">
            Take it?
          </span>
        )}
        {mine && (
          <span className="mt-0.5 inline-block rounded bg-brand-50 px-1 py-px text-[9px] font-bold tracking-wide text-brand-700 uppercase">
            Mine
          </span>
        )}
      </TableCell>

      <TableCell className={cn(CELL, "font-semibold whitespace-normal text-ink-900")}>
        {ticket.subject}
        {/* The form stopped asking for this, so it rides under the subject on
            the tickets that still carry one instead of holding a column open. */}
        {ticket.requestType && (
          <span className="block text-[10px] leading-tight font-normal text-ink-400">
            {ticket.requestType}
          </span>
        )}
      </TableCell>

      {/* Where the request came from: the unit, the department inside it, and
          the person who asked. A manager sits above the departments, so their
          first two cells stay empty and the tag beside their name says why. */}
      <TableCell className={cn(CELL, FROM_EDGE, FROM, "whitespace-normal")}>
        {fromUnits.length > 0 ? fromUnits.join(", ") : <Blank />}
      </TableCell>

      <TableCell className={cn(CELL, FROM_INNER, FROM, "whitespace-normal")}>
        {ticket.fromDepartments.length === 0 ? (
          <Blank />
        ) : (
          <span className="flex flex-wrap gap-1">
            {ticket.fromDepartments.map((item) => (
              <span
                key={item.id}
                className="rounded bg-surface px-1 py-px text-[10px] font-semibold text-route-from-fg"
              >
                {item.name}
              </span>
            ))}
          </span>
        )}
      </TableCell>

      <TableCell className={cn(CELL, FROM_INNER, FROM, "whitespace-normal")}>
        <span className="flex flex-wrap items-center gap-1">
          <span className="font-medium text-ink-700">{ticket.raisedBy.name}</span>
          {byMe && (
            <span className="rounded bg-ink-100 px-1 py-px text-[9px] font-bold tracking-wide text-ink-600 uppercase">
              You
            </span>
          )}
          <OriginTag role={ticket.raisedByRole} />
        </span>
      </TableCell>

      {/* And where it landed. One department per ticket, so this side never
          holds a list: several departments asked at once are several tickets. */}
      <TableCell className={cn(CELL, TO_EDGE, TO, "whitespace-normal")}>
        {ticket.department.unit?.name ?? <Blank />}
      </TableCell>

      <TableCell className={cn(CELL, TO_INNER, TO, "whitespace-normal")}>
        {/* White rather than the brand tint it wore before: a red chip on an
            orange band was two warm colours arguing over the same cell. */}
        <span className="rounded bg-surface px-1 py-px text-[10px] font-semibold text-route-to-fg">
          {ticket.department.name}
        </span>
      </TableCell>

      <TableCell className={cn(CELL, TO_INNER, TO, "whitespace-normal")}>
        {ticket.assignees.length === 0 ? (
          <span className="text-ink-400">Nobody yet</span>
        ) : (
          <span className="font-medium text-ink-700">
            {ticket.assignees.map((person) => person.name).join(", ")}
          </span>
        )}
      </TableCell>

      <TableCell className={cn(CELL, TO_EDGE)}>
        <PriorityBadge priority={ticket.priority} className="px-1.5 py-0.5 text-[11px]" />
      </TableCell>

      <TableCell className={CELL}>
        {scope !== "mine" ? (
          <div className="w-[104px]">
            <StatusPicker
              value={ticket.status}
              onChange={(next) => onStatus(ticket, next)}
              label={`Status of ${ticket.number}`}
            />
          </div>
        ) : (
          <StatusBadge status={ticket.status} className="px-1.5 py-0.5 text-[11px]" />
        )}
      </TableCell>

      <TableCell className={cn(CELL, "whitespace-nowrap")}>
        <span className="block leading-tight">{formatDateOf(ticket.createdAt)}</span>
        <span className="block text-[10px] leading-tight text-ink-400">
          {formatTime(ticket.createdAt)}
        </span>
      </TableCell>

      {/* The date asked for, with what the department promised back under it:
          green if it meets the ask, amber if it runs past it. */}
      <TableCell className={cn(CELL, "whitespace-nowrap")}>
        <span className="block leading-tight">
          {ticket.deadline ? formatDate(ticket.deadline.slice(0, 10)) : "—"}
        </span>
        <span className="block text-[10px] leading-tight">
          <DeadlineVerdict requested={ticket.deadline} committed={ticket.committedDeadline} />
        </span>
      </TableCell>

      <TableCell className={CELL}>
        <span className="flex items-center gap-1">
          {/* The way into the conversation, on every row rather than only the
              ones that already have one - a thread nobody can find is a thread
              nobody starts. Filled in once something is waiting to be read. */}
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onOpen(ticket, "chat");
            }}
            aria-label={
              unreadMessages > 0
                ? `Open the conversation on ${ticket.number}, ${unreadMessages} unread`
                : `Open the conversation on ${ticket.number}`
            }
            className={cn(
              "inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] font-bold transition-colors",
              unreadMessages > 0
                ? "bg-status-completed-fg text-white hover:bg-status-accepted-fg"
                : "bg-status-completed-bg text-status-completed-fg hover:bg-status-completed-fg/20",
            )}
          >
            <MessagesSquare className="size-3.5" />
            {messages > 0 ? messages : null}
          </button>

          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onOpen(ticket);
            }}
            className="grid size-7 shrink-0 place-items-center rounded-lg text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700"
            aria-label={`Open ${ticket.number}`}
          >
            <SlidersHorizontal className="size-4" />
          </button>

          {canDelete && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onDelete(ticket);
              }}
              className="grid size-7 shrink-0 place-items-center rounded-lg text-ink-400 transition-colors hover:bg-brand-50 hover:text-brand-600"
              aria-label={`Delete ${ticket.number}`}
            >
              <Trash2 className="size-4" />
            </button>
          )}
        </span>
      </TableCell>
    </tr>
  );
});

/** A quiet marker that the queue is keeping itself current. */
/**
 * Fetches now, rather than announcing that something else will.
 *
 * The queue still polls on its own; this is for the moment you know something
 * changed and do not want to wait for the next tick. The spin is held for a
 * beat even when the answer is instant, because a button that does nothing
 * visible reads as broken.
 */
function RefreshButton({ onRefresh, syncedAt }: { onRefresh: () => void; syncedAt: number | null }) {
  const [spinning, setSpinning] = useState(false);

  return (
    <button
      type="button"
      onClick={() => {
        onRefresh();
        setSpinning(true);
        window.setTimeout(() => setSpinning(false), 600);
      }}
      title={
        syncedAt
          ? `Refresh · checks itself every ${REFRESH_MS / 1000}s, last change ${new Date(syncedAt).toLocaleTimeString()}`
          : `Refresh · checks itself every ${REFRESH_MS / 1000}s`
      }
      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-line-strong bg-surface px-2.5 text-[13px] font-semibold text-ink-600 transition-colors hover:bg-ink-50 hover:text-ink-900"
    >
      <RefreshCw className={cn("size-3.5", spinning && "animate-spin")} />
      Refresh
    </button>
  );
}

/**
 * `mine` lists what I raised; `assigned` lists what my departments have been
 * asked to do. The API decides what is visible - this only renders it.
 *
 * `live` keeps the queue current on a short conditional poll: each request
 * carries the tag of the last answer, so an unchanged queue costs a 304 with
 * no body and repaints nothing.
 */
export function TicketsWorkspace({
  scope,
  live = false,
}: {
  scope: TicketScope;
  live?: boolean;
}) {
  const { tickets, setTickets, loading, error, syncedAt, hold, refresh } = useLiveTickets({
    scope,
    intervalMs: live ? REFRESH_MS : null,
  });

  const [query, setQuery] = useState("");
  const [sort, setSort] = useState(DEFAULT_SORT);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [priorities, setPriorities] = useState<string[]>([]);
  const [where, setWhere] = useState<{ units: string[]; departments: string[] }>({
    units: [],
    departments: [],
  });

  /**
   * The unit chosen on the profile menu. It scopes the list rather than the
   * request: the server already decided what this person may read, and this
   * only narrows what is shown of it.
   */
  const unit = useSyncExternalStore(subscribeActiveUnit, activeUnit, activeUnitOnServer);
  const [viewing, setViewing] = useState<TicketRecord | null>(null);
  // Which pane the sheet opens on. Held here rather than inside the sheet, so
  // the chat icon on a row can go straight to the conversation.
  const [tab, setTab] = useState<SheetTab>("details");
  const [mineOnly, setMineOnly] = useState(false);
  /** Ticked for deletion. Ids rather than rows, so a refresh cannot stale them. */
  const [picked, setPicked] = useState<Set<string>>(new Set());
  /** What the confirm box is about: the ticked set, or one row's trash button. */
  const [removing, setRemoving] = useState<TicketRecord[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  /** The batch the reassign box is about. */
  const [handingOver, setHandingOver] = useState<TicketRecord[] | null>(null);
  const { session } = useAuth();
  const { items: feed } = useNotifications();
  const toast = useToast();

  // A notification lands here with the ticket it was about in the query.
  const focusKey = useSearchParams().get("ticket");
  const [flashed, setFlashed] = useState<string | null>(null);
  const focused = useRef<string | null>(null);

  // Filtering a long queue is the expensive part of a keystroke, so the field
  // stays responsive and the table catches up a beat later.
  const deferredQuery = useDeferredValue(query);

  const meId = session?.id;

  // A ticket sits with my department; this says it sits with *me*.
  // A ticket can sit with several people; it is mine if I am one of them.
  const isMine = useCallback(
    (ticket: TicketRecord) =>
      scope !== "mine" && ticket.assignees.some((person) => person.id === meId),
    [scope, meId],
  );

  const manager = isAdmin(session);

  const myDepartmentIds = useMemo(
    () => new Set((session?.departments ?? []).map((membership) => membership.id)),
    [session],
  );

  /**
   * Who may hand a ticket on: the department it sits with, and any manager.
   * The same right that lets somebody work one ticket lets them work twenty.
   */
  const canWorkTicket = useCallback(
    (ticket: TicketRecord) =>
      manager ||
      myDepartmentIds.has(ticket.department.id) ||
      // Their own request: the raiser may name who should pick it up, here in
      // a batch exactly as they could one at a time in the sheet.
      ticket.raisedBy.id === meId,
    [manager, myDepartmentIds, meId],
  );

  /**
   * Who may take a ticket away.
   *
   * A manager may, but only from the page built for overseeing - the everyday
   * queues are for working tickets, not for clearing them out. Anyone else may
   * take back what they raised themselves, and only while it is new enough
   * that the department cannot have started on it. The API applies the same
   * two rules, so a stale button is refused rather than obeyed.
   */
  const canDeleteTicket = useCallback(
    (ticket: TicketRecord) => {
      if (manager && scope === "all") return true;
      if (ticket.raisedBy.id !== meId) return false;
      return Date.now() - Date.parse(ticket.createdAt) <= DELETE_WINDOW_MS;
    },
    [manager, scope, meId],
  );

  /**
   * Unread messages per ticket, read off the bell's own feed.
   *
   * The feed is already the per-person record of what has been seen, so there
   * is nothing further to store and nothing further to ask the API for - and
   * opening a thread, which marks its entries read, clears the row's badge by
   * the same stroke.
   */
  const unreadByTicket = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of feed) {
      if (item.type !== "ticket.message" || item.read || !item.ticket) continue;
      counts.set(item.ticket, (counts.get(item.ticket) ?? 0) + 1);
    }
    return counts;
  }, [feed]);

  /** Everything the unit in view holds, which is what the numbers count. */
  const inScope = useMemo(() => tickets.filter((ticket) => inUnit(ticket, unit)), [tickets, unit]);

  /**
   * The departments actually present, so the filter only ever offers a choice
   * that returns something. Grouped nowhere: inside one unit the name is
   * enough, and across units the unit rides along.
   */
  const departmentOptions = useMemo(() => {
    const byId = new Map<string, ScopeOption>();

    for (const ticket of inScope) {
      const found = byId.get(ticket.department.id);
      if (found) {
        found.count += 1;
        continue;
      }

      byId.set(ticket.department.id, {
        id: ticket.department.id,
        name: ticket.department.name ?? "Department",
        unit: ticket.department.unit?.id
          ? { id: ticket.department.unit.id, name: ticket.department.unit.name ?? "Unit" }
          : null,
        count: 1,
      });
    }

    return [...byId.values()];
  }, [inScope]);

  /** The unit in view, named, so the bar can say what is being left out. */
  const unitName = useMemo(
    () => (session?.departments ?? []).find((item) => item.unit?.id === unit)?.unit?.name ?? "",
    [session, unit],
  );

  const stats = useMemo(() => statsFor(inScope, scope), [inScope, scope]);

  const mineCount = useMemo(() => inScope.filter(isMine).length, [inScope, isMine]);

  const rows = useMemo(() => {
    const term = deferredQuery.trim().toLowerCase();
    const kept = inScope.filter((ticket) => {
      if (
        term &&
        !`${ticket.number} ${ticket.subject} ${ticket.requestType}`.toLowerCase().includes(term)
      )
        return false;
      // An empty filter asks nothing of the row, so it lets everything past.
      if (statuses.length > 0 && !statuses.includes(ticket.status)) return false;
      if (priorities.length > 0 && !priorities.includes(ticket.priority)) return false;
      // A unit stands for everything under it, so either half of the choice
      // can match on its own.
      if (where.units.length > 0 || where.departments.length > 0) {
        const byUnit = where.units.includes(ticket.department.unit?.id ?? "");
        const byDepartment = where.departments.includes(ticket.department.id);
        if (!byUnit && !byDepartment) return false;
      }
      if (mineOnly && !isMine(ticket)) return false;
      return true;
    });

    // A copy, because the list being sorted is the one the poll hands back.
    // The tickets inside it are the same objects either way, so a reordering
    // still repaints no row that did not move.
    const factor = sort.direction === "asc" ? 1 : -1;

    return [...kept].sort((left, right) => {
      const a = sortValue(left, sort.key);
      const b = sortValue(right, sort.key);

      // Blanks last in both directions, so the tail of the table is always the
      // part with nothing to say.
      const missing = (value: string | number) => value === "" || value === Number.POSITIVE_INFINITY;
      if (missing(a) !== missing(b)) return missing(a) ? 1 : -1;

      const order =
        typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b));

      // Ties fall back on the ticket number, so two rows that are equal under
      // the chosen column still hold a settled order between refreshes.
      return order === 0 ? left.number.localeCompare(right.number) : order * factor;
    });
  }, [inScope, deferredQuery, statuses, priorities, where, mineOnly, isMine, sort]);

  /**
   * Clicking the column you are already sorted by turns it around; clicking
   * another opens it whichever way that column is worth reading first.
   */
  const sortBy = useCallback((key: SortKey) => {
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
        : { key, direction: OPENS_DESCENDING.includes(key) ? "desc" : "asc" },
    );
  }, []);

  /** Everything a sortable heading needs, so the header reads as a list. */
  const sortable = (key: SortKey) => ({
    sortable: true,
    sorted: sort.key === key ? sort.direction : null,
    onSort: () => sortBy(key),
  });

  /** The tick column appears when something in view could be acted on at all. */
  const selectable = useMemo(
    () => rows.filter((ticket) => canWorkTicket(ticket) || canDeleteTicket(ticket)),
    [rows, canWorkTicket, canDeleteTicket],
  );
  const showPicks = selectable.length > 0;

  const chosen = useMemo(
    () => rows.filter((ticket) => picked.has(ticket.id)),
    [rows, picked],
  );

  /**
   * An assignee belongs to one department, so handing a batch over only means
   * something while the batch sits with one. A mixed selection says so rather
   * than offering a list that would be wrong for half of it.
   */
  const chosenDepartment =
    chosen.length > 0 && chosen.every((ticket) => ticket.department.id === chosen[0].department.id)
      ? chosen[0].department
      : null;

  const canReassignPicked =
    chosen.length > 0 && chosenDepartment !== null && chosen.every(canWorkTicket);

  const canDeletePicked = chosen.length > 0 && chosen.every(canDeleteTicket);

  // Ticket, subject, three from, three to, priority, status, created,
  // deadline, actions - the same on every list.
  const columns = 13 + (showPicks ? 1 : 0);

  /**
   * Arriving from a notification: find the ticket it named, clear whatever
   * would have hidden it, put it on screen and outline it.
   *
   * It waits for the list, because the click usually lands before the first
   * answer does. `focused` makes it happen once per link - the poll replaces
   * the array every time something moves, and the row must not jump again.
   */
  useEffect(() => {
    if (!focusKey || focused.current === focusKey) return;

    const target = tickets.find(
      (ticket) => ticket.id === focusKey || ticket.number === focusKey,
    );
    if (!target) return;

    focused.current = focusKey;

    // A filter or a search would hide the row that was just asked for.
    /* eslint-disable react-hooks/set-state-in-effect -- what triggers this is
       the URL and the arriving list, both outside React, and the guard above
       holds it to once per link. */
    setQuery("");
    setStatuses([]);
    setPriorities([]);
    setWhere({ units: [], departments: [] });
    setMineOnly(false);
    setFlashed(target.id);
    /* eslint-enable react-hooks/set-state-in-effect */

    // The query has done its job. Dropping it here rather than through the
    // router keeps it out of history without re-rendering the route.
    window.history.replaceState(null, "", window.location.pathname);

    // After the filters above have been painted, or it scrolls to where the
    // row used to be.
    const frame = requestAnimationFrame(() => {
      document
        .getElementById(`ticket-row-${target.id}`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    });

    return () => cancelAnimationFrame(frame);
  }, [focusKey, tickets]);

  /** The outline is a pointer, not a state: it lets go on its own. */
  useEffect(() => {
    if (!flashed) return;
    const timer = setTimeout(() => setFlashed(null), FLASH_MS);
    return () => clearTimeout(timer);
  }, [flashed]);

  /**
   * Optimistic: the row moves now, and snaps back if the API refuses. The
   * poll is held for the length of the write, so an answer that was already
   * in the air cannot put the old status back.
   */
  const applyStatus = useCallback(
    async (ticket: TicketRecord, next: TicketStatus) => {
      const release = hold();
      setTickets((current) =>
        current.map((item) => (item.id === ticket.id ? { ...item, status: next } : item)),
      );

      try {
        const saved = await updateTicket(ticket.id, { status: next });
        setTickets((current) => current.map((item) => (item.id === saved.id ? saved : item)));
        toast.success(`#${ticket.number} updated`, `Status: ${next}`);
      } catch (caught) {
        // The row we were handed is the value before the edit.
        setTickets((current) => current.map((item) => (item.id === ticket.id ? ticket : item)));
        toast.error(`Could not update #${ticket.number}`, errorMessage(caught));
      } finally {
        release();
      }
    },
    [hold, setTickets, toast],
  );

  const pickOne = useCallback((id: string, on: boolean) => {
    setPicked((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const openTicket = useCallback((ticket: TicketRecord, next: SheetTab = "details") => {
    setViewing(ticket);
    setTab(next);
  }, []);

  return (
    <>
      {error && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2.5 rounded-field border border-brand-200 bg-brand-50 px-3.5 py-2.5 text-sm font-medium text-brand-700"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          {error}
        </div>
      )}

      {/* The sheet floats over this, so the table keeps its full width and its
          columns do not reflow the moment a row is opened. */}
      <div>
      <StatTiles stats={stats} loading={loading} />

      <Card className="mt-3 overflow-hidden">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line p-1.5">
          <div className="min-w-44 flex-1">
            <Input
              className="pl-8 text-[13px]"
              icon={<Search className="text-ink-400" />}
              placeholder="Search by ticket ID, subject or keyword..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search tickets"
            />
          </div>

          {/* Unit and department are the same axis at two depths, so they are
              one control: tick a unit for all of it, or reach in for two of
              its departments. */}
          <div className="w-52 shrink-0">
            <ScopeFilter
              id="filter-where"
              options={departmentOptions}
              value={where}
              onChange={setWhere}
            />
          </div>

          <div className="w-40 shrink-0">
            <MultiSelect
              display="summary"
              id="filter-status"
              options={STATUSES.map((item) => ({ value: item, label: item }))}
              value={statuses}
              onChange={setStatuses}
              placeholder="All Status"
            />
          </div>

          <div className="w-40 shrink-0">
            <MultiSelect
              display="summary"
              id="filter-priority"
              options={PRIORITIES.map((item) => ({ value: item, label: item }))}
              value={priorities}
              onChange={setPriorities}
              placeholder="All Priorities"
            />
          </div>

          {canReassignPicked && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 shrink-0 px-2.5 text-[12px]"
              onClick={() => setHandingOver(chosen)}
            >
              <UserCheck className="size-3.5" />
              Reassign {chosen.length}
            </Button>
          )}

          {canDeletePicked && (
            <Button
              size="sm"
              className="h-7 shrink-0 px-2.5 text-[12px]"
              onClick={() => setRemoving(chosen)}
            >
              <Trash2 className="size-3.5" />
              Delete {chosen.length}
            </Button>
          )}

          {chosen.length > 1 && !chosenDepartment && (
            <span className="text-[11px] font-medium text-ink-400">
              Pick one department to reassign
            </span>
          )}

          {scope === "all" && (
            <button
              type="button"
              onClick={() => setMineOnly((current) => !current)}
              aria-pressed={mineOnly}
              className={cn(
                "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-[13px] font-semibold transition-colors",
                mineOnly
                  ? "border-brand-600 bg-brand-50 text-brand-700"
                  : "border-line-strong bg-surface text-ink-600 hover:bg-ink-50",
              )}
            >
              <UserCheck className="size-3.5" />
              Assigned to me
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[11px] leading-none font-bold",
                  mineOnly ? "bg-brand-600 text-white" : "bg-ink-100 text-ink-600",
                )}
              >
                {mineCount}
              </span>
            </button>
          )}

          {live && <RefreshButton onRefresh={refresh} syncedAt={syncedAt} />}

          {scope === "mine" && (
            <Link
              href="/create-ticket"
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-brand-600 px-3.5 text-[13px] font-semibold text-white shadow-sm shadow-brand-600/25 transition-colors hover:bg-brand-700"
            >
              <Plus className="size-3.5" strokeWidth={2.5} />
              Create Ticket
            </Link>
          )}
        </div>

        <div className="overflow-x-auto">
          {/* Fluid rather than held open at a fixed width: on a desktop every
              column fits and nothing scrolls sideways, and the min-width below
              only catches phones. */}
          <table className="w-full min-w-[1180px] border-collapse">
            <thead className="sticky top-0 z-10 border-b border-line bg-ink-50 shadow-[0_1px_0_var(--color-line)]">
              <tr>
                {showPicks && (
                  <TableHead rowSpan={2} className="w-8 px-2 py-2">
                    <input
                      type="checkbox"
                      aria-label="Select every ticket that can be deleted"
                      checked={
                        selectable.length > 0 &&
                        selectable.every((ticket) => picked.has(ticket.id))
                      }
                      onChange={(event) =>
                        // Only what is on screen and can be acted on: a filter
                        // is a decision about what you meant.
                        setPicked(
                          event.target.checked
                            ? new Set(selectable.map((ticket) => ticket.id))
                            : new Set(),
                        )
                      }
                      className="size-4 cursor-pointer accent-brand-600"
                    />
                  </TableHead>
                )}
                <TableHead {...sortable("number")} rowSpan={2} className="px-2 py-2">
                  Ticket
                </TableHead>
                <TableHead {...sortable("subject")} rowSpan={2} className="w-[16%] px-2 py-2">
                  Subject
                </TableHead>
                {/* Two banded groups rather than one "From to" column. Each
                    side of a request is three separate facts - the unit, the
                    department inside it and the person - and reading them
                    straight down a column beats unpicking them from a phrase. */}
                <TableHead
                  colSpan={3}
                  className={cn(FROM_EDGE, FROM_HEAD, "px-2 py-1 text-center text-route-from-fg")}
                >
                  Raised By / From
                </TableHead>
                <TableHead
                  colSpan={3}
                  className={cn(TO_EDGE, TO_HEAD, "px-2 py-1 text-center text-route-to-fg")}
                >
                  To
                </TableHead>
                <TableHead {...sortable("priority")} rowSpan={2} className={cn(TO_EDGE, "px-2 py-2")}>
                  Priority
                </TableHead>
                <TableHead {...sortable("status")} rowSpan={2} className="px-2 py-2">
                  Status
                </TableHead>
                <TableHead {...sortable("createdAt")} rowSpan={2} className="px-2 py-2">
                  Created
                </TableHead>
                <TableHead
                  {...sortable("deadline")}
                  rowSpan={2}
                  className="px-2 py-2"
                  title="Asked for, and what was promised back"
                >
                  Deadline
                </TableHead>
                <TableHead rowSpan={2} className="px-2 py-2">
                  Actions
                </TableHead>
              </tr>
              <tr>
                <TableHead {...sortable("fromUnit")} className={cn(FROM_EDGE, SUB, FROM_HEAD)}>
                  Unit
                </TableHead>
                <TableHead {...sortable("fromDepartment")} className={cn(FROM_INNER, SUB, FROM_HEAD)}>
                  Department
                </TableHead>
                <TableHead {...sortable("raisedBy")} className={cn(FROM_INNER, SUB, FROM_HEAD)}>
                  User
                </TableHead>
                <TableHead {...sortable("toUnit")} className={cn(TO_EDGE, SUB, TO_HEAD)}>
                  Unit
                </TableHead>
                <TableHead {...sortable("toDepartment")} className={cn(TO_INNER, SUB, TO_HEAD)}>
                  Department
                </TableHead>
                <TableHead {...sortable("assignees")} className={cn(TO_INNER, SUB, TO_HEAD)}>
                  User
                </TableHead>
              </tr>
            </thead>
            <tbody>
              {loading && <TableSkeleton rows={6} columns={columns} />}

              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={columns} className="px-3 py-12 text-center">
                    <Inbox className="mx-auto size-6 text-ink-300" />
                    <p className="mt-2 text-sm font-semibold text-ink-700">
                      {mineOnly || scope === "assigned"
                        ? "Nothing assigned to you"
                        : scope === "mine"
                          ? "No requests yet"
                          : "No tickets yet"}
                    </p>
                    <p className="mt-0.5 text-sm text-ink-400">
                      {unitName && tickets.length > 0
                        ? `Nothing in ${unitName}. Switch units on your profile to see the rest.`
                        : mineOnly || scope === "assigned"
                          ? "Work handed to you by name shows here. Your department's whole queue is under All Tickets."
                          : scope === "mine"
                            ? "Raise one and it lands in that department's queue."
                            : "Every ticket your departments have been asked to do will appear here."}
                    </p>
                  </td>
                </tr>
              )}

              {!loading &&
                rows.map((ticket) => (
                  <TicketRow
                    key={ticket.id}
                    ticket={ticket}
                    scope={scope}
                    mine={scope === "all" && isMine(ticket)}
                    byMe={scope !== "mine" && ticket.raisedBy.id === meId}
                    selected={viewing?.id === ticket.id}
                    flashed={flashed === ticket.id}
                    unreadMessages={unreadByTicket.get(ticket.id) ?? 0}
                    askedOfMe={ticket.awaitingMe}
                    showPick={showPicks}
                    canPick={canWorkTicket(ticket) || canDeleteTicket(ticket)}
                    canDelete={canDeleteTicket(ticket)}
                    picked={picked.has(ticket.id)}
                    onPick={pickOne}
                    onOpen={openTicket}
                    onStatus={applyStatus}
                    onDelete={(one) => setRemoving([one])}
                  />
                ))}
            </tbody>
          </table>
        </div>

        <Pagination
          summary={
            loading ? "Loading tickets…" : `Showing 1 to ${rows.length} of ${rows.length} tickets`
          }
          pages={1}
          current={1}
        />
      </Card>
      </div>

      {/* Both rights are read off the ticket, not off the page: someone in two
          departments who raises from one to the other may edit the request and
          work it, and sees the same sheet from either list. */}
      <ReassignTicketsModal
        tickets={handingOver}
        department={chosenDepartment}
        canMove={manager}
        onClose={() => setHandingOver(null)}
        onDone={(saved, names) => {
          const ids = new Set(saved.map((ticket) => ticket.id));
          setHandingOver(null);
          setPicked(new Set());
          // The rows themselves are refreshed by the next poll; this only
          // stops the toolbar counting a batch that has already moved.
          refresh();
          toast.success(
            saved.length === 1
              ? `#${saved[0].number} reassigned`
              : `${saved.length} tickets reassigned`,
            `Now with ${names}`,
          );
          if (viewing && ids.has(viewing.id)) setViewing(null);
        }}
        onError={(message) => toast.error("Could not reassign", message)}
      />

      <DeleteTicketsModal
        tickets={removing}
        pending={deleting}
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return;
          const ids = removing.map((ticket) => ticket.id);

          setDeleting(true);
          try {
            const result = await deleteTickets(ids);
            setTickets((current) => current.filter((item) => !ids.includes(item.id)));
            setPicked((current) => {
              const next = new Set(current);
              for (const id of ids) next.delete(id);
              return next;
            });
            // The sheet cannot stay open on a ticket that no longer exists.
            if (viewing && ids.includes(viewing.id)) setViewing(null);
            setRemoving(null);
            toast.success(
              result.deleted === 1
                ? `#${result.numbers[0]} deleted`
                : `${result.deleted} tickets deleted`,
              result.numbers.join(", "),
            );
          } catch (caught) {
            toast.error("Could not delete", errorMessage(caught));
          } finally {
            setDeleting(false);
          }
        }}
      />

      <TicketDetailSheet
        ticket={viewing}
        canWork={viewing ? manager || myDepartmentIds.has(viewing.department.id) : false}
        canEdit={viewing ? manager || viewing.raisedBy.id === meId : false}
        tab={tab}
        onTab={setTab}
        onClose={() => setViewing(null)}
        onSaved={(saved) => {
          setTickets((current) => current.map((item) => (item.id === saved.id ? saved : item)));
          setViewing(saved);
        }}
      />
    </>
  );
}

/**
 * The last word before a ticket goes.
 *
 * It names what else goes with it, because a ticket is rarely just a ticket by
 * the time somebody deletes one: the conversation on it and the record of who
 * held it go too, and neither comes back.
 */
function DeleteTicketsModal({
  tickets,
  pending,
  onClose,
  onConfirm,
}: {
  tickets: TicketRecord[] | null;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const many = (tickets?.length ?? 0) > 1;

  return (
    <Modal
      open={tickets !== null && tickets.length > 0}
      onClose={onClose}
      title={many ? `Delete ${tickets?.length} tickets?` : "Delete this ticket?"}
      description="The conversation and the assignment history go with it. This cannot be undone."
      className="max-w-md"
    >
      {tickets && tickets.length > 0 && (
        <>
          <ul className="max-h-56 space-y-1 overflow-y-auto rounded-field bg-ink-50 px-3.5 py-3">
            {tickets.map((ticket) => (
              <li key={ticket.id} className="flex items-baseline gap-2 text-sm">
                <span className="shrink-0 font-bold text-brand-600">#{ticket.number}</span>
                <span className="min-w-0 flex-1 truncate text-ink-700">{ticket.subject}</span>
                <span className="shrink-0 text-xs text-ink-400">{ticket.department.name}</span>
              </li>
            ))}
          </ul>

          <p className="mt-3 text-xs text-ink-500">
            The activity log keeps its record that {many ? "these were" : "this was"} raised and
            deleted.
          </p>

          <div className="mt-4 flex justify-end gap-2 border-t border-line pt-4">
            <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={onConfirm} disabled={pending}>
              {pending ? "Deleting…" : many ? `Delete ${tickets.length}` : "Delete"}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}

/**
 * Hands a batch of tickets to the same people.
 *
 * The list of who is on offer comes from the one department the batch sits
 * with - an assignee belongs to a department, so there is no sensible answer
 * for a batch spanning two, and the toolbar does not offer the button then.
 */
function ReassignTicketsModal({
  tickets,
  department,
  canMove,
  onClose,
  onDone,
  onError,
}: {
  tickets: TicketRecord[] | null;
  department: TicketRecord["department"] | null;
  /** An admin may send the batch to another department, not only other people. */
  canMove: boolean;
  onClose: () => void;
  onDone: (tickets: TicketRecord[], names: string) => void;
  onError: (message: string) => void;
}) {
  const { session } = useAuth();
  const [team, setTeam] = useState<MemberOption[] | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  /** Where they are going. Starts where they are, so nothing moves by accident. */
  const [target, setTarget] = useState("");

  const departmentId = department?.id;
  const open = tickets !== null && tickets.length > 0 && Boolean(departmentId);
  /** The department the people are picked from: the destination, if there is one. */
  const pickFrom = target || departmentId;
  const moving = Boolean(target) && target !== departmentId;

  useEffect(() => {
    if (!open || !pickFrom) return;

    const controller = new AbortController();
    listDepartmentMembers(pickFrom, controller.signal)
      .then(setTeam)
      .catch(() => setTeam([]));

    return () => controller.abort();
  }, [open, pickFrom]);

  // Only an admin is offered the move, so only an admin loads the list.
  useEffect(() => {
    if (!open || !canMove) return;

    const controller = new AbortController();
    listDepartmentOptions(controller.signal)
      .then(setDepartments)
      .catch(() => setDepartments([]));

    return () => controller.abort();
  }, [open, canMove]);

  const close = () => {
    setChosen([]);
    setTeam(null);
    setTarget("");
    onClose();
  };

  const confirm = async () => {
    if (!tickets || (chosen.length === 0 && !moving)) return;

    setPending(true);
    try {
      const result = await reassignTickets(
        tickets.map((ticket) => ticket.id),
        chosen,
        moving ? target : undefined,
      );
      const names = result.assignees.map((person) => person.name).join(", ");
      onDone(
        tickets,
        result.department
          ? names
            ? `${result.department.name} · ${names}`
            : result.department.name
          : names,
      );
      setChosen([]);
      setTeam(null);
      setTarget("");
    } catch (caught) {
      onError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  };

  const many = (tickets?.length ?? 0) > 1;
  const targetName = departments.find((item) => item.id === target)?.name;

  return (
    <Modal
      open={open}
      onClose={close}
      title={many ? `Reassign ${tickets?.length} tickets` : "Reassign this ticket"}
      description={
        canMove
          ? "Send them to another department, or hand them to other people in this one."
          : `Everyone named takes it on together. ${department?.name ?? "The department"} keeps it either way.`
      }
      className="max-w-md"
    >
      {tickets && tickets.length > 0 && (
        <>
          <ul className="max-h-40 space-y-1 overflow-y-auto rounded-field bg-ink-50 px-3.5 py-3">
            {tickets.map((ticket) => (
              <li key={ticket.id} className="flex items-baseline gap-2 text-sm">
                <span className="shrink-0 font-bold text-brand-600">#{ticket.number}</span>
                <span className="min-w-0 flex-1 truncate text-ink-700">{ticket.subject}</span>
                <span className="shrink-0 text-xs text-ink-400">
                  {ticket.assignees.map((person) => person.name).join(", ") || "Nobody"}
                </span>
              </li>
            ))}
          </ul>

          {/* A department is the ticket's home; the people are who holds it
              there. Picking a new home empties the second question, because
              nobody in the old department can answer it any more. */}
          {canMove && (
            <div className="mt-4">
              <p className="mb-1.5 text-sm font-semibold text-ink-800">
                Department
                <span className="ml-1 font-normal text-ink-400">
                  (now with {department?.name ?? "this department"})
                </span>
              </p>
              <SearchSelect
                icon={<Building className="text-ink-500" />}
                options={departments.map((item) => ({
                  value: item.id,
                  label: item.name,
                  hint: item.unit?.name,
                }))}
                value={target || (departmentId ?? "")}
                onChange={(next) => {
                  setTarget(next);
                  // The people belonged to the department they were picked
                  // from, so both the choice and the list go with it.
                  setChosen([]);
                  setTeam(null);
                }}
                placeholder="Keep it where it is"
                emptyMessage="No departments yet"
              />
            </div>
          )}

          <div className="mt-4">
            <p className="mb-1.5 text-sm font-semibold text-ink-800">
              Hand to
              <span className="ml-1 font-normal text-ink-400">
                ({targetName ?? department?.name ?? "this department"},{" "}
                {moving ? "optional" : "one or more"})
              </span>
            </p>
            <MultiSelect
              // Handing work out means handing it to somebody else, so the
              // person doing the handing is not on the list.
              options={(team ?? [])
                .filter((member) => member.id !== session?.id)
                .map((member) => ({
                  value: member.id,
                  label: `${member.name} (${DEPARTMENT_ROLE_LABEL[member.departmentRole]})`,
                }))}
              value={chosen}
              onChange={setChosen}
              placeholder={team === null ? "Loading..." : "Choose one or more people"}
              emptyMessage="Nobody else is in this department"
            />
            <p className="mt-1.5 text-xs text-ink-400">
              {moving
                ? `Leave this empty and ${targetName ?? "the new department"} picks it up itself. Either way it is written to each ticket's history.`
                : "Each handover is written to that ticket's own history."}
            </p>
          </div>

          <div className="mt-4 flex justify-end gap-2 border-t border-line pt-4">
            <Button type="button" variant="outline" size="sm" onClick={close} disabled={pending}>
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={confirm}
              disabled={pending || (chosen.length === 0 && !moving)}
            >
              {pending
                ? moving
                  ? "Moving…"
                  : "Reassigning…"
                : moving
                  ? `Move ${many ? tickets.length : ""}`.trim()
                  : many
                    ? `Reassign ${tickets.length}`
                    : "Reassign"}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
