"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, Building2, Plus, Search, Trash2 } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { TableCell, TableHead } from "@/components/ui/table";
import { useAuth } from "@/components/auth/auth-provider";
import { errorMessage } from "@/lib/api";
import { isAdmin } from "@/lib/auth";
import {
  createDepartment,
  deleteDepartment,
  listDepartments,
  type Department,
} from "@/lib/departments";

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
  const { session } = useAuth();
  const canManage = isAdmin(session);

  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Department | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      setDepartments(await listDepartments(signal));
      setError("");
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const visible = departments.filter((department) =>
    (department.name + department.code + department.description)
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );

  const totals = departments.reduce(
    (sum, department) => ({
      members: sum.members + department.memberCount,
      heads: sum.heads + department.headCount,
    }),
    { members: 0, heads: 0 },
  );

  return (
    <>
      <PageHeader
        title="Departments"
        crumbs={[{ label: "Home", href: "/dashboard" }, { label: "Departments" }]}
        actions={
          <div className="flex items-center gap-4">
            <p className="hidden text-sm text-ink-500 sm:block">
              <span className="font-semibold text-ink-900">{departments.length}</span> departments ·{" "}
              <span className="font-semibold text-ink-900">{totals.members}</span> members ·{" "}
              <span className="font-semibold text-ink-900">{totals.heads}</span> heads
            </p>

            {canManage && (
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="size-4" strokeWidth={2.5} />
                New Department
              </Button>
            )}
          </div>
        }
      />

      {error && <Banner message={error} />}

      <Card className="overflow-hidden">
        <div className="border-b border-line p-2.5">
          <Input
            className="h-10"
            icon={<Search className="text-ink-400" />}
            placeholder="Search departments..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search departments"
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse">
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

              {!loading && visible.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-10 text-center">
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
                      <span className="flex items-center gap-2">
                        <span className="font-semibold text-ink-900">{department.name}</span>
                        <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[11px] font-bold text-ink-500">
                          {department.code}
                        </span>
                      </span>
                    </TableCell>
                    <TableCell className="max-w-[320px] truncate whitespace-normal text-ink-500">
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
        onClose={() => setCreateOpen(false)}
        onCreated={(department) => {
          setDepartments((current) => [...current, department].sort((a, b) => a.name.localeCompare(b.name)));
          setCreateOpen(false);
        }}
      />

      <DeleteDepartmentModal
        department={pendingDelete}
        onClose={() => setPendingDelete(null)}
        onDeleted={(id) => {
          setDepartments((current) => current.filter((department) => department.id !== id));
          setPendingDelete(null);
        }}
      />
    </>
  );
}

function CreateDepartmentModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
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
    if (!name.trim()) {
      setError("Department name is required.");
      return;
    }

    setPending(true);
    try {
      onCreated(await createDepartment({ name: name.trim(), description: description.trim() }));
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
      description="Give it a name; the short code is generated for you."
    >
      <form className="space-y-4" onSubmit={submit} noValidate>
        {error && <Banner message={error} />}

        <Field label="Department name" required htmlFor="department-name">
          <Input
            id="department-name"
            className="h-11"
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
