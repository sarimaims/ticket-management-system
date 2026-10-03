"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarCheck,
  CalendarClock,
  CheckCircle2,
  CircleSlash,
  Download,
  FileText,
  GitCommitVertical,
  History,
  MessagesSquare,
  Paperclip,
  PencilLine,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { OriginTag, PriorityBadge, RoleTag, StatusBadge } from "@/components/ui/badge";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { MultiSelect } from "@/components/ui/multi-select";
import { DateField, todayISO } from "@/components/tickets/date-field";
import { TicketChat } from "@/components/tickets/ticket-chat";
import { TicketHistory } from "@/components/tickets/ticket-history";
import { StatusPicker } from "@/components/tickets/status-picker";
import { ApprovalCard } from "@/components/tickets/approval-card";
import { TicketTimeline } from "@/components/tickets/ticket-timeline";
import { EscalationCard } from "@/components/tickets/escalation-card";
import { ApprovalConfirmModal } from "@/components/tickets/approval-confirm-modal";
import { CancelTicketModal } from "@/components/tickets/cancel-ticket-modal";
import { useAuth } from "@/components/auth/auth-provider";
import { UserLink } from "@/components/users/user-profile";
import { Designation } from "@/components/users/designation";
import { useNotifications } from "@/components/notifications/notification-provider";
import { useToast } from "@/components/ui/toast";
import { getDepartment, type Member } from "@/lib/departments";
import {
  attachmentHref,
  departmentsOf,
  isShared,
  updateTicket,
  type TicketRecord, APPROVAL_WINDOW_TEXT } from "@/lib/tickets";
import { formatBytes } from "@/lib/uploads";
import { errorMessage } from "@/lib/api";
import { isAdmin, isHead } from "@/lib/auth";
import {
  answerHandover,
  askHandover,
  listHandovers,
  releaseTicket,
  type HandoverRecord,
} from "@/lib/handovers";
import { cn, formatDate, formatDateOf, formatTime } from "@/lib/utils";
import { isClosed } from "@/lib/types";
import type { TicketPriority, TicketStatus } from "@/lib/types";

const PRIORITIES: TicketPriority[] = ["Low", "Medium", "High", "Critical"];

/** What an empty box is called when the raiser is told to fill it. */
const LABEL = {
  subject: "Subject",
  description: "Description",
  requestType: "Request type",
  deadline: "Deadline",
} as const;

const dayOf = (value: string | null) => value?.slice(0, 10) ?? "";

/** The people holding a ticket, in one readable line. */
const holders = (people: { name?: string }[]) =>
  people.length === 0 ? "Nobody yet" : people.map((person) => person.name ?? "Someone").join(", ");

/** A stable key for a set of people, so two of them can be compared. */
const holderKey = (people: { id: string }[]) =>
  people
    .map((person) => person.id)
    .sort()
    .join(",");

/** What actually moved, so the toast names it instead of saying "saved". */
function changes(before: TicketRecord, after: TicketRecord) {
  const parts: string[] = [];
  if (before.status !== after.status) parts.push(`Status: ${after.status}`);
  if (holderKey(before.assignees) !== holderKey(after.assignees)) {
    parts.push(`Assignee: ${holders(after.assignees)}`);
  }
  if (dayOf(before.committedDeadline) !== dayOf(after.committedDeadline)) {
    parts.push(
      after.committedDeadline
        ? `Committed to finish by ${formatDate(dayOf(after.committedDeadline))}`
        : "Committed date withdrawn",
    );
  }
  if (before.subject !== after.subject) parts.push("Subject");
  if (before.description !== after.description) parts.push("Description");
  if (before.requestType !== after.requestType) parts.push(`Request type: ${after.requestType}`);
  if (before.priority !== after.priority) parts.push(`Priority: ${after.priority}`);
  if ((before.project ?? "") !== (after.project ?? "")) parts.push("Project");
  if (dayOf(before.deadline) !== dayOf(after.deadline)) {
    parts.push(`Deadline: ${formatDate(dayOf(after.deadline))}`);
  }
  return parts;
}

/**
 * A promised date only means something next to the date that was asked for,
 * so the two are always shown compared.
 */
export function DeadlineVerdict({
  requested,
  committed,
  inline,
}: {
  requested: string | null;
  committed: string | null;
  inline?: boolean;
}) {
  if (!committed) return <span className="font-normal text-ink-400">—</span>;

  const day = committed.slice(0, 10);
  const asked = requested ? requested.slice(0, 10) : null;
  const late = asked ? day > asked : false;

  if (inline) {
    return (
      <span
        className={cn(
          "font-semibold",
          late ? "text-status-waiting-fg" : "text-status-completed-fg",
        )}
      >
        {late
          ? `That is after the ${formatDate(asked!)} they asked for.`
          : "That meets what they asked for."}
      </span>
    );
  }

  return (
    <span
      className={cn(
        "rounded px-1.5 py-0.5 text-[11px] font-semibold",
        late
          ? "bg-status-waiting-bg text-status-waiting-fg"
          : "bg-status-completed-bg text-status-completed-fg",
      )}
      title={late ? "Later than the requested date" : "Meets the requested date"}
    >
      {formatDate(day)}
    </span>
  );
}

type Draft = {
  subject: string;
  description: string;
  requestType: string;
  priority: TicketPriority;
  project: string;
  deadline: string;
};

/**
 * The raiser's own form, shown in place of the details they are changing. Only
 * the request lives here: status, assignee and the committed date belong to
 * the department and are not on offer.
 */
function RequestEditor({
  draft,
  set,
  invalid,
  departmentName,
}: {
  draft: Draft;
  set: <K extends keyof Draft>(key: K, value: Draft[K]) => void;
  invalid: string[];
  departmentName: string;
}) {
  return (
    <div className="space-y-2.5">
      <p className="flex items-start gap-1.5 rounded-md bg-ink-50 px-2 py-1.5 text-[11px] text-ink-500">
        <PencilLine className="mt-px size-3.5 shrink-0 text-ink-400" />
        <span>
          Editing your request. <span className="font-semibold text-ink-700">{departmentName}</span>{" "}
          sees the new version and is notified of what changed.
        </span>
      </p>

      <Field label="Subject" required htmlFor="edit-subject">
        <Input
          id="edit-subject"
          value={draft.subject}
          invalid={invalid.includes("subject")}
          onChange={(event) => set("subject", event.target.value)}
        />
      </Field>

      <Field label="Description" required htmlFor="edit-description">
        <Textarea
          id="edit-description"
          maxLength={1000}
          className="min-h-24"
          value={draft.description}
          invalid={invalid.includes("description")}
          onChange={(event) => set("description", event.target.value)}
        />
      </Field>

      {/* The form stopped asking for this, so it is only offered where one
          was already given. */}
      {draft.requestType && (
        <Field label="Request type" htmlFor="edit-request-type">
          <Input
            id="edit-request-type"
            value={draft.requestType}
            invalid={invalid.includes("requestType")}
            onChange={(event) => set("requestType", event.target.value)}
          />
        </Field>
      )}

      <Field label="Priority" required htmlFor="edit-priority">
        <Select
          id="edit-priority"
          className="h-8"
          value={draft.priority}
          onChange={(event) => set("priority", event.target.value as TicketPriority)}
        >
          {PRIORITIES.map((level) => (
            <option key={level}>{level}</option>
          ))}
        </Select>
      </Field>

      <Field label="Deadline" required htmlFor="edit-deadline">
        <DateField
          id="edit-deadline"
          min={todayISO()}
          value={draft.deadline}
          onChange={(value) => set("deadline", value)}
          clearable={false}
          invalid={invalid.includes("deadline")}
        />
      </Field>

      <Field label="Related project" htmlFor="edit-project">
        <Input
          id="edit-project"
          placeholder="Optional"
          value={draft.project}
          onChange={(event) => set("project", event.target.value)}
        />
      </Field>
    </div>
  );
}

export type SheetTab = "details" | "chat" | "history";

/**
 * Three panes on one ticket: what it says, what is being said about it, and
 * who has held it.
 *
 * The chat badge prefers unread over total, because "two you have not read" is
 * the thing worth walking across the room for; a quiet thread just says how
 * long it is.
 */
function Tabs({
  tab,
  onTab,
  count,
  unread,
  onClose,
}: {
  tab: SheetTab;
  onTab: (tab: SheetTab) => void;
  count: number;
  unread: number;
  onClose: () => void;
}) {
  const style = (value: SheetTab) =>
    cn(
      "flex-1 border-b-2 px-2 py-1.5 text-[12px] font-semibold transition-colors",
      tab === value
        ? // The conversation has its own colour throughout, and the tab that
          // opens it is part of that.
          value === "chat"
          ? "border-chat-accent text-chat-accent-strong"
          : "border-brand-600 text-brand-700"
        : "border-transparent text-ink-500 hover:text-ink-800",
    );

  return (
    <div role="tablist" className="flex border-b border-line px-1.5 pt-2">
      <button
        type="button"
        role="tab"
        aria-selected={tab === "details"}
        onClick={() => onTab("details")}
        className={style("details")}
      >
        <span className="inline-flex items-center justify-center gap-1.5">
          <FileText className="size-3.5" />
          Details
        </span>
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={tab === "chat"}
        onClick={() => onTab("chat")}
        className={style("chat")}
      >
        <span className="inline-flex items-center justify-center gap-1.5">
          <MessagesSquare className="size-3.5" />
          Chat
          {(unread > 0 || count > 0) && (
            <span
              className={cn(
                "rounded-full px-1 py-0.5 text-[10px] leading-none font-bold",
                unread > 0 ? "bg-chat-accent text-white" : "bg-ink-100 text-ink-600",
              )}
            >
              {unread > 0 ? unread : count}
            </span>
          )}
        </span>
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={tab === "history"}
        onClick={() => onTab("history")}
        className={style("history")}
      >
        <span className="inline-flex items-center justify-center gap-1.5">
          <History className="size-3.5" />
          History
        </span>
      </button>

      {/* The way out lives here now that the band above it is gone. Escape
          still closes the sheet too. */}
      <button
        type="button"
        onClick={onClose}
        className="my-auto ml-1 grid size-6 shrink-0 place-items-center rounded text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700"
        aria-label="Close details"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

/**
 * A tint per kind of fact.
 *
 * The pane is a stack of short sections that all look alike, and a reader
 * scanning for one of them is looking for a position on the page rather than
 * reading the headings. Colour makes that position findable: the same section
 * is the same colour on every ticket, so the eye learns where "when is it due"
 * lives and stops re-reading the labels.
 */
const GROUP_TONE = {
  route: { card: "bg-status-progress-bg/50", label: "text-status-progress-fg" },
  who: { card: "bg-tile-admin-bg", label: "text-tile-admin-fg" },
  dates: { card: "bg-status-accepted-bg/70", label: "text-status-accepted-fg" },
  work: { card: "bg-status-waiting-bg/45", label: "text-status-waiting-fg" },
  plain: { card: "bg-ink-50", label: "text-ink-400" },
} as const;

type GroupTone = keyof typeof GROUP_TONE;

/**
 * A few related facts under one heading.
 *
 * The pane used to be one undifferentiated grid of ten cells, which is a lot
 * to read when the question in your head is usually just one of "who has it",
 * "where is it going" or "when is it due".
 */
function Group({
  title,
  tone = "plain",
  children,
}: {
  /** Left out where the block says what it is without being told. */
  title?: string;
  tone?: GroupTone;
  children: React.ReactNode;
}) {
  const style = GROUP_TONE[tone];

  return (
    <section className={cn("mt-2 rounded-lg px-2.5 py-2", style.card)}>
      {title && (
        <p className={cn("text-[10px] font-bold tracking-wider uppercase", style.label)}>{title}</p>
      )}
      <dl className={cn(title && "mt-1")}>{children}</dl>
    </section>
  );
}

/** One fact: its name on the left, its value on the right. */
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <dt className="shrink-0 text-[11px] text-ink-500">{label}</dt>
      <dd className="flex min-w-0 flex-wrap items-center justify-end gap-x-1.5 gap-y-0.5 text-right text-[12px] font-semibold break-words text-ink-900">
        {children}
      </dd>
    </div>
  );
}

/** A value that is not there, said quietly. */
function Blank({ children = "—" }: { children?: React.ReactNode }) {
  return <span className="font-normal text-ink-400">{children}</span>;
}

/** The label above a control in the work panel, at the size of a Cell's. */
function MiniLabel({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-1 flex items-center gap-1 text-[10px] font-semibold tracking-wide text-ink-400 uppercase"
    >
      {children}
    </label>
  );
}

/**
 * Both ends of the ticket's journey, as a table without being one.
 *
 * Naming every value on the value itself - "UNIT Central, DEPT Digital" - said
 * the same three words twice over and made the line twice as long. A heading
 * row says it once: the columns carry the meaning, the rows carry the answers,
 * and From and To line up underneath each other so the move reads across.
 *
 * Not a real <table>: this is two records of three fields, and the sheet is
 * narrow enough that a table's own layout rules would fight the wrapping.
 */
const ROUTE_COLUMNS = "grid grid-cols-[2.4rem_minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,1.1fr)] gap-x-2";

function RouteHead() {
  return (
    <div className={cn(ROUTE_COLUMNS, "border-b border-line px-1 pb-1")}>
      <span />
      {["Unit", "Department", "People"].map((column) => (
        <span
          key={column}
          className="truncate text-[9px] font-bold tracking-[0.07em] text-ink-400 uppercase"
        >
          {column}
        </span>
      ))}
    </div>
  );
}

/** One end of the journey: the row under the headings. */
function Route({
  label,
  tone,
  units,
  departments,
  people,
  extra,
}: {
  label: string;
  /** Which end this is, in the same two colours the tickets table uses. */
  tone: "from" | "to";
  units: string;
  departments: string;
  people: React.ReactNode;
  extra?: React.ReactNode;
}) {
  return (
    <div className={cn(ROUTE_COLUMNS, "items-start rounded px-1 py-1.5 hover:bg-ink-50/70")}>
      <span
        className={cn(
          "text-[10px] font-bold tracking-wide uppercase",
          tone === "from" ? "text-route-from-fg" : "text-route-to-fg",
        )}
      >
        {label}
      </span>

      <span className="min-w-0 text-[12px] break-words text-ink-600">{units || <Blank />}</span>

      {/* The department is the load-bearing word on each line, so it is the one
          that wears the end's colour. */}
      <span
        className={cn(
          "min-w-0 text-[12px] font-semibold break-words",
          tone === "from" ? "text-route-from-fg" : "text-route-to-fg",
        )}
      >
        {departments || <Blank />}
      </span>

      <span className="flex min-w-0 flex-wrap items-center gap-1 text-[12px] font-semibold break-words text-ink-900">
        {people}
        {extra}
      </span>
    </div>
  );
}

/**
 * A person as a picker shows them: their name, their title in this department
 * as a pill after it, and whether they run it at the far end. The title says
 * who to pick; the role alone only says whether they are the head.
 */
function pickerOption(member: Member, departmentId: string) {
  return {
    value: member.id,
    // The name alone, because it is also what the closed control shows.
    label: member.name,
    tag: member.departments.find((item) => item.id === departmentId)?.designation || undefined,
    badge: <RoleTag role={member.departmentRole} className="px-1.5 py-px text-[10px]" />,
  };
}

/** Unit names under a set of departments, each named once. */
const unitNames = (of: { unit?: { name?: string } | null }[]) =>
  [...new Set(of.map((item) => item.unit?.name).filter(Boolean))].join(", ");

/**
 * Everything known about one ticket, in a sheet beside the list. Two different
 * rights, never both: `canWork` lets the receiving department move the ticket
 * along, `canEdit` lets the person who raised it change what they asked for.
 */
export function TicketDetailSheet({
  ticket,
  canWork,
  canEdit = false,
  tab,
  onTab,
  onClose,
  onSaved,
  readOnly,
}: {
  ticket: TicketRecord | null;
  canWork: boolean;
  canEdit?: boolean;
  /**
   * Opened to follow rather than to take part - a head looking in on what
   * their team asked of another department. Says so, and keeps the chat to
   * reading.
   */
  readOnly?: string;
  /** Which pane is open. Held by the list, so a row can open straight to the
      conversation and switching tickets does not land on the wrong one. */
  tab: SheetTab;
  onTab: (tab: SheetTab) => void;
  onClose: () => void;
  onSaved: (ticket: TicketRecord) => void;
}) {
  useEffect(() => {
    if (!ticket) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [ticket, onClose]);

  /**
   * A press anywhere outside the sheet closes it - on a wide screen too, where
   * there is no backdrop because the list behind stays in use. Pressing another
   * row closes this one and the click that follows opens that one.
   *
   * Pickers, menus, dialogs and toasts opened from inside the sheet are drawn
   * on the body rather than inside it, so a press on one of those is not
   * "outside" and leaves the sheet where it is.
   */
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!ticket) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (!target || panel.current?.contains(target)) return;
      if (target.closest('[role="dialog"], [role="menu"], [role="listbox"], [role="alert"]')) {
        return;
      }
      onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [ticket, onClose]);

  return (
    <>
      {ticket && (
        <div
          className="fixed inset-0 z-40 bg-ink-900/30 xl:hidden"
          onClick={onClose}
          aria-hidden="true"
          // Below xl the sheet covers the list, so the page holds still.
          data-scroll-lock
        />
      )}

      <aside
        ref={panel}
        aria-hidden={!ticket}
        aria-label="Ticket details"
        className={cn(
          // Starts at the very top: the sheet owns the screen while it is
          // open, rather than hanging below a bar that belongs to the page
          // behind it.
          "fixed inset-y-0 right-0 z-50 flex w-full max-w-[25rem] flex-col border-l border-line bg-surface shadow-2xl shadow-ink-900/10 transition-transform duration-200",
          ticket ? "translate-x-0" : "translate-x-full",
        )}
      >
        {/* Keyed so opening a different ticket starts from that ticket's values. */}
        {ticket && (
          <SheetBody
            key={ticket.id}
            ticket={ticket}
            canWork={canWork}
            canEdit={canEdit}
            tab={tab}
            onTab={onTab}
            onClose={onClose}
            onSaved={onSaved}
            readOnly={readOnly}
          />
        )}
      </aside>
    </>
  );
}

/**
 * Who hands a ticket over, and who has to ask.
 *
 * A head runs the department and a manager oversees all of them, so both move
 * work directly. Whoever raised it does not: asking for something says what is
 * needed and by when, not whose desk it lands on, and a requester reaching into
 * another department's rota is how work is put on people who never agreed to it.
 *
 * Everyone else asks a colleague and waits to be taken up on it: putting a
 * deadline on somebody's desk without their knowing is how work goes missing.
 * The API applies the same rule.
 */
function assignsDirectly(session: ReturnType<typeof useAuth>["session"], ticket: TicketRecord) {
  if (isAdmin(session)) return true;
  // A shared ticket has a head per department; any of them hands out their part.
  const here = new Set(departmentsOf(ticket).map((department) => department.id));
  return (session?.departments ?? []).some(
    (membership) => here.has(membership.id) && membership.role === "head",
  );
}

/**
 * Which of a ticket's departments this person may hand out: every one for an
 * admin, the ones they head for a head, and for anyone else the ones they are
 * in - where they can ask a colleague to take it.
 */
function editableDepartments(
  session: ReturnType<typeof useAuth>["session"],
  ticket: TicketRecord,
  direct: boolean,
) {
  const ids = departmentsOf(ticket).map((department) => department.id);
  if (isAdmin(session)) return ids;
  const mine = session?.departments ?? [];
  return ids.filter((id) =>
    mine.some((membership) => membership.id === id && (!direct || membership.role === "head")),
  );
}

function SheetBody({
  ticket,
  canWork,
  canEdit,
  tab,
  onTab,
  onClose,
  onSaved,
  readOnly,
}: {
  ticket: TicketRecord;
  canWork: boolean;
  canEdit: boolean;
  tab: SheetTab;
  onTab: (tab: SheetTab) => void;
  onClose: () => void;
  onSaved: (ticket: TicketRecord) => void;
  readOnly?: string;
}) {
  const [status, setStatus] = useState<TicketStatus>(ticket.status);
  // The requested date is not ours to touch; the commitment is.
  const [committed, setCommitted] = useState(
    ticket.committedDeadline ? ticket.committedDeadline.slice(0, 10) : "",
  );
  /**
   * Why that date. Required by the API whenever the date moves, so it is asked
   * for here rather than discovered when the save is refused - and it starts
   * empty on every open, because last week's reason does not explain this
   * week's date.
   */
  const [why, setWhy] = useState("");
  const [whyMissing, setWhyMissing] = useState(false);
  /** The promise is not editable until they ask for it: a date already given
      is a commitment, not a field to brush past. */
  const [movingDate, setMovingDate] = useState(!ticket.committedDeadline);
  /**
   * In Progress - already, or being put there now - the date it is due can
   * only come closer: no later promise, and no withdrawing one when the
   * requested date is later. The API refuses the same; this keeps the picker
   * from offering it.
   */
  const dueNow = (ticket.committedDeadline ?? ticket.deadline)?.slice(0, 10) ?? "";
  const requestedDay = ticket.deadline?.slice(0, 10) ?? "";
  const underWay = Boolean(ticket.underWay) || status === "In Progress";
  const noLaterThan = underWay && dueNow ? dueNow : undefined;
  const pushesBack = (next: string, target: TicketStatus) =>
    (Boolean(ticket.underWay) || target === "In Progress") &&
    Boolean(dueNow) &&
    (next || requestedDay) > dueNow;
  const [assignees, setAssignees] = useState(ticket.assignees.map((person) => person.id));
  /** People on offer, each stamped with the ticket department they were loaded for. */
  const [members, setMembers] = useState<(Member & { forDepartment: string })[]>([]);
  /** Every ask on this ticket, so both sides of one can be shown. */
  const [handovers, setHandovers] = useState<HandoverRecord[]>([]);
  /** Who this person is proposing to hand it to, before they send the ask. */
  const [asking, setAsking] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  /** Open while Cancelled waits on its remark. */
  const [cancelling, setCancelling] = useState(false);
  /** Asked to finish somebody else's request: the approval box is open. */
  const [approving, setApproving] = useState(false);
  const toast = useToast();

  // The raiser's side of the sheet: reading turns into editing in place, so
  // the request is never shown twice.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => ({
    subject: ticket.subject,
    description: ticket.description,
    requestType: ticket.requestType,
    priority: ticket.priority,
    project: ticket.project ?? "",
    deadline: ticket.deadline ? ticket.deadline.slice(0, 10) : "",
  }));
  const [invalid, setInvalid] = useState<string[]>([]);

  /**
   * How long the thread is. The list only learns this when it next refreshes,
   * so once the chat has been open it reports its own count and the badge
   * stops lagging behind what the reader can see.
   */
  const [chatCount, setChatCount] = useState<number | null>(null);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const closeTimeline = useCallback(() => setTimelineOpen(false), []);
  // Asked for sign-off, and not refused since: the latest ask still stands.
  const sentForApproval =
    Boolean(ticket.resolvedAt) &&
    !ticket.rejectedAt &&
    (ticket.status === "Resolved" || ticket.status === "Completed");

  // The feed is the only per-person record of what has been read, so it is
  // also what says whether this ticket has anything waiting.
  const { items } = useNotifications();
  const unread = useMemo(
    () =>
      items.filter(
        (item) =>
          (item.type === "ticket.message" || item.type === "ticket.mention") &&
          !item.read &&
          item.ticket === ticket.id,
      ).length,
    [items, ticket.id],
  );

  // A department name is only missing when the record was never populated.
  // A shared ticket names every department it went to.
  const departmentName =
    departmentsOf(ticket)
      .map((department) => department.name)
      .filter(Boolean)
      .join(", ") || "That department";

  const set = <K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setInvalid((current) => current.filter((item) => item !== key));
  };

  const cancelEdit = () => {
    setDraft({
      subject: ticket.subject,
      description: ticket.description,
      requestType: ticket.requestType,
      priority: ticket.priority,
      project: ticket.project ?? "",
      deadline: ticket.deadline ? ticket.deadline.slice(0, 10) : "",
    });
    setInvalid([]);
    setEditing(false);
  };

  const { session } = useAuth();
  const direct = assignsDirectly(session, ticket);
  const meId = session?.id;
  // Finishing somebody else's request asks them first; your own does not, and
  // one already waiting or done has nothing left to ask.
  const sendsForApproval =
    ticket.raisedBy.id !== meId && ticket.status !== "Resolved" && ticket.status !== "Completed";

  const loadHandovers = useCallback(() => {
    listHandovers(ticket.id)
      .then(setHandovers)
      .catch(() => setHandovers([]));
  }, [ticket.id]);

  useEffect(() => {
    if (!canWork) return;
    const controller = new AbortController();
    listHandovers(ticket.id, controller.signal)
      .then(setHandovers)
      .catch(() => setHandovers([]));
    return () => controller.abort();
  }, [ticket.id, canWork]);

  /** The one open ask addressed to this person, if there is one. */
  const waitingOnMe = handovers.find(
    (item) => item.status === "pending" && item.to.some((person) => person.id === meId),
  );

  /** And the one they sent themselves, still unanswered. */
  const sentByMe = handovers.find(
    (item) => item.status === "pending" && item.requestedBy.id === meId,
  );

  /** Only somebody holding a ticket has anything to hand on. */
  const holdsIt = ticket.assignees.some((person) => person.id === meId);

  /** Transferring is how a user passes work on; a head assigns or releases instead. */
  const transfers = !direct && !isHead(session);

  /** Puts the ask in front of the people chosen above. */
  const sendAsk = async () => {
    if (asking.length === 0) return;

    setPending(true);
    try {
      await askHandover(ticket.id, asking);
      setAsking([]);
      loadHandovers();
      toast.success(
        `Asked ${asking.length === 1 ? "1 person" : `${asking.length} people`}`,
        "It moves to whoever accepts first.",
      );
    } catch (caught) {
      toast.error("Could not send the request", errorMessage(caught));
    } finally {
      setPending(false);
    }
  };

  /** Steps off the ticket; with nobody else on it, it goes back to unheld. */
  const release = async () => {
    setPending(true);
    try {
      const now = await releaseTicket(ticket.id);
      setAsking([]);
      loadHandovers();
      // The ticket itself moved, so the pane behind this has to be told.
      const fresh = await updateTicket(ticket.id, {});
      onSaved(fresh);
      toast.success(
        `#${ticket.number} released`,
        now.length > 0
          ? `Now with ${holders(now)}`
          : `Back on ${ticket.department.name ?? "the department"}'s list for its head to hand out`,
      );
    } catch (caught) {
      toast.error("Could not release the ticket", errorMessage(caught));
    } finally {
      setPending(false);
    }
  };

  /** Accepting is what actually moves the ticket; declining just passes. */
  const answer = async (request: HandoverRecord, choice: "accept" | "decline" | "cancel") => {
    setPending(true);
    try {
      await answerHandover(ticket.id, request.id, choice);
      loadHandovers();

      if (choice === "accept") {
        // The ticket itself moved, so the pane behind this has to be told.
        const fresh = await updateTicket(ticket.id, {});
        onSaved(fresh);
        toast.success(`#${ticket.number} is yours`, `Taken on from ${request.requestedBy.name}`);
      } else if (choice === "decline") {
        toast.show({ title: `#${ticket.number} declined`, tone: "info" });
      } else {
        toast.show({ title: "Request withdrawn", tone: "info" });
      }
    } catch (caught) {
      toast.error("Could not answer", errorMessage(caught));
    } finally {
      setPending(false);
    }
  };

  /** Sends the request as the raiser now wants it; the department is told. */
  const saveEdit = async () => {
    // requestType is not in this list: the form no longer asks for one, so an
    // edit must not be blocked by a ticket that never had it.
    const gaps = (["subject", "description", "deadline"] as const).filter(
      (key) => !draft[key].trim(),
    );
    if (gaps.length > 0) {
      setInvalid([...gaps]);
      toast.error(
        gaps.length === 1 ? `${LABEL[gaps[0]]} is required` : "Some required fields are empty",
        gaps.length === 1 ? undefined : gaps.map((key) => LABEL[key]).join(", "),
      );
      return;
    }

    setPending(true);
    try {
      const saved = await updateTicket(ticket.id, {
        subject: draft.subject.trim(),
        description: draft.description.trim(),
        requestType: draft.requestType.trim(),
        priority: draft.priority,
        project: draft.project.trim(),
        deadline: draft.deadline,
      });
      onSaved(saved);
      setEditing(false);

      const moved = changes(ticket, saved);
      if (moved.length === 0) {
        toast.show({
          title: `#${ticket.number} has no changes to save`,
          tone: "info",
        });
      } else {
        toast.success(
          `#${ticket.number} updated`,
          `${departmentName} has been notified · ${moved.join(" · ")}`,
        );
      }
    } catch (caught) {
      toast.error(`Could not save #${ticket.number}`, errorMessage(caught));
    } finally {
      setPending(false);
    }
  };

  useEffect(() => {
    // Whoever can name somebody needs the list of people to name, which is
    // the receiving department's - the raiser's own department is not it.
    if (!canWork && !direct) return;
    const controller = new AbortController();
    // Every department this viewer may hand out on a shared ticket - a head of
    // IT sees IT's people, an admin sees everybody's.
    const wanted = editableDepartments(session, ticket, direct);
    Promise.all(
      wanted.map((id) =>
        getDepartment(id, controller.signal).then((data) =>
          data.members.map((member) => ({ ...member, forDepartment: id })),
        ),
      ),
    )
      .then((lists) => {
        // Somebody in two of them is offered once, under the first.
        const seen = new Set<string>();
        setMembers(
          lists.flat().filter((member) => (seen.has(member.id) ? false : (seen.add(member.id), true))),
        );
      })
      .catch(() => setMembers([]));
    return () => controller.abort();
    // The ticket's departments decide the list; a re-render with the same ones asks nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [departmentsOf(ticket).map((department) => department.id).join(","), canWork, direct]);

  /** Saving closes the sheet; the toast carries what changed. */
  const save = async (nextStatus: TicketStatus = status, cancelReason?: string) => {
    const promiseMoved = committed !== (ticket.committedDeadline?.slice(0, 10) ?? "");

    if (canWork && promiseMoved && pushesBack(committed, nextStatus)) {
      setMovingDate(true);
      toast.error(
        "The date cannot be pushed back",
        `This ticket is In Progress, so it can only be brought forward - ${formatDate(dueNow)} at the latest.`,
      );
      return;
    }

    // The reason is the whole point of the date: the person waiting is told
    // both, and "moved to the 30th" on its own answers nothing.
    if (promiseMoved && !why.trim()) {
      setWhyMissing(true);
      setMovingDate(true);
      toast.error(
        committed ? "Say why this date" : "Say why you are withdrawing the date",
        `${ticket.raisedBy.name} sees the reason with the date.`,
      );
      document.getElementById("sheet-committed-why")?.focus();
      return;
    }

    setPending(true);
    try {
      const saved = await updateTicket(ticket.id, {
        // How it is going and what date was promised belong to the department
        // doing the work. A raiser opening the same sheet sends neither - the
        // API refuses both, and nothing here should ask it to.
        ...(canWork
          ? {
              status: nextStatus,
              ...(cancelReason ? { cancelReason } : {}),
              committedDeadline: committed || null,
              ...(promiseMoved ? { committedReason: why.trim() } : {}),
            }
          : // The raiser's one status: withdrawing what they asked for. Every
            // other one belongs to the department, and the API refuses them.
            cancelReason
            ? { status: "Cancelled" as const, cancelReason }
            : {}),
        ...(direct
          ? {
              assignees: isAdmin(session)
                ? assignees
                : assignees.filter((id) => members.some((member) => member.id === id)),
            }
          : {}),
      });
      onSaved(saved);

      const moved = changes(ticket, saved);
      if (moved.length === 0) {
        toast.show({
          title: `#${ticket.number} has no changes to save`,
          tone: "info",
        });
      } else if (saved.status === "Resolved" && ticket.status !== "Resolved") {
        // Asked for Completed, got Resolved: the requester signs it off.
        toast.show({
          tone: "approval",
          title: `#${ticket.number} sent for approval`,
          description: `${ticket.raisedBy.name ?? "The requester"} has ${APPROVAL_WINDOW_TEXT} to approve it or send it back. It completes on its own after that.`,
          duration: 8000,
        });
      } else {
        toast.success(
          nextStatus === "Completed" && ticket.status !== "Completed"
            ? `#${ticket.number} completed`
            : nextStatus === "Cancelled" && ticket.status !== "Cancelled"
              ? `#${ticket.number} cancelled`
              : `#${ticket.number} updated`,
          moved.join(" · "),
        );
      }
      onClose();
    } catch (caught) {
      toast.error(`Could not save #${ticket.number}`, errorMessage(caught));
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <ApprovalConfirmModal
        ticket={approving ? ticket : null}
        pending={pending}
        onClose={() => setApproving(false)}
        onConfirm={() => {
          setApproving(false);
          setStatus("Completed");
          void save("Completed");
        }}
      />

      <CancelTicketModal
        ticket={cancelling ? ticket : null}
        pending={pending}
        onClose={() => setCancelling(false)}
        onConfirm={(reason) => {
          setCancelling(false);
          void save("Cancelled", reason);
        }}
      />

      {/* No header band: the sheet opens straight onto its tabs. What the
          band carried has moved into the panes, where it is read rather than
          skipped - the subject onto the description card, the way out onto
          the tab row. */}
      <Tabs
        tab={tab}
        onTab={onTab}
        count={chatCount ?? ticket.messageCount}
        unread={unread}
        onClose={onClose}
      />

      {/* Mounted only while it is being read, so a closed thread costs no
          polling. The details below are hidden rather than unmounted, so an
          edit in progress survives a look at the conversation. */}
      {/* A head following their team's request may still talk in its thread;
          readOnly is about changing the ticket, not about the conversation. */}
      {tab === "chat" && <TicketChat ticket={ticket} onCount={setChatCount} />}
      {tab === "history" && <TicketHistory ticket={ticket} />}

      <div className={cn("flex-1 overflow-y-auto overscroll-contain px-3 py-2.5", tab !== "details" && "hidden")}>
        {readOnly && (
          <p className="mb-2.5 rounded-md border border-royal-100 bg-royal-50 px-2.5 py-1.5 text-[11px] font-medium text-royal-700">
            {readOnly}
          </p>
        )}
        {editing && (
          <RequestEditor
            draft={draft}
            set={set}
            invalid={invalid}
            departmentName={departmentName}
          />
        )}

        <div className={cn(editing && "hidden")}>
          <section className="rounded-lg bg-ink-50 px-2.5 py-2">
            <div className="flex items-start justify-between gap-2">
              <span className="min-w-0">
                <span className="text-[10px] font-semibold text-brand-600">#{ticket.number}</span>
                <h2 className="text-[13px] leading-snug font-bold break-words text-ink-900">
                  {ticket.subject}
                </h2>
              </span>
              <span className="flex shrink-0 items-center gap-1">
                <StatusBadge status={ticket.status} className="px-1.5 py-0.5 text-[10px]" />
                <PriorityBadge priority={ticket.priority} className="px-1.5 py-0.5 text-[10px]" />
              </span>
            </div>
            <p className="mt-1.5 text-[12px] leading-relaxed whitespace-pre-wrap text-ink-700">
              {ticket.description}
            </p>
          </section>

          {/* Why it was called off, where anyone opening it looks first. */}
          {ticket.status === "Cancelled" && ticket.cancelReason && (
            <section className="mt-2 rounded-lg border border-line bg-ink-50 px-2.5 py-2">
              <p className="text-[10px] font-bold tracking-wider text-ink-500 uppercase">
                Cancelled
                {ticket.cancelledByName && (
                  <span className="font-medium normal-case">
                    {" "}
                    · by {ticket.cancelledByName}
                    {ticket.cancelledAt ? ` · ${formatDateOf(ticket.cancelledAt)}` : ""}
                  </span>
                )}
              </p>
              <p className="mt-1 text-[12px] leading-relaxed whitespace-pre-wrap text-ink-700">
                {ticket.cancelReason}
              </p>
            </section>
          )}

          {/* The sign-off: the requester's decision while it is Resolved, and
              how it ended afterwards. */}
          <ApprovalCard ticket={ticket} meId={meId} onAnswered={onSaved} />

          {/* Putting it in front of the super admin, and how that went. */}
          <EscalationCard ticket={ticket} session={session} onChanged={onSaved} />
        </div>

        {/* Grouped rather than gridded: "where it goes", "who", "when" are the
            three questions actually being asked of this pane, and a label beside
            its value reads faster than a label above it. */}
        <div className={cn(editing && "hidden")}>
          {/* Both ends of the move on one line each: unit, department, and the
              person at that end - who raised it, and who has it now. */}
          <Group tone="route">
            <RouteHead />
            <Route
              label="From"
              tone="from"
              units={unitNames(ticket.fromDepartments)}
              departments={ticket.fromDepartments.map((item) => item.name).join(", ")}
              people={
                <span className="flex min-w-0 flex-col">
                  <UserLink
                    id={ticket.raisedBy.id}
                    name={ticket.raisedBy.name ?? "Someone"}
                    className="hover:text-brand-600"
                  />
                  <Designation value={ticket.raisedBy.designation} />
                </span>
              }
              extra={<OriginTag role={ticket.raisedByRole} />}
            />
            {isShared(ticket) &&
              departmentsOf(ticket).map((department, index) => {
                const here = ticket.assignees.filter(
                  (person) => (person.departmentId ?? ticket.department.id) === department.id,
                );
                return (
                  <Route
                    key={department.id}
                    label={index === 0 ? "To" : ""}
                    tone="to"
                    units={department.unit?.name ?? ""}
                    departments={department.name ?? ""}
                    people={
                      here.length > 0 ? (
                        <span className="flex min-w-0 flex-col gap-0.5">
                          {here.map((person) => (
                            <span key={person.id} className="flex min-w-0 flex-col">
                              <UserLink
                                id={person.id}
                                name={person.name ?? "Someone"}
                                className="hover:text-brand-600"
                              />
                              <Designation value={person.designation} />
                            </span>
                          ))}
                        </span>
                      ) : (
                        <Blank>Nobody yet</Blank>
                      )
                    }
                  />
                );
              })}
            {!isShared(ticket) && (
            <Route
              label="To"
              tone="to"
              units={unitNames([ticket.department])}
              departments={ticket.department.name ?? ""}
              people={
                ticket.assignees.length > 0 ? (
                  // Each name its own link: the card is per person, not per
                  // list.
                  // One per line, each with their title in this department.
                  <span className="flex min-w-0 flex-col gap-0.5">
                    {ticket.assignees.map((person) => (
                      <span key={person.id} className="flex min-w-0 flex-col">
                        <UserLink
                          id={person.id}
                          name={person.name ?? "Someone"}
                          className="hover:text-brand-600"
                        />
                        <Designation value={person.designation} />
                      </span>
                    ))}
                  </span>
                ) : (
                  <Blank>Nobody yet</Blank>
                )
              }
            />
            )}
          </Group>

          <Group title="Dates" tone="dates">
            <Fact label="Created">
              {formatDateOf(ticket.createdAt)}
              <span className="font-normal text-ink-400">{formatTime(ticket.createdAt)}</span>
            </Fact>
            <Fact label="Deadline">
              {ticket.deadline ? formatDate(ticket.deadline.slice(0, 10)) : <Blank>Not set</Blank>}
            </Fact>
            {/* What the department promised back, for everyone - the requester
                included, who otherwise never sees it. Green when it meets the
                ask, amber when it runs past it. Left out on a finished ticket
                that never had one. */}
            {(ticket.committedDeadline || !isClosed(ticket.status)) && (
              <Fact label="Promised">
                {ticket.committedDeadline ? (
                  <>
                    <DeadlineVerdict requested={ticket.deadline} committed={ticket.committedDeadline} />
                    {ticket.committedBy?.name && (
                      <span className="w-full font-normal text-ink-500">by {ticket.committedBy.name}</span>
                    )}
                    {ticket.committedReason && (
                      <span className="w-full text-[11px] font-normal text-ink-400">“{ticket.committedReason}”</span>
                    )}
                  </>
                ) : (
                  <Blank>Not promised yet</Blank>
                )}
              </Fact>
            )}
            {/* When the department last asked the requester to sign it off,
                and who asked. Sent back and asked again, this is the latest
                ask - a refusal is cleared by the next one, so one still on
                record means it was finished some other way. */}
            {sentForApproval && ticket.resolvedAt && (
              <Fact label="Approval sent">
                {formatDateOf(ticket.resolvedAt)}
                <span className="font-normal text-ink-400">{formatTime(ticket.resolvedAt)}</span>
                {ticket.resolvedByName && (
                  <span className="w-full font-normal text-ink-500">by {ticket.resolvedByName}</span>
                )}
              </Fact>
            )}
            {ticket.status === "Completed" && ticket.completedAt && (
              <Fact label="Completed">
                {formatDateOf(ticket.completedAt)}
                <span className="font-normal text-ink-400">{formatTime(ticket.completedAt)}</span>
                {ticket.approvedByName && (
                  <span className="w-full font-normal text-ink-500">
                    {/* Without an approval step the requester closed it themselves. */}
                    {!sentForApproval
                      ? `by ${ticket.approvedByName}`
                      : ticket.approvedByName === "Auto-approved"
                        ? "approved automatically"
                        : `approved by ${ticket.approvedByName}`}
                  </span>
                )}
              </Fact>
            )}
          </Group>

          {/* Everything that happened, in order, with the time of each. */}
          <button
            type="button"
            onClick={() => setTimelineOpen(true)}
            className="mt-1.5 flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[12px] font-semibold text-ink-700 transition-colors hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700"
          >
            <GitCommitVertical className="size-3.5" />
            View timeline
          </button>
          <TicketTimeline ticket={ticket} open={timelineOpen} onClose={closeTimeline} />

          {/* What came with the request. Each link goes to the API, which
              redirects to a URL signed at that moment - so nothing here can go
              stale in a list that was loaded an hour ago. */}
          {ticket.attachments.length > 0 && (
            <section className="mt-2.5">
              <p className="text-[10px] font-semibold tracking-wide text-ink-400 uppercase">
                Attachments
              </p>
              <ul className="mt-1 divide-y divide-line rounded-md border border-line">
                {ticket.attachments.map((file) => (
                  <li key={file.index}>
                    <a
                      href={attachmentHref(ticket.id, file.index)}
                      target="_blank"
                      rel="noreferrer"
                      className="group flex items-center gap-2 px-2 py-1.5 transition-colors hover:bg-ink-50"
                    >
                      <Paperclip className="size-3.5 shrink-0 text-ink-400" />
                      <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-ink-800">
                        {file.filename}
                      </span>
                      <span className="shrink-0 text-[10px] text-ink-400">
                        {formatBytes(file.size)}
                      </span>
                      <Download className="size-3.5 shrink-0 text-ink-300 transition-colors group-hover:text-brand-600" />
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Only when there is something in it: two empty rows are worse than
              no section at all. */}
          {(ticket.requestType || ticket.project) && (
            <Group title="More">
              {ticket.requestType && <Fact label="Request type">{ticket.requestType}</Fact>}
              {ticket.project && <Fact label="Project">{ticket.project}</Fact>}
            </Group>
          )}
        </div>

        {(canWork || direct) && !editing && (
          <div className="mt-2 rounded-lg bg-status-waiting-bg/45 px-2.5 py-2">
            {/* One column, in the order it is done: how it is going, letting
                go of it, passing it on, the date, and why. */}
            <div className="space-y-2.5">
              {/* A raiser is not working the ticket, so the half of this pane
                  that says how the work is going is not theirs to fill in. */}
              {canWork && (
                <div className="min-w-0">
                  <MiniLabel>Status</MiniLabel>
                  <StatusPicker
                    value={status}
                    // Cancelling saves at once, with its remark; every other
                    // status waits for Save changes like the rest of the pane.
                    onChange={(next) =>
                      next === "Cancelled" && ticket.status !== "Cancelled"
                        ? setCancelling(true)
                        : next === "Completed" && sendsForApproval
                          ? // Somebody else's request: say so before it goes.
                            setApproving(true)
                          : setStatus(next)
                    }
                    label={`Status for #${ticket.number}`}
                    needsApproval={ticket.raisedBy.id !== meId}
                    className="h-8 w-full justify-between px-2.5 text-[13px]"
                  />
                </div>
              )}

              {/* Giving it back rather than passing it sideways. */}
              {!direct && holdsIt && (
                <div className="min-w-0">
                  <MiniLabel>Release</MiniLabel>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 w-full px-2.5 text-[12px]"
                    disabled={pending}
                    onClick={() => void release()}
                  >
                    Release back to the head
                  </Button>
                </div>
              )}

              {(direct || transfers) && (
                <div className="min-w-0">
                  {direct ? (
                    <>
                      <MiniLabel htmlFor="sheet-assignee">Assignee</MiniLabel>
                      <MultiSelect
                        id="sheet-assignee"
                        // Everyone but you. A ticket is handed to somebody; if
                        // you are already on it you stay, so the list can still
                        // be saved - it just cannot gain you.
                        options={members
                          .filter((member) => member.id !== meId || assignees.includes(member.id))
                          .map((member) => pickerOption(member, member.forDepartment))}
                        // On a shared ticket a head edits their own department's
                        // part; the other departments' people are kept as they are.
                        value={
                          isAdmin(session)
                            ? assignees
                            : assignees.filter((id) => members.some((member) => member.id === id))
                        }
                        onChange={setAssignees}
                        display="summary"
                        placeholder="Nobody yet"
                        emptyMessage="Nobody is in this department"
                      />
                    </>
                  ) : (
                    <>
                      <MiniLabel htmlFor="sheet-ask">Transfer to</MiniLabel>
                      <MultiSelect
                        id="sheet-ask"
                        // Only people who are not already on it: the rest have
                        // nothing to accept. The head is left out too - handing
                        // it back to them is what Release is for.
                        options={members
                          .filter(
                            (member) =>
                              member.id !== meId &&
                              member.departmentRole !== "head" &&
                              !ticket.assignees.some((person) => person.id === member.id),
                          )
                          .map((member) => pickerOption(member, member.forDepartment))}
                        value={asking}
                        onChange={setAsking}
                        display="summary"
                        placeholder={sentByMe ? "Waiting on an answer" : "Choose who to ask"}
                        emptyMessage="Nobody else is in this department"
                        disabled={Boolean(sentByMe) || !holdsIt}
                      />
                    </>
                  )}
                </div>
              )}

              {!direct && (
                <div className="min-w-0 space-y-2">
                  {/* Only ever reached by somebody in the department: a raiser
                      names people outright and never has to ask. */}
                  {/* Somebody is waiting on this person. It is the only thing
                      in the pane that is a question, so it says so loudly. */}
                  {waitingOnMe && (
                    <div className="rounded-lg border border-brand-200 bg-brand-50 px-2.5 py-2">
                      <p className="text-[12px] text-ink-700">
                        <span className="font-bold text-brand-700">
                          {waitingOnMe.requestedBy.name}
                        </span>{" "}
                        asks you to take this ticket on.
                        {waitingOnMe.note && (
                          <span className="mt-0.5 block text-ink-500">
                            &ldquo;{waitingOnMe.note}&rdquo;
                          </span>
                        )}
                      </p>
                      <div className="mt-2 flex gap-2">
                        <Button
                          type="button"
                          size="sm"
                          className="h-7 px-2.5 text-[12px]"
                          disabled={pending}
                          onClick={() => void answer(waitingOnMe, "accept")}
                        >
                          Accept
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 px-2.5 text-[12px]"
                          disabled={pending}
                          onClick={() => void answer(waitingOnMe, "decline")}
                        >
                          Decline
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Their own ask, still out. */}
                  {sentByMe && (
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-ink-50 px-2.5 py-2 text-[12px] text-ink-600">
                      <span>
                        Waiting on{" "}
                        <span className="font-semibold text-ink-800">
                          {sentByMe.to.map((person) => person.name).join(", ")}
                        </span>
                        {sentByMe.declinedBy.length > 0 && (
                          <span className="text-ink-400">
                            {" "}
                            · {sentByMe.declinedBy.length} declined
                          </span>
                        )}
                      </span>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => void answer(sentByMe, "cancel")}
                        className="ml-auto font-semibold text-brand-600 hover:text-brand-700"
                      >
                        Withdraw
                      </button>
                    </div>
                  )}

                  {transfers && !sentByMe && holdsIt && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 w-full px-2.5 text-[12px]"
                      disabled={pending || asking.length === 0}
                      onClick={() => void sendAsk()}
                    >
                      {asking.length > 1 ? `Ask ${asking.length} people` : "Send request"}
                    </Button>
                  )}

                  {transfers && !holdsIt && !waitingOnMe && (
                    <p className="text-[11px] text-ink-400">
                      Only somebody holding this ticket can transfer it.
                    </p>
                  )}
                </div>
              )}

              {/* The requested date used to be repeated here as a locked box.
                  It is already two rows up under Dates; what this pane needs is
                  the date you are promising, and what it is being judged
                  against. */}
              <div className="min-w-0">
                <MiniLabel htmlFor="sheet-committed">Pick a date</MiniLabel>

                {/* A promise already given is shown as one, with the reason it
                    was given for. Moving it is a deliberate second click, and
                    it costs a new reason. */}
                {!movingDate && ticket.committedDeadline ? (
                  <div className="rounded-md border border-line-strong bg-ink-50/60 px-2.5 py-2">
                    <p className="flex flex-wrap items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-[13px] font-bold text-ink-900">
                        <CalendarCheck className="size-3.5 shrink-0 text-ink-400" />
                        {formatDate(ticket.committedDeadline.slice(0, 10))}
                      </span>
                      <button
                        type="button"
                        onClick={() => setMovingDate(true)}
                        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold text-brand-600 transition-colors hover:bg-brand-50"
                      >
                        <CalendarClock className="size-3.5" />
                        {noLaterThan ? "Bring forward" : "Extend or change"}
                      </button>
                    </p>
                    {ticket.committedReason && (
                      <p className="mt-1 text-[11px] leading-snug text-ink-500">
                        “{ticket.committedReason}”
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <DateField
                      id="sheet-committed"
                      min={todayISO()}
                      max={noLaterThan}
                      // Clearing would hand it back to a later requested date.
                      clearable={!(noLaterThan && requestedDay > noLaterThan)}
                      value={committed}
                      onChange={setCommitted}
                      placeholder="Pick a date"
                      className="gap-1.5 px-2.5 [&>span]:text-[13px]"
                    />
                    {noLaterThan && (
                      <p className="text-[11px] leading-snug text-ink-500">
                        {noLaterThan < todayISO()
                          ? "In progress and already past its date - it cannot be pushed back."
                          : `In progress - the date can only move earlier, ${formatDate(noLaterThan)} at the latest.`}
                      </p>
                    )}

                    {/* Only once the date has actually moved: asking why before
                        anything has changed is a box in the way. */}
                    {committed !== (ticket.committedDeadline?.slice(0, 10) ?? "") && (
                      <div>
                        <MiniLabel htmlFor="sheet-committed-why">Remark</MiniLabel>
                        <Textarea
                          id="sheet-committed-why"
                          value={why}
                          invalid={whyMissing}
                          maxLength={400}
                          placeholder={
                            ticket.committedDeadline
                              ? "Why is the date moving? e.g. the supplier pushed delivery to Friday"
                              : "Why this date? e.g. the design is queued behind two releases"
                          }
                          onChange={(event) => {
                            setWhy(event.target.value);
                            if (event.target.value.trim()) setWhyMissing(false);
                          }}
                          className="min-h-14 text-[13px]"
                        />
                        <p
                          className={cn(
                            "mt-0.5 text-[11px]",
                            whyMissing ? "font-semibold text-brand-600" : "text-ink-400",
                          )}
                        >
                          Required when the date changes.
                        </p>
                      </div>
                    )}

                    {ticket.committedDeadline && (
                      <button
                        type="button"
                        onClick={() => {
                          setCommitted(ticket.committedDeadline!.slice(0, 10));
                          setWhy("");
                          setWhyMissing(false);
                          setMovingDate(false);
                        }}
                        className="text-[11px] font-semibold text-ink-500 transition-colors hover:text-ink-800"
                      >
                        Keep {formatDate(ticket.committedDeadline.slice(0, 10))}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {canEdit && tab === "details" && (
        <div className="border-t border-line px-3 py-2">
          {editing ? (
            <>
              <div className="flex items-center gap-2">
                <Button size="sm" className="flex-1" onClick={saveEdit} disabled={pending}>
                  {pending ? "Saving..." : "Save changes"}
                </Button>
                <Button size="sm" variant="outline" onClick={cancelEdit} disabled={pending}>
                  Cancel
                </Button>
              </div>
              <p className="mt-1 text-center text-[10px] text-ink-400">
                {departmentName} is notified of what you change.
              </p>
            </>
          ) : (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="flex-1"
                onClick={() => setEditing(true)}
              >
                <PencilLine className="size-3.5" />
                Edit request
              </Button>

              {/* Calling off what you asked for is not working the ticket, so
                  it is the raiser's to do - until the department has finished
                  it, when there is nothing left to withdraw. */}
              {!canWork && !isClosed(ticket.status) && (
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0 text-brand-600"
                  onClick={() => setCancelling(true)}
                  disabled={pending}
                >
                  <CircleSlash className="size-3.5" />
                  Cancel request
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {canWork && tab === "details" && !editing && (
        <div className="flex items-center gap-2 border-t border-line px-3 py-2">
          <Button size="sm" className="flex-1" onClick={() => save()} disabled={pending}>
            {pending ? "Saving..." : "Save changes"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="flex-1 text-status-completed-fg"
            onClick={() => {
              if (sendsForApproval) {
                setApproving(true);
                return;
              }
              setStatus("Completed");
              save("Completed");
            }}
            disabled={pending || ticket.status === "Completed" || ticket.status === "Resolved"}
          >
            <CheckCircle2 className="size-3.5" />
            {ticket.status === "Completed"
              ? "Completed"
              : ticket.status === "Resolved"
                ? "Awaiting approval"
                : ticket.raisedBy.id !== meId
                  ? "Mark resolved"
                  : "Mark completed"}
          </Button>
        </div>
      )}
    </>
  );
}
