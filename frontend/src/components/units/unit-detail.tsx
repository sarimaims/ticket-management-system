"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, Building, Building2, Plus, Trash2, Users } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { TableCell, TableHead } from "@/components/ui/table";
import { useAuth } from "@/components/auth/auth-provider";
import { errorMessage } from "@/lib/api";
import { isAdmin } from "@/lib/auth";
import { createDepartment, deleteDepartment, type Department } from "@/lib/departments";
import { getUnit, type Unit } from "@/lib/units";

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

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-field bg-ink-50 px-3.5 py-2.5">
      <p className="text-[11px] font-bold tracking-wide text-ink-400 uppercase">{label}</p>
      <p className="text-lg leading-tight font-bold text-ink-900">{value}</p>
    </div>
  );
}

/** One unit: what it is, and every department filed under it. */
export function UnitDetail({ unitId }: { unitId: string }) {
  const router = useRouter();
  const { session } = useAuth();
  const canManage = isAdmin(session);
  const toast = useToast();

  const [unit, setUnit] = useState<Unit | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Department | null>(null);

  useEffect(() => {
    if (session && !canManage) router.replace("/dashboard");
  }, [session, canManage, router]);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const data = await getUnit(unitId, signal);
        setUnit(data.unit);
        setDepartments(data.departments);
        setError("");
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setError(errorMessage(caught));
      } finally {
        setLoading(false);
      }
    },
    [unitId],
  );

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const name = unit?.name ?? "Unit";

  if (session && !canManage) return null;

  return (
    <>
      <PageHeader
        title={name}
        backHref="/units"
        crumbs={[
          { label: "Home", href: "/dashboard" },
          { label: "Units", href: "/units" },
          { label: name },
        ]}
        actions={
          canManage && unit ? (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" strokeWidth={2.5} />
              New Department
            </Button>
          ) : undefined
        }
      />

      {error && <Banner message={error} />}

      {unit && (
        <Card className="mb-4 p-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600">
                <Building className="size-5" />
              </span>
              <div className="min-w-0">
                <p className="flex items-center gap-2">
                  <span className="text-base font-bold text-ink-900">{unit.name}</span>
                  <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[11px] font-bold text-ink-500">
                    {unit.code}
                  </span>
                </p>
                <p className="mt-0.5 text-sm text-ink-500">
                  {unit.description || "No description."}
                </p>
              </div>
            </div>

            <div className="flex gap-2">
              <Stat label="Departments" value={unit.departmentCount} />
              <Stat label="Members" value={unit.memberCount} />
            </div>
          </div>
        </Card>
      )}

      <Card className="overflow-hidden">
        <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
          <Users className="size-4 text-ink-400" />
          <p className="text-sm font-bold text-ink-900">Departments in this unit</p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse">
            <thead className="border-b border-line bg-ink-50/60">
              <tr>
                <TableHead sortable>Department</TableHead>
                <TableHead>Description</TableHead>
                <TableHead sortable>Members</TableHead>
                <TableHead sortable>Heads</TableHead>
                <TableHead sortable>Team</TableHead>
                <TableHead>Actions</TableHead>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <TableCell className="py-8 text-center text-ink-400">Loading…</TableCell>
                </tr>
              )}

              {!loading && departments.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-10 text-center">
                    <Building2 className="mx-auto size-6 text-ink-300" />
                    <p className="mt-2 text-sm font-semibold text-ink-700">
                      Nothing under this unit yet
                    </p>
                    <p className="mt-0.5 text-sm text-ink-400">
                      {canManage
                        ? "Create a department here to start assigning heads and team members."
                        : "An admin has not created any yet."}
                    </p>
                  </td>
                </tr>
              )}

              {!loading &&
                departments.map((department) => (
                  <tr
                    key={department.id}
                    onClick={() => router.push(`/departments/${department.id}`)}
                    className="cursor-pointer border-b border-line transition-colors last:border-0 hover:bg-ink-50/70"
                  >
                    <TableCell>
                      <span className="flex items-center gap-2">
                        <span className="font-semibold text-ink-900">{department.name}</span>
                        <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[11px] font-bold text-ink-500">
                          {department.code}
                        </span>
                      </span>
                    </TableCell>
                    <TableCell className="max-w-[300px] truncate whitespace-normal text-ink-500">
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
        open={createOpen}
        unit={unit}
        onClose={() => setCreateOpen(false)}
        onCreated={(department) => {
          setDepartments((current) =>
            [...current, department].sort((a, b) => a.name.localeCompare(b.name)),
          );
          setUnit((current) =>
            current ? { ...current, departmentCount: current.departmentCount + 1 } : current,
          );
          setCreateOpen(false);
          toast.success(`${department.name} created`, `Under ${unit?.name}`);
        }}
      />

      <DeleteDepartmentModal
        department={pendingDelete}
        onClose={() => setPendingDelete(null)}
        onDeleted={(id) => {
          const gone = departments.find((department) => department.id === id);
          setDepartments((current) => current.filter((department) => department.id !== id));
          setUnit((current) =>
            current ? { ...current, departmentCount: current.departmentCount - 1 } : current,
          );
          setPendingDelete(null);
          toast.success(`${gone?.name ?? "Department"} deleted`);
        }}
      />
    </>
  );
}

function CreateDepartmentModal({
  open,
  unit,
  onClose,
  onCreated,
}: {
  open: boolean;
  unit: Unit | null;
  onClose: () => void;
  onCreated: (department: Department) => void;
}) {
  const [name, setName] = useState("");
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
    if (!unit) return;
    if (!name.trim()) {
      setError("Department name is required.");
      return;
    }

    setPending(true);
    try {
      onCreated(
        await createDepartment({
          name: name.trim(),
          unit: unit.id,
          description: description.trim(),
        }),
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
      description={`It will be created inside ${unit?.name ?? "this unit"}.`}
    >
      <form className="space-y-4" onSubmit={submit} noValidate>
        {error && <Banner message={error} />}

        {/* The parent is fixed here: the page you are on is the unit. */}
        <div className="flex items-center gap-2 rounded-field bg-ink-50 px-3.5 py-2.5 text-sm">
          <Building className="size-4 shrink-0 text-ink-400" />
          <span className="text-ink-500">Unit</span>
          <span className="font-semibold text-ink-900">{unit?.name}</span>
        </div>

        <Field label="Department name" required htmlFor="unit-department-name">
          <Input
            id="unit-department-name"
            className="h-11"
            icon={<Building2 className="text-ink-500" />}
            placeholder="e.g. Human Resources"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoFocus
          />
        </Field>

        <Field label="Description" hint="(optional)" htmlFor="unit-department-description">
          <Textarea
            id="unit-department-description"
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
