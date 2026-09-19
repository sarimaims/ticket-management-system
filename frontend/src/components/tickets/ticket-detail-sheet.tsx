"use client";

import { useEffect, useState } from "react";
import { CalendarCheck, CheckCircle2, Lock, PencilLine, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { OriginTag, PriorityBadge, StatusBadge, statusToneClasses } from "@/components/ui/badge";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { DateField } from "@/components/tickets/date-field";
import { useToast } from "@/components/ui/toast";
import { getDepartment, type Member } from "@/lib/departments";
import { updateTicket, type TicketRecord } from "@/lib/tickets";
import { errorMessage } from "@/lib/api";
import { cn, formatDate, formatDateOf, formatTime } from "@/lib/utils";
import type { TicketPriority, TicketStatus } from "@/lib/types";

const STATUSES: TicketStatus[] = [
  "New",
  "Accepted",
  "In Progress",
  "Waiting",
  "Completed",
  "Overdue",
];

const PRIORITIES: TicketPriority[] = ["Low", "Medium", "High", "Critical"];

/** What an empty box is called when the raiser is told to fill it. */
const LABEL = {
  subject: "Subject",
  description: "Description",
  requestType: "Request type",
  deadline: "Deadline",
} as const;

const dayOf = (value: string | null) => value?.slice(0, 10) ?? "";

/** What actually moved, so the toast names it instead of saying "saved". */
function changes(before: TicketRecord, after: TicketRecord) {
  const parts: string[] = [];
  if (before.status !== after.status) parts.push(`Status: ${after.status}`);
  if ((before.assignee?.id ?? "") !== (after.assignee?.id ?? "")) {
    parts.push(`Assignee: ${after.assignee?.name ?? "Nobody yet"}`);
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
        "rounded-md px-2 py-0.5 text-[11px] font-semibold",
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
    <div className="space-y-4">
      <p className="flex items-start gap-2 rounded-field bg-ink-50 px-3 py-2 text-xs text-ink-500">
        <PencilLine className="mt-px size-4 shrink-0 text-ink-400" />
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
          className="min-h-32"
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
          className="h-11"
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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <dt className="shrink-0 text-sm text-ink-500">{label}</dt>
      <dd className="min-w-0 text-right text-sm font-semibold text-ink-900">{children}</dd>
    </div>
  );
}

function Chips({ items }: { items: { id: string; name?: string }[] }) {
  if (items.length === 0) return <span className="font-normal text-ink-400">—</span>;
  return (
    <span className="flex flex-wrap justify-end gap-1">
      {items.map((item) => (
        <span
          key={item.id}
          className="rounded-md bg-ink-100 px-2 py-0.5 text-[11px] font-medium text-ink-600"
        >
          {item.name}
        </span>
      ))}
    </span>
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
  onClose,
  onSaved,
}: {
  ticket: TicketRecord | null;
  canWork: boolean;
  canEdit?: boolean;
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
          className="fixed inset-x-0 top-16 bottom-0 z-40 bg-ink-900/30 xl:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        aria-hidden={!ticket}
        aria-label="Ticket details"
        className={cn(
          "fixed top-16 right-0 bottom-0 z-50 flex w-full max-w-md flex-col border-l border-line bg-surface transition-transform duration-200",
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
  onClose,
  onSaved,
}: {
  ticket: TicketRecord;
  canWork: boolean;
  canEdit: boolean;
  onClose: () => void;
  onSaved: (ticket: TicketRecord) => void;
}) {
  const [status, setStatus] = useState<TicketStatus>(ticket.status);
  // The requested date is not ours to touch; the commitment is.
  const [committed, setCommitted] = useState(
    ticket.committedDeadline ? ticket.committedDeadline.slice(0, 10) : "",
  );
  const [assignee, setAssignee] = useState(ticket.assignee?.id ?? "");
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
        assignee: assignee || null,
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
      <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold text-brand-600">#{ticket.number}</span>
            <StatusBadge status={ticket.status} />
            <OriginTag role={ticket.raisedByRole} />
          </p>
          <h2 className="mt-1 text-base font-bold break-words text-ink-900">{ticket.subject}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="grid size-8 shrink-0 place-items-center rounded-lg text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700"
          aria-label="Close details"
        >
          <X className="size-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {editing && (
          <RequestEditor
            draft={draft}
            set={set}
            invalid={invalid}
            departmentName={departmentName}
          />
        )}

        <div className={cn(editing && "hidden")}>
          <p className="text-xs font-semibold tracking-wide text-ink-400 uppercase">Description</p>
          <p className="mt-1.5 rounded-field bg-ink-50 px-3.5 py-3 text-sm whitespace-pre-wrap text-ink-700">
            {ticket.description}
          </p>
        </div>

        <dl className={cn("mt-4 divide-y divide-line", editing && "hidden")}>
          <Row label="From department">
            <Chips items={ticket.fromDepartments} />
          </Row>
          <Row label="To department">
            <span className="rounded-md bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700">
              {ticket.department.name}
            </span>
          </Row>
          <Row label="Raised by">
            <span className="flex flex-wrap items-center justify-end gap-1.5">
              {ticket.raisedBy.name}
              <OriginTag role={ticket.raisedByRole} />
            </span>
          </Row>
          {ticket.requestType && <Row label="Request type">{ticket.requestType}</Row>}
          <Row label="Priority">
            <PriorityBadge priority={ticket.priority} />
          </Row>
          <Row label="Assignee">
            {ticket.assignee?.name ?? <span className="font-normal text-ink-400">Nobody yet</span>}
          </Row>
          <Row label="Project">
            {ticket.project || <span className="font-normal text-ink-400">—</span>}
          </Row>
          <Row label="Created on">
            {formatDateOf(ticket.createdAt)}
            <span className="ml-1.5 font-normal text-ink-400">{formatTime(ticket.createdAt)}</span>
          </Row>
          <Row label="Deadline requested">
            {ticket.deadline ? (
              formatDate(ticket.deadline.slice(0, 10))
            ) : (
              <span className="font-normal text-ink-400">Not set</span>
            )}
          </Row>
          <Row label="Committed to finish by">
            {ticket.committedDeadline ? (
              <span className="flex flex-wrap items-center justify-end gap-1.5">
                <DeadlineVerdict requested={ticket.deadline} committed={ticket.committedDeadline} />
                {ticket.committedBy?.name && (
                  <span className="block w-full text-[11px] font-normal text-ink-400">
                    by {ticket.committedBy.name}
                    {ticket.committedAt ? ` · ${formatDateOf(ticket.committedAt)}` : ""}
                  </span>
                )}
              </span>
            ) : (
              <span className="font-normal text-ink-400">Nothing promised yet</span>
            )}
          </Row>
          <Row label="Last updated">
            {formatDateOf(ticket.updatedAt)}
            <span className="ml-1.5 font-normal text-ink-400">{formatTime(ticket.updatedAt)}</span>
          </Row>
        </dl>

        {canWork && (
          <div className="mt-5 space-y-4 border-t border-line pt-5">
            <p className="text-xs font-semibold tracking-wide text-ink-400 uppercase">
              Work this ticket
            </p>

            <Field label="Status" htmlFor="sheet-status">
              <Select
                id="sheet-status"
                className={cn("h-11 border-transparent font-semibold", statusToneClasses(status))}
                value={status}
                onChange={(event) => setStatus(event.target.value as TicketStatus)}
              >
                {STATUSES.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </Select>
            </Field>

            <Field label="Assignee" htmlFor="sheet-assignee">
              <Select
                id="sheet-assignee"
                className="h-11"
                value={assignee}
                onChange={(event) => setAssignee(event.target.value)}
              >
                <option value="">Nobody yet</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name} ({member.departmentRole})
                  </option>
                ))}
              </Select>
            </Field>

            {/* The ask is shown, locked: a department answers it, it does not
                edit it. */}
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-ink-800">
                Deadline requested
                <Lock className="size-3.5 text-ink-400" />
              </p>
              <div className="flex h-12 items-center rounded-field border border-line bg-ink-50 px-4 text-sm font-medium text-ink-500">
                {ticket.deadline ? formatDate(ticket.deadline.slice(0, 10)) : "None given"}
              </div>
              <p className="mt-1.5 text-xs text-ink-400">
                Set by {ticket.raisedBy.name}. Commit to your own date below instead.
              </p>
            </div>

            <Field label="I can resolve this by" htmlFor="sheet-committed">
              <DateField id="sheet-committed" value={committed} onChange={setCommitted} />
            </Field>

            {committed && (
              <p className="flex items-start gap-2 rounded-field bg-ink-50 px-3 py-2 text-xs text-ink-500">
                <CalendarCheck className="mt-px size-4 shrink-0 text-ink-400" />
                <span>
                  {ticket.raisedBy.name} sees this as your commitment.{" "}
                  <DeadlineVerdict requested={ticket.deadline} committed={committed} inline />
                </span>
              </p>
            )}
          </div>
        )}
      </div>

      {canEdit && (
        <div className="space-y-2 border-t border-line px-5 py-4">
          {editing ? (
            <>
              <Button className="w-full" onClick={saveEdit} disabled={pending}>
                {pending ? "Saving..." : "Save changes"}
              </Button>
              <Button variant="outline" className="w-full" onClick={cancelEdit} disabled={pending}>
                Cancel
              </Button>
              <p className="pt-0.5 text-center text-xs text-ink-400">
                {departmentName} is notified of what you change.
              </p>
            </>
          ) : (
            <Button variant="outline" className="w-full" onClick={() => setEditing(true)}>
              <PencilLine className="size-4.5" />
              Edit request
            </Button>
          )}
        </div>
      )}

      {canWork && (
        <div className="space-y-2 border-t border-line px-5 py-4">
          <Button className="w-full" onClick={() => save()} disabled={pending}>
            {pending ? "Saving..." : "Save Changes"}
          </Button>
          <Button
            variant="outline"
            className="w-full text-status-completed-fg"
            onClick={() => {
              setStatus("Completed");
              save("Completed");
            }}
            disabled={pending || ticket.status === "Completed"}
          >
            <CheckCircle2 className="size-4.5" />
            {ticket.status === "Completed" ? "Already resolved" : "Mark as resolved"}
          </Button>
        </div>
      )}
    </>
  );
}
