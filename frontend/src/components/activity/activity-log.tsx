"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, History, Search, Trash2 } from "lucide-react";

import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { ScopeFilter, type ScopeOption } from "@/components/ui/scope-filter";
import { Modal } from "@/components/ui/modal";
import { ListSkeleton } from "@/components/ui/skeleton";
import { dayLabel } from "@/components/notifications/notification-shared";
import { useAuth } from "@/components/auth/auth-provider";
import { useToast } from "@/components/ui/toast";
import { clearActivity, listActivity, type ActivityEntry } from "@/lib/activity";
import { listDepartments, type Department } from "@/lib/departments";
import { errorMessage } from "@/lib/api";
import { initials, isAdmin, ROLE_LABEL } from "@/lib/auth";
import { cn } from "@/lib/utils";

/**
 * Colour follows what happened - as a dot, not a filled chip.
 *
 * Every row in this log carries one, and forty tinted chips down a page read as
 * decoration rather than as meaning. A dot says the same thing quietly.
 */
const ACTION_DOTS: Record<string, string> = {
  "ticket.created": "bg-status-new-fg",
  "ticket.updated": "bg-status-progress-fg",
  "ticket.deleted": "bg-status-overdue-fg",
  "member.added": "bg-status-completed-fg",
  "member.removed": "bg-status-overdue-fg",
  "member.role_changed": "bg-status-waiting-fg",
  "department.created": "bg-tile-admin-fg",
  "department.moved": "bg-status-waiting-fg",
  "unit.created": "bg-tile-admin-fg",
  "unit.updated": "bg-status-progress-fg",
  "unit.deleted": "bg-status-overdue-fg",
  "message.edited": "bg-chat-accent",
  "message.deleted": "bg-ink-400",
};

const ACTION_LABELS: Record<string, string> = {
  "ticket.created": "Ticket raised",
  "ticket.updated": "Ticket updated",
  "ticket.deleted": "Ticket deleted",
  "member.added": "Member added",
  "member.removed": "Member removed",
  "member.role_changed": "Role changed",
  "department.created": "Department created",
  "department.moved": "Department moved",
  "unit.created": "Unit created",
  "unit.updated": "Unit updated",
  "unit.deleted": "Unit deleted",
  "message.edited": "Message edited",
  "message.deleted": "Message withdrawn",
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

/** Today / Yesterday / a date, above each run of entries from one day. */
function byDay(entries: ActivityEntry[]) {
  const groups: { label: string; items: ActivityEntry[] }[] = [];

  for (const entry of entries) {
    const label = dayLabel(entry.createdAt);
    const last = groups.at(-1);
    if (last?.label === label) last.items.push(entry);
    else groups.push({ label, items: [entry] });
  }

  return groups;
}

export function ActivityLog() {
  const { session } = useAuth();
  const canClear = isAdmin(session);

  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [where, setWhere] = useState<{ units: string[]; departments: string[] }>({
    units: [],
    departments: [],
  });
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const toast = useToast();

  /**
   * A chosen unit stands for its departments, and the API only knows about
   * departments - so the unit is spent here, on the way out.
   */
  const departmentIds = useMemo(() => {
    const byUnit = departments
      .filter((item) => item.unit?.id && where.units.includes(item.unit.id))
      .map((item) => item.id);
    return [...new Set([...where.departments, ...byUnit])];
  }, [departments, where]);

  // Compared by value: the array is rebuilt on every render, and the loader
  // below would otherwise fetch forever.
  const askedFor = departmentIds.join(",");

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        setEntries(await listActivity({ departments: askedFor ? askedFor.split(",") : [] }, signal));
        setError("");
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setError(errorMessage(caught));
      } finally {
        // An aborted request is not an answer. React mounts an effect twice in
        // development, so the first fetch is always cancelled: clearing the flag
        // here would declare "nothing found" while the real request is still out.
        if (!signal?.aborted) setLoading(false);
      }
    },
    [askedFor],
  );

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    listDepartments(controller.signal)
      .then(setDepartments)
      .catch(() => setDepartments([]));
    return () => controller.abort();
  }, [load]);

  /** The one department the Clear button would target, if there is exactly one. */
  const clearTarget =
    departmentIds.length === 1
      ? (departments.find((item) => item.id === departmentIds[0]) ?? null)
      : null;

  /** Every department this reader may narrow by, under its unit. */
  const scopeOptions = useMemo<ScopeOption[]>(() => {
    const seen = new Map<string, number>();
    for (const entry of entries) {
      if (!entry.department) continue;
      seen.set(entry.department.id, (seen.get(entry.department.id) ?? 0) + 1);
    }

    return departments.map((item) => ({
      id: item.id,
      name: item.name,
      unit: item.unit?.id ? { id: item.unit.id, name: item.unit.name ?? "Unit" } : null,
      count: seen.get(item.id) ?? 0,
    }));
  }, [departments, entries]);

  const rows = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return entries;
    return entries.filter((entry) =>
      `${entry.actor.name} ${entry.summary} ${entry.ticketNumber}`.toLowerCase().includes(term),
    );
  }, [entries, query]);

  const days = useMemo(() => byDay(rows), [rows]);

  return (
    <>
      {error && (
        <div
          role="alert"
          className="mb-2.5 flex items-start gap-2 rounded-md border border-brand-200 bg-brand-50 px-2.5 py-1.5 text-[12px] font-medium text-brand-700"
        >
          <AlertCircle className="mt-px size-3.5 shrink-0" />
          {error}
        </div>
      )}

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-2">
          <div className="min-w-44 flex-1">
            <Input
              className="h-8 text-[13px]"
              icon={<Search className="text-ink-400" />}
              placeholder="Search by person, ticket or action..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search activity"
            />
          </div>

          {/* One control for both depths, the same as the ticket queues. */}
          <div className="w-52 shrink-0">
            <ScopeFilter id="activity-where" options={scopeOptions} value={where} onChange={setWhere} />
          </div>

          {canClear && (
            <Button
              variant="outline"
              className="text-brand-600"
              onClick={() => setConfirmClear(true)}
              disabled={entries.length === 0}
            >
              <Trash2 className="size-3.5" />
              Clear log
            </Button>
          )}
        </div>

        {loading && <ListSkeleton rows={5} />}

        {!loading && rows.length === 0 && (
          <div className="px-4 py-10 text-center">
            <History className="mx-auto size-5 text-ink-300" />
            <p className="mt-1.5 text-[13px] font-semibold text-ink-700">Nothing logged yet</p>
            <p className="mt-0.5 text-[11px] text-ink-400">
              Raising a ticket, working one, or changing a department&apos;s members shows up here.
            </p>
          </div>
        )}

        {/* One line per entry, under the day it happened. What matters when
            scanning a log is when and who; the rest is one quiet line. */}
        {!loading &&
          days.map((day) => (
            <section key={day.label}>
              <p className="sticky top-0 z-10 border-b border-line bg-ink-50/90 px-3 py-1 text-[10px] font-semibold tracking-[0.08em] text-ink-400 uppercase backdrop-blur">
                {day.label}
              </p>

              <ul className="divide-y divide-line">
                {day.items.map((entry) => (
                  <li key={entry.id} className="flex items-start gap-2.5 px-3 py-2">
                    <Avatar
                      initials={initials(entry.actor.name)}
                      tone={entry.actor.role === "user" ? "team" : "head"}
                      className="mt-px size-6 text-[10px]"
                    />

                    <div className="min-w-0 flex-1">
                      <p className="text-[12px] leading-snug text-ink-700">
                        <span className="font-semibold text-ink-900">{entry.actor.name}</span>{" "}
                        {entry.summary}
                      </p>

                      <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-ink-400">
                        <span className="inline-flex items-center gap-1 font-medium text-ink-500">
                          <span
                            className={cn(
                              "size-1.5 shrink-0 rounded-full",
                              ACTION_DOTS[entry.action] ?? "bg-ink-300",
                            )}
                          />
                          {ACTION_LABELS[entry.action] ?? entry.action}
                        </span>
                        {/* Only what is actually there: a department without a
                            name left a bullet pointing at nothing. */}
                        {entry.department?.name && <span>· {entry.department.name}</span>}
                        {entry.actor.role !== "user" && (
                          <span>· {ROLE_LABEL[entry.actor.role]}</span>
                        )}
                      </p>
                    </div>

                    <span className="shrink-0 pt-0.5 text-[10px] whitespace-nowrap text-ink-400">
                      {timeAgo(entry.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}

      </Card>

      <ClearLogModal
        open={confirmClear}
        department={clearTarget}
        count={entries.length}
        onClose={() => setConfirmClear(false)}
        onCleared={(cleared) => {
          setConfirmClear(false);
          load();
          const scope = clearTarget;
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
