"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, History, Search, Trash2 } from "lucide-react";

import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { useAuth } from "@/components/auth/auth-provider";
import { useToast } from "@/components/ui/toast";
import { clearActivity, listActivity, type ActivityEntry } from "@/lib/activity";
import { listDepartments, type Department } from "@/lib/departments";
import { errorMessage } from "@/lib/api";
import { initials, isAdmin, ROLE_LABEL } from "@/lib/auth";
import { cn } from "@/lib/utils";

/** Colour follows what happened, using the same tokens as the status badges. */
const ACTION_TONES: Record<string, string> = {
  "ticket.created": "bg-status-new-bg text-status-new-fg",
  "ticket.updated": "bg-status-progress-bg text-status-progress-fg",
  "member.added": "bg-status-completed-bg text-status-completed-fg",
  "member.removed": "bg-status-overdue-bg text-status-overdue-fg",
  "member.role_changed": "bg-status-waiting-bg text-status-waiting-fg",
  "department.created": "bg-tile-admin-bg text-tile-admin-fg",
};

const ACTION_LABELS: Record<string, string> = {
  "ticket.created": "Ticket raised",
  "ticket.updated": "Ticket updated",
  "member.added": "Member added",
  "member.removed": "Member removed",
  "member.role_changed": "Role changed",
  "department.created": "Department created",
};

/** "3 hours ago" reads better than a timestamp for a feed this recent. */
function timeAgo(iso: string) {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";

  const steps: [number, string][] = [
    [60, "minute"],
    [60, "hour"],
    [24, "day"],
    [7, "week"],
  ];

  let value = seconds;
  let unit = "second";
  for (const [size, name] of steps) {
    if (value < size) break;
    value = Math.floor(value / size);
    unit = name;
  }
  return `${value} ${unit}${value === 1 ? "" : "s"} ago`;
}

export function ActivityLog() {
  const { session } = useAuth();
  const canClear = isAdmin(session);

  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [department, setDepartment] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const toast = useToast();

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        setEntries(await listActivity({ department: department || undefined }, signal));
        setError("");
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setError(errorMessage(caught));
      } finally {
        setLoading(false);
      }
    },
    [department],
  );

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    listDepartments(controller.signal)
      .then(setDepartments)
      .catch(() => setDepartments([]));
    return () => controller.abort();
  }, [load]);

  const rows = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return entries;
    return entries.filter((entry) =>
      `${entry.actor.name} ${entry.summary} ${entry.ticketNumber}`.toLowerCase().includes(term),
    );
  }, [entries, query]);

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

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2.5 border-b border-line p-2.5">
          <div className="min-w-44 flex-1">
            <Input
              className="h-11 text-[13px]"
              icon={<Search className="text-ink-400" />}
              placeholder="Search by person, ticket or action..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search activity"
            />
          </div>

          <Select
            className="h-11 w-48 shrink-0 pr-8 pl-3 text-[13px]"
            value={department}
            onChange={(event) => setDepartment(event.target.value)}
            aria-label="Filter by department"
          >
            <option value="">
              {canClear ? "All departments" : "All my departments"}
            </option>
            {departments.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </Select>

          {canClear && (
            <Button
              variant="outline"
              className="h-11 text-brand-600"
              onClick={() => setConfirmClear(true)}
              disabled={entries.length === 0}
            >
              <Trash2 className="size-4" />
              Clear log
            </Button>
          )}
        </div>

        {loading && <p className="px-5 py-12 text-center text-sm text-ink-400">Loading…</p>}

        {!loading && rows.length === 0 && (
          <div className="px-5 py-14 text-center">
            <History className="mx-auto size-6 text-ink-300" />
            <p className="mt-2 text-sm font-semibold text-ink-700">Nothing logged yet</p>
            <p className="mt-0.5 text-sm text-ink-400">
              Raising a ticket, working one, or changing a department&apos;s members shows up here.
            </p>
          </div>
        )}

        {!loading && rows.length > 0 && (
          <ul className="divide-y divide-line">
            {rows.map((entry) => (
              <li key={entry.id} className="flex items-start gap-3 px-4 py-3">
                <Avatar
                  initials={initials(entry.actor.name)}
                  tone={entry.actor.role === "user" ? "team" : "head"}
                  className="mt-0.5 size-8 text-[11px]"
                />

                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink-700">
                    <span className="font-semibold text-ink-900">{entry.actor.name}</span>{" "}
                    {entry.summary}
                  </p>

                  <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                    <span
                      className={cn(
                        "rounded-md px-1.5 py-0.5 font-semibold",
                        ACTION_TONES[entry.action] ?? "bg-ink-100 text-ink-600",
                      )}
                    >
                      {ACTION_LABELS[entry.action] ?? entry.action}
                    </span>
                    {entry.department && (
                      <span className="rounded-md bg-ink-100 px-1.5 py-0.5 font-medium text-ink-600">
                        {entry.department.name}
                      </span>
                    )}
                    {entry.actor.role !== "user" && (
                      <span className="rounded-md bg-brand-50 px-1.5 py-0.5 font-bold text-brand-700 uppercase">
                        {ROLE_LABEL[entry.actor.role]}
                      </span>
                    )}
                    <span className="text-ink-400">{timeAgo(entry.createdAt)}</span>
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <ClearLogModal
        open={confirmClear}
        department={departments.find((item) => item.id === department) ?? null}
        count={entries.length}
        onClose={() => setConfirmClear(false)}
        onCleared={(cleared) => {
          setConfirmClear(false);
          load();
          const scope = departments.find((item) => item.id === department);
          toast.success(
            "Activity log cleared",
            `${cleared} entr${cleared === 1 ? "y" : "ies"} removed${
              scope ? ` from ${scope.name}` : ""
            }.`,
          );
        }}
      />
    </>
  );
}

function ClearLogModal({
  open,
  department,
  count,
  onClose,
  onCleared,
}: {
  open: boolean;
  department: Department | null;
  count: number;
  onClose: () => void;
  onCleared: (cleared: number) => void;
}) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const confirm = async () => {
    setPending(true);
    try {
      await clearActivity(department?.id);
      setError("");
      onCleared(count);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Clear activity log?"
      description="The history is deleted for everyone who can see it."
      className="max-w-md"
    >
      {error && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2.5 rounded-field border border-brand-200 bg-brand-50 px-3.5 py-2.5 text-sm font-medium text-brand-700"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          {error}
        </div>
      )}

      <p className="text-sm text-ink-600">
        This removes <span className="font-semibold text-ink-900">{count}</span> entr
        {count === 1 ? "y" : "ies"}{" "}
        {department ? (
          <>
            from <span className="font-semibold text-ink-900">{department.name}</span>
          </>
        ) : (
          <>from every department</>
        )}
        . It cannot be undone.
      </p>

      <div className="mt-4 flex justify-end gap-2 border-t border-line pt-4">
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" size="sm" onClick={confirm} disabled={pending}>
          {pending ? "Clearing…" : "Clear log"}
        </Button>
      </div>
    </Modal>
  );
}
