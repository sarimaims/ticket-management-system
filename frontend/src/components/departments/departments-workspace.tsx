"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Building,
  Building2,
  ListFilter,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { MultiSelect } from "@/components/ui/multi-select";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { TableCell, TableHead } from "@/components/ui/table";
import { TableSkeleton } from "@/components/ui/skeleton";
import { StatTiles } from "@/components/ui/stat-tiles";
import { useAuth } from "@/components/auth/auth-provider";
import { errorMessage } from "@/lib/api";
import { isAdmin } from "@/lib/auth";
import { EditDetailsModal } from "@/components/ui/edit-details-modal";
import type { Stat } from "@/lib/types";
import {
  createDepartment,
  deleteDepartment,
  type Department,
  listDepartments,
  updateDepartment,
} from "@/lib/departments";
import { listUnitOptions, type UnitOption } from "@/lib/units";

/** A tile that narrows the list: which departments it counts, and keeps. */
type View = "headed" | "headless" | "empty";

const VIEWS: Record<View, { label: string; test: (department: Department) => boolean }> = {
  headed: { label: "With Head", test: (department) => department.headCount > 0 },
  // Nobody to approve or hand work to: the one worth noticing.
  headless: { label: "No Head", test: (department) => department.headCount === 0 },
  empty: { label: "Empty", test: (department) => department.memberCount === 0 },
};

const isView = (key: string): key is View => key in VIEWS;

function Banner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="mb-4 flex items-start gap-2.5 rounded-field border border-brand-200 bg-brand-50 px-3.5 py-2.5 text-sm font-medium text-brand-700"
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" />
      {message}
    </div>
  );
}

export function DepartmentsWorkspace() {
  const router = useRouter();
  const { session, refresh } = useAuth();
  const canManage = isAdmin(session);
  const toast = useToast();

  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [units, setUnits] = useState<UnitOption[]>([]);
  const [unitFilter, setUnitFilter] = useState<string[]>([]);
  /** Set by a tile; null shows every department. */
  const [view, setView] = useState<View | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Department | null>(null);
  /** The one being edited, if any. */
  const [editing, setEditing] = useState<Department | null>(null);
  /** The departments this person heads: theirs to rename, as any is an admin's. */
  const headOf = new Set(
    (session?.departments ?? []).filter((item) => item.role === "head").map((item) => item.id),
  );

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      setDepartments(await listDepartments(signal));
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
  }, []);

  /** Saves what changed, then reads the list again so order and counts agree. */
  const saveEdit = async (changes: { name?: string; description?: string; unit?: string }) => {
    if (!editing) return;
    const saved = await updateDepartment(editing.id, changes);
    toast.success("Department updated", saved.name);
    setEditing(null);
    await load();
    void refresh();
  };

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    listUnitOptions(controller.signal)
      .then(setUnits)
      .catch(() => setUnits([]));
    return () => controller.abort();
  }, [load]);

  const search = query.trim().toLowerCase();
  const visible = departments.filter((department) => {
    if (view && !VIEWS[view].test(department)) return false;
    // An empty filter asks nothing of the row, so it lets everything past.
    if (unitFilter.length > 0 && !unitFilter.includes(department.unit?.id ?? "")) return false;
    return (department.name + department.code + department.description)
      .toLowerCase()
      .includes(search);
  });

  /*
   * Every tile counts departments, with the same test a click on it applies,
   * so a lit tile and the rows below it always agree on the number.
   */
  const stats: Stat[] = [
    { label: "Departments", value: departments.length, caption: "", tone: "new", key: "all" },
    ...(Object.keys(VIEWS) as View[]).map(
      (key): Stat => ({
        label: VIEWS[key].label,
        value: departments.filter(VIEWS[key].test).length,
        caption: "",
        tone: key === "headed" ? "admin" : key === "headless" ? "overdue" : "cancelled",
        key,
      }),
    ),
  ];

  /** A tile is a filter; clicking the lit one, or Departments, clears it. */
  const selectTile = (key: string) => {
    setView(key === view || !isView(key) ? null : key);
  };

  // What is narrowing the list, each one removable on its own.
  const unitName = (id: string) => units.find((unit) => unit.id === id)?.name ?? "Unit";
  const inForce: { key: string; label: string; clear: () => void }[] = [];
  if (view) inForce.push({ key: "view", label: VIEWS[view].label, clear: () => setView(null) });
  if (unitFilter.length > 0) {
    inForce.push({
      key: "unit",
      label: `Unit: ${unitFilter.map(unitName).join(", ")}`,
      clear: () => setUnitFilter([]),
    });
  }
  if (search) {
    inForce.push({ key: "search", label: `Search: “${query.trim()}”`, clear: () => setQuery("") });
  }

  const clearFilters = () => {
    setView(null);
    setUnitFilter([]);
    setQuery("");
  };

  return (
    <>
      <PageHeader
        title="Departments"
        crumbs={[{ label: "Home", href: "/dashboard" }, { label: "Departments" }]}
      />

      {error && <Banner message={error} />}

      <StatTiles
        stats={stats}
        loading={loading}
        className="mb-2"
        active={view ?? "all"}
        onSelect={selectTile}
      />

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-1.5">
          <div className="min-w-44 flex-1">
            <Input
              className="text-[13px]"
              icon={<Search className="text-ink-400" />}
              placeholder="Search departments..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search departments"
            />
          </div>

          <div className="w-44 shrink-0">
            <MultiSelect
              options={units.map((unit) => ({ value: unit.id, label: unit.name }))}
              value={unitFilter}
              onChange={setUnitFilter}
              display="summary"
              placeholder="All units"
              emptyMessage="No units yet"
            />
          </div>

          {canManage && (
            <Button className="shrink-0" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" strokeWidth={2.5} />
              New Department
            </Button>
          )}
        </div>

        {/* The same strip My Requests shows: a list that leaves things out
            says so, and puts each filter one click from gone. */}
        {inForce.length > 0 && (
          <div
            role="status"
            className="flex flex-wrap items-center gap-1.5 border-b border-status-progress-fg/15 bg-status-progress-bg/70 px-2.5 py-1.5"
          >
            <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-bold text-status-progress-fg">
              <ListFilter className="size-3.5" />
              Filtered view
            </span>
            <span className="shrink-0 text-[11px] text-ink-500">
              Showing <span className="font-bold text-ink-800">{visible.length}</span> of{" "}
              <span className="font-bold text-ink-800">{departments.length}</span> departments
            </span>

            <span aria-hidden className="h-3.5 w-px shrink-0 bg-status-progress-fg/20" />

            {inForce.map((item) => (
              <span
                key={item.key}
                className="inline-flex max-w-[16rem] items-center gap-0.5 rounded-full border border-line bg-surface py-0.5 pr-0.5 pl-2 text-[11px] font-medium text-ink-700 shadow-xs"
              >
                <span className="truncate">{item.label}</span>
                <button
                  type="button"
                  onClick={item.clear}
                  aria-label={`Remove filter: ${item.label}`}
                  className="grid size-4 shrink-0 cursor-pointer place-items-center rounded-full text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700"
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}

            <button
              type="button"
              onClick={clearFilters}
              className="ml-auto inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold text-status-progress-fg transition-colors hover:bg-status-progress-fg/10"
            >
              Show all departments
            </button>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] border-collapse">
            <thead className="border-b border-line bg-ink-50/60">
              <tr>
                <TableHead sortable>Department</TableHead>
                <TableHead sortable>Unit</TableHead>
                <TableHead>Description</TableHead>
                <TableHead sortable>Members</TableHead>
                <TableHead sortable>Heads</TableHead>
                <TableHead sortable>Users</TableHead>
                <TableHead>Actions</TableHead>
              </tr>
            </thead>
            <tbody>
              {loading && <TableSkeleton rows={4} columns={7} />}

              {!loading && visible.length === 0 && departments.length > 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-10 text-center">
                    <ListFilter className="mx-auto size-6 text-ink-300" />
                    <p className="mt-2 text-sm font-semibold text-ink-700">
                      No departments match these filters
                    </p>
                    <button
                      type="button"
                      onClick={clearFilters}
                      className="mt-1 text-sm font-semibold text-brand-600 hover:text-brand-700"
                    >
                      Clear filters
                    </button>
                  </td>
                </tr>
              )}

              {!loading && departments.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-10 text-center">
                    <Building2 className="mx-auto size-6 text-ink-300" />
                    <p className="mt-2 text-sm font-semibold text-ink-700">No departments yet</p>
                    <p className="mt-0.5 text-sm text-ink-400">
                      {canManage
                        ? "Create one to start assigning heads and team members."
                        : "A super admin has not created any yet."}
                    </p>
                  </td>
                </tr>
              )}

              {!loading &&
                visible.map((department) => (
                  <tr
                    key={department.id}
                    onClick={() => router.push(`/departments/${department.id}`)}
                    className="cursor-pointer border-b border-line transition-colors last:border-0 hover:bg-ink-50/70"
                  >
                    <TableCell>
                      <span className="font-semibold text-ink-900">{department.name}</span>
                    </TableCell>
                    <TableCell>
                      {department.unit ? (
                        <Link
                          href={`/units/${department.unit.id}`}
                          onClick={(event) => event.stopPropagation()}
                          className="inline-flex items-center gap-1.5 rounded-md bg-ink-100 px-2 py-0.5 text-[12px] font-semibold text-ink-600 transition-colors hover:bg-ink-200"
                        >
                          <Building className="size-3.5" />
                          {department.unit.name ?? "Unit"}
                        </Link>
                      ) : (
                        <span className="text-ink-400">—</span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[280px] truncate whitespace-normal text-ink-500">
                      {department.description || "—"}
                    </TableCell>
                    <TableCell className="font-semibold text-ink-900">
                      {department.memberCount}
                    </TableCell>
                    <TableCell>{department.headCount}</TableCell>
                    <TableCell>{department.teamCount}</TableCell>
                    <TableCell>
                      <span
                        className="flex items-center gap-2"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <Link
                          href={`/departments/${department.id}`}
                          className="text-[13px] font-semibold text-brand-600 hover:text-brand-700"
                        >
                          Manage
                        </Link>
                        {(canManage || headOf.has(department.id)) && (
                          <button
                            type="button"
                            onClick={() => setEditing(department)}
                            className="grid size-7 cursor-pointer place-items-center rounded-lg text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700"
                            aria-label={`Edit ${department.name}`}
                            title="Edit"
                          >
                            <Pencil className="size-3.5" />
                          </button>
                        )}
                        {canManage && (
                          <button
                            type="button"
                            onClick={() => setPendingDelete(department)}
                            className="grid size-7 place-items-center rounded-lg text-ink-400 transition-colors hover:bg-ink-100 hover:text-brand-600"
                            aria-label={`Delete ${department.name}`}
                          >
                            <Trash2 className="size-4" />
                          </button>
                        )}
                      </span>
                    </TableCell>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </Card>

      <CreateDepartmentModal
        key={createOpen ? `open-${unitFilter.join("-")}` : "closed"}
        open={createOpen}
        units={units}
        defaultUnit={unitFilter.length === 1 ? unitFilter[0] : ""}
        onClose={() => setCreateOpen(false)}
        onCreated={(department) => {
          setDepartments((current) => [...current, department].sort((a, b) => a.name.localeCompare(b.name)));
          setCreateOpen(false);
          toast.success(`${department.name} created`);
        }}
      />

      <EditDetailsModal
        open={editing !== null}
        title="Edit department"
        hint="What it is called and what it handles. Everyone sees the change at once; the short code stays the same."
        nameLabel="Department name"
        current={{
          name: editing?.name ?? "",
          description: editing?.description ?? "",
          unit: editing?.unit?.id,
        }}
        // Moving between units is an admin's alone.
        units={canManage && units.length > 0 ? units : undefined}
        onClose={() => setEditing(null)}
        onSave={saveEdit}
      />

      <DeleteDepartmentModal
        department={pendingDelete}
        onClose={() => setPendingDelete(null)}
        onDeleted={(id) => {
          const gone = departments.find((department) => department.id === id);
          setDepartments((current) => current.filter((department) => department.id !== id));
          setPendingDelete(null);
          toast.success(
            `${gone?.name ?? "Department"} deleted`,
            gone && gone.memberCount > 0
              ? `${gone.memberCount} member(s) detached.`
              : undefined,
          );
        }}
      />
    </>
  );
}

function CreateDepartmentModal({
  open,
  units,
  defaultUnit,
  onClose,
  onCreated,
}: {
  open: boolean;
  units: UnitOption[];
  defaultUnit: string;
  onClose: () => void;
  onCreated: (department: Department) => void;
}) {
  const [name, setName] = useState("");
  // Whatever the list is filtered to is the obvious parent; with a single
  // unit in the workspace there is nothing to choose. The modal is remounted
  // when it opens, so this initial value is always current.
  const [unit, setUnit] = useState(defaultUnit || (units.length === 1 ? units[0].id : ""));
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const close = () => {
    setName("");
    setDescription("");
    setError("");
    onClose();
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setError("Department name is required.");
      return;
    }
    if (!unit) {
      setError("Choose the unit this department belongs to.");
      return;
    }

    setPending(true);
    try {
      onCreated(
        await createDepartment({ name: name.trim(), unit, description: description.trim() }),
      );
      setName("");
      setDescription("");
      setError("");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="New Department"
      description="Every department lives inside a unit."
    >
      <form className="space-y-4" onSubmit={submit} noValidate>
        {error && <Banner message={error} />}

        <Field label="Unit" required htmlFor="department-unit">
          {units.length === 0 ? (
            <p className="rounded-field bg-ink-50 px-3.5 py-2.5 text-sm text-ink-500">
              No units exist yet.{" "}
              <Link href="/units" className="font-semibold text-brand-600 underline">
                Create one first
              </Link>
              .
            </p>
          ) : (
            <Select
              id="department-unit"
              className="h-8"
              icon={<Building className="text-ink-500" />}
              value={unit}
              onChange={(event) => setUnit(event.target.value)}
            >
              <option value="">Choose a unit…</option>
              {units.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field label="Department name" required htmlFor="department-name">
          <Input
            id="department-name"
            className="h-8"
            icon={<Building2 className="text-ink-500" />}
            placeholder="e.g. Human Resources"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoFocus
          />
        </Field>

        <Field label="Description" hint="(optional)" htmlFor="department-description">
          <Textarea
            id="department-description"
            className="min-h-20"
            maxLength={280}
            placeholder="What does this department handle?"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>

        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button type="button" variant="outline" size="sm" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Creating…" : "Create Department"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function DeleteDepartmentModal({
  department,
  onClose,
  onDeleted,
}: {
  department: Department | null;
  onClose: () => void;
  onDeleted: (id: string) => void;
}) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const confirm = async () => {
    if (!department) return;
    setPending(true);
    try {
      await deleteDepartment(department.id);
      onDeleted(department.id);
      setError("");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal
      open={department !== null}
      onClose={onClose}
      title={`Delete ${department?.name ?? ""}?`}
      description="Members stay in the workspace but lose this department."
      className="max-w-md"
    >
      {error && <Banner message={error} />}
      <p className="text-sm text-ink-600">
        This removes the department and detaches its{" "}
        <span className="font-semibold text-ink-900">{department?.memberCount ?? 0}</span> member(s).
        It cannot be undone.
      </p>
      <div className="mt-4 flex justify-end gap-2 border-t border-line pt-4">
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" size="sm" onClick={confirm} disabled={pending}>
          {pending ? "Deleting…" : "Delete Department"}
        </Button>
      </div>
    </Modal>
  );
}
