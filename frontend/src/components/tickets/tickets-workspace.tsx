"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertCircle, Inbox, Plus, Search, SlidersHorizontal } from "lucide-react";

import { Card } from "@/components/ui/card";
import { OriginTag, PriorityBadge, StatusBadge, statusToneClasses } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { DateField } from "@/components/tickets/date-field";
import { Pagination, TableCell, TableHead } from "@/components/ui/table";
import { StatTiles } from "@/components/ui/stat-tiles";
import { listTickets, updateTicket, type TicketRecord } from "@/lib/tickets";
import { getDepartment, type Member } from "@/lib/departments";
import { errorMessage } from "@/lib/api";
import { useActiveDepartment } from "@/components/layout/active-department";
import { cn, formatDate } from "@/lib/utils";
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

const COMPACT = "h-11 pr-8 pl-3 text-[13px]";

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

/**
 * `mine` lists what I raised; `assigned` lists what my departments have been
 * asked to do. The API decides what is visible - this only renders it.
 */
export function TicketsWorkspace({ scope }: { scope: "mine" | "assigned" }) {
  const [tickets, setTickets] = useState<TicketRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [managing, setManaging] = useState<TicketRecord | null>(null);
  const { active } = useActiveDepartment();

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        setTickets(await listTickets({ scope }, signal));
        setError("");
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setError(errorMessage(caught));
      } finally {
        setLoading(false);
      }
    },
    [scope],
  );

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const visible = useMemo(
    () =>
      scope === "assigned" && active
        ? tickets.filter((ticket) => ticket.department.id === active.id)
        : tickets,
    [tickets, scope, active],
  );

  const stats = useMemo(() => statsFor(visible, scope), [visible, scope]);

  const rows = useMemo(() => {
    const term = query.trim().toLowerCase();
    return tickets.filter((ticket) => {
      if (term && !`${ticket.number} ${ticket.subject} ${ticket.requestType}`.toLowerCase().includes(term))
        return false;
      if (status && ticket.status !== status) return false;
      if (priority && ticket.priority !== priority) return false;
      // Switching department in the topbar narrows this queue to that one.
      if (scope === "assigned" && active && ticket.department.id !== active.id) return false;
      return true;
    });
  }, [tickets, query, status, priority, scope, active]);

  const columns = scope === "mine" ? 9 : 11;

  /** Optimistic: the row moves now, and snaps back if the API refuses. */
  const applyStatus = async (ticket: TicketRecord, next: TicketStatus) => {
    const previous = tickets;
    setTickets((current) =>
      current.map((item) => (item.id === ticket.id ? { ...item, status: next } : item)),
    );
    try {
      const saved = await updateTicket(ticket.id, { status: next });
      setTickets((current) => current.map((item) => (item.id === saved.id ? saved : item)));
      setError("");
    } catch (caught) {
      setTickets(previous);
      setError(errorMessage(caught));
    }
  };

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

      <StatTiles stats={stats} />

      <Card className="mt-4 overflow-hidden">
        <div className="flex flex-wrap items-center gap-2.5 border-b border-line p-2.5">
          <div className="min-w-44 flex-1">
            <Input
              className="h-11 text-[13px]"
              icon={<Search className="text-ink-400" />}
              placeholder="Search by ticket ID, subject or keyword..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search tickets"
            />
          </div>

          <Select
            className={COMPACT + " w-36 shrink-0"}
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
            className={COMPACT + " w-36 shrink-0"}
            value={priority}
            onChange={(event) => setPriority(event.target.value)}
            aria-label="Filter by priority"
          >
            <option value="">All Priorities</option>
            {PRIORITIES.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </Select>

          {scope === "mine" && (
            <Link
              href="/create-ticket"
              className="inline-flex h-11 items-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white shadow-sm shadow-brand-600/25 transition-colors hover:bg-brand-700"
            >
              <Plus className="size-4" strokeWidth={2.5} />
              Create Ticket
            </Link>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1120px] border-collapse">
            <thead className="border-b border-line bg-ink-50/60">
              <tr>
                <TableHead sortable>Ticket ID</TableHead>
                <TableHead sortable className="min-w-[180px]">
                  Subject
                </TableHead>
                {scope === "assigned" && <TableHead sortable>Raised By</TableHead>}
                <TableHead sortable>From Department</TableHead>
                <TableHead sortable>To Department</TableHead>
                <TableHead sortable>Request Type</TableHead>
                <TableHead sortable>Priority</TableHead>
                <TableHead sortable>Status</TableHead>
                <TableHead sortable>Created On</TableHead>
                <TableHead sortable>Deadline</TableHead>
                {scope === "assigned" && <TableHead>Actions</TableHead>}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={columns} className="px-3 py-12 text-center text-sm text-ink-400">
                    Loading…
                  </td>
                </tr>
              )}

              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={columns} className="px-3 py-12 text-center">
                    <Inbox className="mx-auto size-6 text-ink-300" />
                    <p className="mt-2 text-sm font-semibold text-ink-700">
                      {scope === "mine" ? "No requests yet" : "Nothing in your queue"}
                    </p>
                    <p className="mt-0.5 text-sm text-ink-400">
                      {scope === "mine"
                        ? "Raise one and it lands in that department's queue."
                        : "Tickets raised to your departments will appear here."}
                    </p>
                  </td>
                </tr>
              )}

              {!loading &&
                rows.map((ticket) => (
                  <tr
                    key={ticket.id}
                    className="border-b border-line transition-colors last:border-0 hover:bg-ink-50/70"
                  >
                    <TableCell>
                      <span className="text-sm font-semibold text-brand-600">#{ticket.number}</span>
                    </TableCell>
                    <TableCell className="font-semibold whitespace-normal text-ink-900">
                      {ticket.subject}
                    </TableCell>

                    {scope === "assigned" && (
                      <TableCell className="whitespace-normal">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="font-medium text-ink-700">{ticket.raisedBy.name}</span>
                          <OriginTag role={ticket.raisedByRole} />
                        </span>
                      </TableCell>
                    )}

                    <TableCell className="whitespace-normal">
                      {ticket.fromDepartments.length === 0 ? (
                        // Empty for a manager: they sit above the departments,
                        // so the Raised By tag carries the origin instead.
                        <span className="text-ink-400">—</span>
                      ) : (
                        <span className="flex flex-wrap gap-1">
                          {ticket.fromDepartments.map((item) => (
                            <span
                              key={item.id}
                              className="rounded-md bg-ink-100 px-2 py-0.5 text-[11px] font-medium text-ink-600"
                            >
                              {item.name}
                            </span>
                          ))}
                        </span>
                      )}
                    </TableCell>

                    <TableCell>
                      <span className="rounded-md bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700">
                        {ticket.department.name}
                      </span>
                    </TableCell>
                    <TableCell>{ticket.requestType}</TableCell>
                    <TableCell>
                      <PriorityBadge priority={ticket.priority} />
                    </TableCell>
                    <TableCell>
                      {scope === "assigned" ? (
                        <Select
                          className={cn(
                            "h-8 w-32 border-transparent pr-7 pl-2.5 text-xs font-semibold",
                            statusToneClasses(ticket.status),
                          )}
                          value={ticket.status}
                          onChange={(event) =>
                            applyStatus(ticket, event.target.value as TicketStatus)
                          }
                          aria-label={`Status of ${ticket.number}`}
                        >
                          {STATUSES.map((item) => (
                            <option key={item}>{item}</option>
                          ))}
                        </Select>
                      ) : (
                        <StatusBadge status={ticket.status} />
                      )}
                    </TableCell>
                    <TableCell>{formatDate(ticket.createdAt.slice(0, 10))}</TableCell>
                    <TableCell>
                      {ticket.deadline ? formatDate(ticket.deadline.slice(0, 10)) : "—"}
                    </TableCell>

                    {scope === "assigned" && (
                      <TableCell>
                        <button
                          type="button"
                          onClick={() => setManaging(ticket)}
                          className="grid size-7 place-items-center rounded-lg text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700"
                          aria-label={`Manage ${ticket.number}`}
                        >
                          <SlidersHorizontal className="size-4" />
                        </button>
                      </TableCell>
                    )}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        <Pagination
          summary={`Showing 1 to ${rows.length} of ${rows.length} tickets`}
          pages={1}
          current={1}
        />
      </Card>

      <ManageTicketModal
        ticket={managing}
        onClose={() => setManaging(null)}
        onSaved={(saved) => {
          setTickets((current) => current.map((item) => (item.id === saved.id ? saved : item)));
          setManaging(null);
        }}
      />
    </>
  );
}

/* ------------------------------------------------------------ manage panel */

function ManageTicketModal({
  ticket,
  onClose,
  onSaved,
}: {
  ticket: TicketRecord | null;
  onClose: () => void;
  onSaved: (ticket: TicketRecord) => void;
}) {
  return (
    <Modal
      open={ticket !== null}
      onClose={onClose}
      title={ticket ? `Work ${ticket.number}` : "Work ticket"}
      description="Set where this stands, who owns it and when it is due."
    >
      {ticket && <ManageTicketForm key={ticket.id} ticket={ticket} onClose={onClose} onSaved={onSaved} />}
    </Modal>
  );
}

function ManageTicketForm({
  ticket,
  onClose,
  onSaved,
}: {
  ticket: TicketRecord;
  onClose: () => void;
  onSaved: (ticket: TicketRecord) => void;
}) {
  const [status, setStatus] = useState<TicketStatus>(ticket.status);
  const [deadline, setDeadline] = useState(ticket.deadline ? ticket.deadline.slice(0, 10) : "");
  const [assignee, setAssignee] = useState(ticket.assignee?.id ?? "");
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  // Only this department's people can own its work, so that is the list.
  useEffect(() => {
    const controller = new AbortController();
    getDepartment(ticket.department.id, controller.signal)
      .then((data) => setMembers(data.members))
      .catch(() => setMembers([]));
    return () => controller.abort();
  }, [ticket.department.id]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    try {
      onSaved(
        await updateTicket(ticket.id, {
          status,
          deadline: deadline || null,
          assignee: assignee || null,
        }),
      );
    } catch (caught) {
      setError(errorMessage(caught));
      setPending(false);
    }
  };

  return (
    <form className="space-y-4" onSubmit={submit} noValidate>
      {error && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-field border border-brand-200 bg-brand-50 px-3.5 py-2.5 text-sm font-medium text-brand-700"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="rounded-field bg-ink-50 px-3.5 py-3">
        <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink-900">
          {ticket.subject}
          <OriginTag role={ticket.raisedByRole} />
        </p>
        <p className="mt-0.5 text-xs text-ink-500">
          {ticket.requestType} · raised by {ticket.raisedBy.name} · {ticket.department.name}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Status" htmlFor="manage-status">
          <Select
            id="manage-status"
            className={cn("h-11 border-transparent font-semibold", statusToneClasses(status))}
            value={status}
            onChange={(event) => setStatus(event.target.value as TicketStatus)}
          >
            {STATUSES.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </Select>
        </Field>

        <Field label="Assignee" htmlFor="manage-assignee">
          <Select
            id="manage-assignee"
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

        <Field label="Deadline" htmlFor="manage-deadline">
          <DateField id="manage-deadline" value={deadline} onChange={setDeadline} />
        </Field>
      </div>

      <div className="flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row sm:justify-between">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="text-status-completed-fg"
          onClick={() => setStatus("Completed")}
        >
          Mark as resolved
        </Button>

        <div className="flex gap-2 sm:justify-end">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </div>
    </form>
  );
}
