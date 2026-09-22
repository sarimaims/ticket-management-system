"use client";

import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  AlertCircle,
  ArrowRight,
  Inbox,
  MessagesSquare,
  Plus,
  Search,
  SlidersHorizontal,
  UserCheck,
} from "lucide-react";

import { Card } from "@/components/ui/card";
import { OriginTag, PriorityBadge, StatusBadge, statusToneClasses } from "@/components/ui/badge";
import { Input, Select } from "@/components/ui/field";
import {
  DeadlineVerdict,
  TicketDetailSheet,
  type SheetTab,
} from "@/components/tickets/ticket-detail-sheet";
import { useNotifications } from "@/components/notifications/notification-provider";
import { useToast } from "@/components/ui/toast";
import { Pagination, TableCell, TableHead } from "@/components/ui/table";
import { TableSkeleton } from "@/components/ui/skeleton";
import { StatTiles } from "@/components/ui/stat-tiles";
import { updateTicket, type TicketRecord } from "@/lib/tickets";
import { errorMessage } from "@/lib/api";
import { useLiveTickets } from "@/hooks/use-live-tickets";
import { useAuth } from "@/components/auth/auth-provider";
import { isAdmin } from "@/lib/auth";
import { cn, formatDate, formatDateOf, formatTime } from "@/lib/utils";
import type { Stat, TicketStatus } from "@/lib/types";

const STATUSES: TicketStatus[] = [
  "New",
  "Accepted",
  "In Progress",
  "Waiting",
  "Completed",
  "Overdue",
];

const PRIORITIES = ["Low", "Medium", "High", "Critical"];

const COMPACT = "h-9 pr-7 pl-2.5 text-xs";

/** How often a live queue asks the API whether anything moved. */
const REFRESH_MS = 7000;

/** How long a row arrived at from a notification keeps its outline. */
const FLASH_MS = 4000;

function isToday(value: string | null) {
  if (!value) return false;
  return new Date(value).toDateString() === new Date().toDateString();
}

function statsFor(tickets: TicketRecord[], scope: "mine" | "assigned"): Stat[] {
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
      label: "Waiting",
      value: count((ticket) => ticket.status === "Waiting"),
      caption: "",
      tone: "waiting",
    },
    scope === "mine"
      ? {
          label: "Completed",
          value: count((ticket) => ticket.status === "Completed"),
          caption: "",
          tone: "completed",
        }
      : {
          label: "Due Today",
          value: count((ticket) => isToday(ticket.deadline)),
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

/** Every cell in this table, tight enough that the whole row fits on screen. */
const CELL = "px-2 py-2 text-xs align-top";

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
  onOpen,
  onStatus,
}: {
  ticket: TicketRecord;
  scope: "mine" | "assigned";
  mine: boolean;
  /** My department's queue, but I am the one who asked for it. */
  byMe: boolean;
  selected: boolean;
  /** Arrived here from a notification: hold the eye on this row for a moment. */
  flashed: boolean;
  /** How many messages on this ticket the reader has not opened yet. */
  unreadMessages: number;
  onOpen: (ticket: TicketRecord, tab?: SheetTab) => void;
  onStatus: (ticket: TicketRecord, next: TicketStatus) => void;
}) {
  const messages = unreadMessages > 0 ? unreadMessages : ticket.messageCount;

  return (
    <tr
      id={`ticket-row-${ticket.id}`}
      onClick={() => onOpen(ticket)}
      className={cn(
        "cursor-pointer border-b border-line transition-colors last:border-0",
        selected ? "bg-brand-50" : "hover:bg-ink-50/70",
        // Outlined rather than recoloured, so it reads as "this one" without
        // competing with the status tints the row already carries.
        flashed &&
          "bg-status-waiting-bg ring-2 ring-status-waiting-fg ring-inset hover:bg-status-waiting-bg",
      )}
    >
      <TableCell className={cn(CELL, "relative")}>
        {/* A bar on the row's edge rather than a word: it says the same thing
            in three pixels. */}
        {mine && <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-brand-600" />}
        <span className="block font-bold whitespace-nowrap text-brand-600">#{ticket.number}</span>
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
          <span className="mt-0.5 block text-[11px] font-normal text-ink-400">
            {ticket.requestType}
          </span>
        )}
      </TableCell>

      {scope === "assigned" && (
        <TableCell className={cn(CELL, "whitespace-normal")}>
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
      )}

      {/* Where it came from and where it went, read as one move. */}
      <TableCell className={cn(CELL, "whitespace-normal")}>
        <span className="flex flex-wrap items-center gap-1">
          {ticket.fromDepartments.length === 0 ? (
            // Empty for a manager: they sit above the departments, so the
            // Raised By tag carries the origin instead.
            <span className="text-ink-300">—</span>
          ) : (
            ticket.fromDepartments.map((item) => (
              <span
                key={item.id}
                className="rounded bg-ink-100 px-1.5 py-0.5 text-[11px] font-medium text-ink-600"
              >
                {item.name}
              </span>
            ))
          )}
          <ArrowRight className="size-3 shrink-0 text-ink-300" />
          <span className="rounded bg-brand-50 px-1.5 py-0.5 text-[11px] font-semibold text-brand-700">
            {ticket.department.name}
          </span>
        </span>
      </TableCell>

      <TableCell className={CELL}>
        <PriorityBadge priority={ticket.priority} className="px-1.5 py-0.5 text-[11px]" />
      </TableCell>

      <TableCell className={CELL}>
        {scope === "assigned" ? (
          <Select
            onClick={(event) => event.stopPropagation()}
            className={cn(
              "h-7 w-[104px] border-transparent pr-6 pl-2 text-[11px] font-semibold",
              statusToneClasses(ticket.status),
            )}
            value={ticket.status}
            onChange={(event) => onStatus(ticket, event.target.value as TicketStatus)}
            aria-label={`Status of ${ticket.number}`}
          >
            {STATUSES.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </Select>
        ) : (
          <StatusBadge status={ticket.status} className="px-1.5 py-0.5 text-[11px]" />
        )}
      </TableCell>

      <TableCell className={cn(CELL, "whitespace-nowrap")}>
        <span className="block leading-tight">{formatDateOf(ticket.createdAt)}</span>
        <span className="block text-[11px] leading-tight text-ink-400">
          {formatTime(ticket.createdAt)}
        </span>
      </TableCell>

      {/* The date asked for, with what the department promised back under it:
          green if it meets the ask, amber if it runs past it. */}
      <TableCell className={cn(CELL, "whitespace-nowrap")}>
        <span className="block leading-tight">
          {ticket.deadline ? formatDate(ticket.deadline.slice(0, 10)) : "—"}
        </span>
        <span className="mt-0.5 block text-[11px] leading-tight">
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
              "inline-flex h-7 shrink-0 items-center gap-1 rounded-lg px-1.5 text-[11px] font-bold transition-colors",
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
        </span>
      </TableCell>
    </tr>
  );
});

/** A quiet marker that the queue is keeping itself current. */
function LiveTag({ syncedAt }: { syncedAt: number | null }) {
  return (
    <span
      className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 text-[11px] font-semibold text-ink-500"
      title={
        syncedAt
          ? `Checks every ${REFRESH_MS / 1000}s · last change ${new Date(syncedAt).toLocaleTimeString()}`
          : `Checks every ${REFRESH_MS / 1000}s`
      }
    >
      <span className="relative flex size-2">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-status-completed-fg opacity-60" />
        <span className="relative inline-flex size-2 rounded-full bg-status-completed-fg" />
      </span>
      Live
    </span>
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
  scope: "mine" | "assigned";
  live?: boolean;
}) {
  const { tickets, setTickets, loading, error, syncedAt, hold } = useLiveTickets({
    scope,
    intervalMs: live ? REFRESH_MS : null,
  });

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [viewing, setViewing] = useState<TicketRecord | null>(null);
  // Which pane the sheet opens on. Held here rather than inside the sheet, so
  // the chat icon on a row can go straight to the conversation.
  const [tab, setTab] = useState<SheetTab>("details");
  const [mineOnly, setMineOnly] = useState(false);
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
  const isMine = useCallback(
    (ticket: TicketRecord) => scope === "assigned" && ticket.assignee?.id === meId,
    [scope, meId],
  );

  const manager = isAdmin(session);
  const myDepartmentIds = useMemo(
    () => new Set((session?.departments ?? []).map((membership) => membership.id)),
    [session],
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

  const stats = useMemo(() => statsFor(tickets, scope), [tickets, scope]);

  const mineCount = useMemo(() => tickets.filter(isMine).length, [tickets, isMine]);

  const rows = useMemo(() => {
    const term = deferredQuery.trim().toLowerCase();
    return tickets.filter((ticket) => {
      if (
        term &&
        !`${ticket.number} ${ticket.subject} ${ticket.requestType}`.toLowerCase().includes(term)
      )
        return false;
      if (status && ticket.status !== status) return false;
      if (priority && ticket.priority !== priority) return false;
      if (mineOnly && !isMine(ticket)) return false;
      return true;
    });
  }, [tickets, deferredQuery, status, priority, mineOnly, isMine]);

  const columns = scope === "mine" ? 8 : 9;

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
    setStatus("");
    setPriority("");
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

      <div className={cn("transition-[padding] duration-200", viewing && "xl:pr-[28rem]")}>
      <StatTiles stats={stats} loading={loading} />

      <Card className="mt-3 overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-2">
          <div className="min-w-44 flex-1">
            <Input
              className="h-9 pl-10 text-xs"
              icon={<Search className="text-ink-400" />}
              placeholder="Search by ticket ID, subject or keyword..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search tickets"
            />
          </div>

          <Select
            className={COMPACT + " w-32 shrink-0"}
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            aria-label="Filter by status"
          >
            <option value="">All Status</option>
            {STATUSES.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </Select>

          <Select
            className={COMPACT + " w-32 shrink-0"}
            value={priority}
            onChange={(event) => setPriority(event.target.value)}
            aria-label="Filter by priority"
          >
            <option value="">All Priorities</option>
            {PRIORITIES.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </Select>

          {scope === "assigned" && (
            <button
              type="button"
              onClick={() => setMineOnly((current) => !current)}
              aria-pressed={mineOnly}
              className={cn(
                "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition-colors",
                mineOnly
                  ? "border-brand-600 bg-brand-50 text-brand-700"
                  : "border-line-strong bg-surface text-ink-600 hover:bg-ink-50",
              )}
            >
              <UserCheck className="size-4" />
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

          {live && <LiveTag syncedAt={syncedAt} />}

          {scope === "mine" && (
            <Link
              href="/create-ticket"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-600 px-3.5 text-[13px] font-semibold text-white shadow-sm shadow-brand-600/25 transition-colors hover:bg-brand-700"
            >
              <Plus className="size-4" strokeWidth={2.5} />
              Create Ticket
            </Link>
          )}
        </div>

        <div className="overflow-x-auto">
          {/* Fluid rather than held open at a fixed width: on a desktop every
              column fits and nothing scrolls sideways, and the min-width below
              only catches phones. */}
          <table className="w-full min-w-[820px] border-collapse">
            <thead className="border-b border-line bg-ink-50/60">
              <tr>
                <TableHead sortable className="px-2 py-2">
                  Ticket
                </TableHead>
                <TableHead sortable className="w-[24%] px-2 py-2">
                  Subject
                </TableHead>
                {scope === "assigned" && (
                  <TableHead sortable className="px-2 py-2">
                    Raised By
                  </TableHead>
                )}
                <TableHead sortable className="px-2 py-2">
                  From → To
                </TableHead>
                <TableHead sortable className="px-2 py-2">
                  Priority
                </TableHead>
                <TableHead sortable className="px-2 py-2">
                  Status
                </TableHead>
                <TableHead sortable className="px-2 py-2">
                  Created
                </TableHead>
                <TableHead sortable className="px-2 py-2" title="Asked for, and what was promised back">
                  Deadline
                </TableHead>
                <TableHead className="px-2 py-2">Actions</TableHead>
              </tr>
            </thead>
            <tbody>
              {loading && <TableSkeleton rows={6} columns={columns} />}

              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={columns} className="px-3 py-12 text-center">
                    <Inbox className="mx-auto size-6 text-ink-300" />
                    <p className="mt-2 text-sm font-semibold text-ink-700">
                      {mineOnly
                        ? "Nothing assigned to you"
                        : scope === "mine"
                          ? "No requests yet"
                          : "Nothing in your queue"}
                    </p>
                    <p className="mt-0.5 text-sm text-ink-400">
                      {mineOnly
                        ? "Tickets picked up in your name show here."
                        : scope === "mine"
                          ? "Raise one and it lands in that department's queue."
                          : "Tickets raised to your departments will appear here."}
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
                    mine={isMine(ticket)}
                    byMe={scope === "assigned" && ticket.raisedBy.id === meId}
                    selected={viewing?.id === ticket.id}
                    flashed={flashed === ticket.id}
                    unreadMessages={unreadByTicket.get(ticket.id) ?? 0}
                    onOpen={openTicket}
                    onStatus={applyStatus}
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
