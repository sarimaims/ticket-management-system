"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { OriginTag, PriorityBadge, StatusBadge, statusToneClasses } from "@/components/ui/badge";
import { Field, Select } from "@/components/ui/field";
import { DateField } from "@/components/tickets/date-field";
import { useToast } from "@/components/ui/toast";
import { getDepartment, type Member } from "@/lib/departments";
import { updateTicket, type TicketRecord } from "@/lib/tickets";
import { errorMessage } from "@/lib/api";
import { cn, formatDate, formatDateOf, formatTime } from "@/lib/utils";
import type { TicketStatus } from "@/lib/types";

const STATUSES: TicketStatus[] = [
  "New",
  "Accepted",
  "In Progress",
  "Waiting",
  "Completed",
  "Overdue",
];

const dayOf = (value: string | null) => value?.slice(0, 10) ?? "";

/** What actually moved, so the toast names it instead of saying "saved". */
function changes(before: TicketRecord, after: TicketRecord) {
  const parts: string[] = [];
  if (before.status !== after.status) parts.push(`Status: ${after.status}`);
  if ((before.assignee?.id ?? "") !== (after.assignee?.id ?? "")) {
    parts.push(`Assignee: ${after.assignee?.name ?? "Nobody yet"}`);
  }
  if (dayOf(before.deadline) !== dayOf(after.deadline)) {
    parts.push(`Deadline: ${after.deadline ? formatDate(dayOf(after.deadline)) : "Not set"}`);
  }
  return parts;
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
 * Everything known about one ticket, in a sheet beside the list. `canWork`
 * decides whether the bottom half is editable - the receiving department may
 * work a ticket, the person who raised it may not.
 */
export function TicketDetailSheet({
  ticket,
  canWork,
  onClose,
  onSaved,
}: {
  ticket: TicketRecord | null;
  canWork: boolean;
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
          <SheetBody key={ticket.id} ticket={ticket} canWork={canWork} onClose={onClose} onSaved={onSaved} />
        )}
      </aside>
    </>
  );
}

function SheetBody({
  ticket,
  canWork,
  onClose,
  onSaved,
}: {
  ticket: TicketRecord;
  canWork: boolean;
  onClose: () => void;
  onSaved: (ticket: TicketRecord) => void;
}) {
  const [status, setStatus] = useState<TicketStatus>(ticket.status);
  const [deadline, setDeadline] = useState(ticket.deadline ? ticket.deadline.slice(0, 10) : "");
  const [assignee, setAssignee] = useState(ticket.assignee?.id ?? "");
  const [members, setMembers] = useState<Member[]>([]);
  const [pending, setPending] = useState(false);
  const toast = useToast();

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
        deadline: deadline || null,
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
        <div>
          <p className="text-xs font-semibold tracking-wide text-ink-400 uppercase">Description</p>
          <p className="mt-1.5 rounded-field bg-ink-50 px-3.5 py-3 text-sm whitespace-pre-wrap text-ink-700">
            {ticket.description}
          </p>
        </div>

        <dl className="mt-4 divide-y divide-line">
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
          <Row label="Request type">{ticket.requestType}</Row>
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
          <Row label="Deadline">
            {ticket.deadline ? (
              formatDate(ticket.deadline.slice(0, 10))
            ) : (
              <span className="font-normal text-ink-400">Not set</span>
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

            <Field label="Deadline" htmlFor="sheet-deadline">
              <DateField id="sheet-deadline" value={deadline} onChange={setDeadline} />
            </Field>
          </div>
        )}
      </div>

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
