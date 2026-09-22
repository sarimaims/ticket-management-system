"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CalendarCheck,
  CheckCircle2,
  History,
  MessagesSquare,
  PencilLine,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { OriginTag, PriorityBadge, StatusBadge } from "@/components/ui/badge";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { MultiSelect } from "@/components/ui/multi-select";
import { DateField } from "@/components/tickets/date-field";
import { TicketChat } from "@/components/tickets/ticket-chat";
import { TicketHistory } from "@/components/tickets/ticket-history";
import { StatusPicker } from "@/components/tickets/status-picker";
import { useNotifications } from "@/components/notifications/notification-provider";
import { useToast } from "@/components/ui/toast";
import { getDepartment, type Member } from "@/lib/departments";
import { updateTicket, type TicketRecord } from "@/lib/tickets";
import { errorMessage } from "@/lib/api";
import { cn, formatDate, formatDateOf, formatTime } from "@/lib/utils";
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
        className={cn("font-semibold", late ? "text-status-waiting-fg" : "text-status-completed-fg")}
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
          className="h-7"
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
}: {
  tab: SheetTab;
  onTab: (tab: SheetTab) => void;
  count: number;
  unread: number;
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
    <div role="tablist" className="flex border-b border-line px-1.5">
      <button
        type="button"
        role="tab"
        aria-selected={tab === "details"}
        onClick={() => onTab("details")}
        className={style("details")}
      >
        Details
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
  title: string;
  tone?: GroupTone;
  children: React.ReactNode;
}) {
  const style = GROUP_TONE[tone];

  return (
    <section className={cn("mt-2 rounded-lg px-2.5 py-2", style.card)}>
      <p className={cn("text-[10px] font-bold tracking-wider uppercase", style.label)}>{title}</p>
      <dl className="mt-1">{children}</dl>
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

function Chips({ items }: { items: { id: string; name?: string }[] }) {
  if (items.length === 0) return <Blank />;
  return (
    <>
      {items.map((item) => (
        <span
          key={item.id}
          className="rounded bg-ink-100 px-1.5 py-0.5 text-[11px] font-medium text-ink-600"
        >
          {item.name}
        </span>
      ))}
    </>
  );
}

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
}: {
  ticket: TicketRecord | null;
  canWork: boolean;
  canEdit?: boolean;
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

  return (
    <>
      {ticket && (
        <div
          className="fixed inset-0 z-40 bg-ink-900/30 xl:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
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
          />
        )}
      </aside>
    </>
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
}: {
  ticket: TicketRecord;
  canWork: boolean;
  canEdit: boolean;
  tab: SheetTab;
  onTab: (tab: SheetTab) => void;
  onClose: () => void;
  onSaved: (ticket: TicketRecord) => void;
}) {
  const [status, setStatus] = useState<TicketStatus>(ticket.status);
  // The requested date is not ours to touch; the commitment is.
  const [committed, setCommitted] = useState(
    ticket.committedDeadline ? ticket.committedDeadline.slice(0, 10) : "",
  );
  const [assignees, setAssignees] = useState(ticket.assignees.map((person) => person.id));
  const [members, setMembers] = useState<Member[]>([]);
  const [pending, setPending] = useState(false);
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

  // The feed is the only per-person record of what has been read, so it is
  // also what says whether this ticket has anything waiting.
  const { items } = useNotifications();
  const unread = useMemo(
    () =>
      items.filter(
        (item) => item.type === "ticket.message" && !item.read && item.ticket === ticket.id,
      ).length,
    [items, ticket.id],
  );

  // A department name is only missing when the record was never populated.
  const departmentName = ticket.department.name ?? "That department";

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
        toast.show({ title: `#${ticket.number} has no changes to save`, tone: "info" });
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
    if (!canWork) return;
    const controller = new AbortController();
    getDepartment(ticket.department.id, controller.signal)
      .then((data) => setMembers(data.members))
      .catch(() => setMembers([]));
    return () => controller.abort();
  }, [ticket.department.id, canWork]);

  /** Saving closes the sheet; the toast carries what changed. */
  const save = async (nextStatus: TicketStatus = status) => {
    setPending(true);
    try {
      const saved = await updateTicket(ticket.id, {
        status: nextStatus,
        committedDeadline: committed || null,
        assignees,
      });
      onSaved(saved);

      const moved = changes(ticket, saved);
      if (moved.length === 0) {
        toast.show({ title: `#${ticket.number} has no changes to save`, tone: "info" });
      } else {
        toast.success(
          nextStatus === "Completed" && ticket.status !== "Completed"
            ? `#${ticket.number} marked as resolved`
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
      {/* The subject on the left, and beside it the two things a reader needs
          before the subject means anything: what state it is in, and whose
          desk it is on. The number and how urgent it is sit under them, where
          they are available without competing for the first glance. */}
      <div className="border-b border-line px-3 py-2">
        <div className="flex items-start gap-2">
          <h2 className="min-w-0 flex-1 text-[14px] leading-snug font-bold break-words text-ink-900">
            {ticket.subject}
          </h2>

          {/* Its name, and whose desk it is on. Both sit beside the subject
              rather than on a row of their own, which the subject then has to
              be read past. */}
          <span className="flex shrink-0 flex-col items-end gap-0.5">
            <span className="text-[11px] font-semibold text-brand-600">#{ticket.number}</span>
            <span className="text-right text-[10px] leading-tight text-ink-400">
              {ticket.department.unit?.name && (
                <span className="block truncate">{ticket.department.unit.name}</span>
              )}
              <span className="block truncate font-semibold text-ink-600">
                {ticket.department.name}
              </span>
            </span>
          </span>

          <button
            type="button"
            onClick={onClose}
            className="grid size-6 shrink-0 place-items-center rounded text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700"
            aria-label="Close details"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      <Tabs tab={tab} onTab={onTab} count={chatCount ?? ticket.messageCount} unread={unread} />

      {/* Mounted only while it is being read, so a closed thread costs no
          polling. The details below are hidden rather than unmounted, so an
          edit in progress survives a look at the conversation. */}
      {tab === "chat" && <TicketChat ticket={ticket} onCount={setChatCount} />}
      {tab === "history" && <TicketHistory ticket={ticket} />}

      <div className={cn("flex-1 overflow-y-auto px-3 py-2.5", tab !== "details" && "hidden")}>
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
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-bold tracking-wider text-ink-400 uppercase">
                Description
              </p>
              <span className="flex shrink-0 items-center gap-1">
                <StatusBadge status={ticket.status} className="px-1.5 py-0.5 text-[10px]" />
                <PriorityBadge priority={ticket.priority} className="px-1.5 py-0.5 text-[10px]" />
              </span>
            </div>
            <p className="mt-1 text-[12px] leading-relaxed whitespace-pre-wrap text-ink-700">
              {ticket.description}
            </p>
          </section>
        </div>

        {/* Grouped rather than gridded: "where it goes", "who", "when" are the
            three questions actually being asked of this pane, and a label beside
            its value reads faster than a label above it. */}
        <div className={cn(editing && "hidden")}>
          <Group title="Where it goes" tone="route">
            <Fact label="From">
              {ticket.fromDepartments.length > 0 ? (
                <Chips items={ticket.fromDepartments} />
              ) : (
                <Blank>Raised directly</Blank>
              )}
            </Fact>
            <Fact label="To">
              <span className="rounded bg-brand-50 px-1.5 py-0.5 text-[11px] font-semibold text-brand-700">
                {ticket.department.name}
              </span>
            </Fact>
          </Group>

          <Group title="Who" tone="who">
            <Fact label="Raised by">
              {ticket.raisedBy.name}
              <OriginTag role={ticket.raisedByRole} />
            </Fact>
            {/* A ticket can be held by more than one person now, so the row
                names all of them rather than the first. */}
            <Fact label={ticket.assignees.length > 1 ? "Assignees" : "Assignee"}>
              {ticket.assignees.length > 0 ? (
                holders(ticket.assignees)
              ) : (
                <Blank>Nobody yet</Blank>
              )}
            </Fact>
          </Group>

          <Group title="Dates" tone="dates">
            <Fact label="Raised on">
              {formatDateOf(ticket.createdAt)}
              <span className="font-normal text-ink-400">{formatTime(ticket.createdAt)}</span>
            </Fact>
            <Fact label="They asked for">
              {ticket.deadline ? formatDate(ticket.deadline.slice(0, 10)) : <Blank>Not set</Blank>}
            </Fact>
            <Fact label="Promised for">
              {ticket.committedDeadline ? (
                <>
                  <DeadlineVerdict
                    requested={ticket.deadline}
                    committed={ticket.committedDeadline}
                  />
                  {ticket.committedBy?.name && (
                    <span className="w-full text-[10px] font-normal text-ink-400">
                      by {ticket.committedBy.name}
                      {ticket.committedAt ? ` · ${formatDateOf(ticket.committedAt)}` : ""}
                    </span>
                  )}
                </>
              ) : (
                <Blank>Nothing promised yet</Blank>
              )}
            </Fact>
            <Fact label="Last updated">
              {formatDateOf(ticket.updatedAt)}
              <span className="font-normal text-ink-400">{formatTime(ticket.updatedAt)}</span>
            </Fact>
          </Group>

          {/* Only when there is something in it: two empty rows are worse than
              no section at all. */}
          {(ticket.requestType || ticket.project) && (
            <Group title="More">
              {ticket.requestType && <Fact label="Request type">{ticket.requestType}</Fact>}
              {ticket.project && <Fact label="Project">{ticket.project}</Fact>}
            </Group>
          )}
        </div>

        {canWork && !editing && (
          <div className="mt-2 rounded-lg bg-status-waiting-bg/45 px-2.5 py-2">
            <p className="text-[10px] font-bold tracking-wider text-status-waiting-fg uppercase">
              Work this ticket
            </p>

            <div className="mt-1.5 grid grid-cols-2 gap-x-2 gap-y-2">
              <div className="min-w-0">
                <MiniLabel>Status</MiniLabel>
                <StatusPicker
                  value={status}
                  onChange={setStatus}
                  label={`Status for #${ticket.number}`}
                  className="h-7 justify-between px-2 text-[12px]"
                />
              </div>

              <div className="min-w-0">
                <MiniLabel htmlFor="sheet-assignee">Assignee</MiniLabel>
                <MultiSelect
                  id="sheet-assignee"
                  options={members.map((member) => ({
                    value: member.id,
                    label: `${member.name} (${member.departmentRole})`,
                  }))}
                  value={assignees}
                  onChange={setAssignees}
                  display="summary"
                  placeholder="Nobody yet"
                  emptyMessage="Nobody is in this department"
                />
              </div>

              {/* The requested date used to be repeated here as a locked box.
                  It is already two rows up under Dates; what this pane needs is
                  the date you are promising, and what it is being judged
                  against. */}
              <div className="col-span-2 min-w-0">
                <MiniLabel htmlFor="sheet-committed">
                  I can resolve by
                  {ticket.deadline && (
                    <span className="font-medium normal-case">
                      · they asked for {formatDate(ticket.deadline.slice(0, 10))}
                    </span>
                  )}
                </MiniLabel>
                <DateField
                  id="sheet-committed"
                  value={committed}
                  onChange={setCommitted}
                  placeholder="Pick a date"
                  className="h-7 gap-1.5 px-2 [&>span]:text-[12px]"
                />
              </div>
            </div>

            {committed ? (
              <p className="mt-1.5 flex items-start gap-1.5 rounded-md bg-ink-50 px-2 py-1.5 text-[11px] leading-snug text-ink-500">
                <CalendarCheck className="mt-px size-3.5 shrink-0 text-ink-400" />
                <span>
                  {ticket.raisedBy.name} sees this as your commitment.{" "}
                  <DeadlineVerdict requested={ticket.deadline} committed={committed} inline />
                </span>
              </p>
            ) : (
              <p className="mt-1.5 text-[11px] leading-snug text-ink-400">
                Anyone in {departmentName} can take this on; every handover is listed under
                History.
              </p>
            )}
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
            <Button size="sm" variant="outline" className="w-full" onClick={() => setEditing(true)}>
              <PencilLine className="size-3.5" />
              Edit request
            </Button>
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
              setStatus("Completed");
              save("Completed");
            }}
            disabled={pending || ticket.status === "Completed"}
          >
            <CheckCircle2 className="size-3.5" />
            {ticket.status === "Completed" ? "Resolved" : "Mark resolved"}
          </Button>
        </div>
      )}
    </>
  );
}
