"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, Building, Plus, Search, Trash2 } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { TableCell, TableHead } from "@/components/ui/table";
import { TableSkeleton } from "@/components/ui/skeleton";
import { StatTiles } from "@/components/ui/stat-tiles";
import { useAuth } from "@/components/auth/auth-provider";
import { errorMessage } from "@/lib/api";
import { isAdmin } from "@/lib/auth";
import type { Stat } from "@/lib/types";
import { createUnit, deleteUnit, listUnits, type Unit } from "@/lib/units";

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

/** The top of the org chart: units, and how much sits under each. */
export function UnitsWorkspace() {
  const router = useRouter();
  const { session } = useAuth();
  const canManage = isAdmin(session);
  const toast = useToast();

  const [units, setUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Unit | null>(null);

  // The tab is hidden from everyone else, so the page matches: a head who
  // types the URL is sent back rather than shown half a page.
  useEffect(() => {
    if (session && !canManage) router.replace("/dashboard");
  }, [session, canManage, router]);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      setUnits(await listUnits(signal));
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

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const visible = units.filter((unit) =>
    (unit.name + unit.code + unit.description).toLowerCase().includes(query.trim().toLowerCase()),
  );

  const totals = units.reduce(
    (sum, unit) => ({
      departments: sum.departments + unit.departmentCount,
      members: sum.members + unit.memberCount,
    }),
    { departments: 0, members: 0 },
  );

  const stats: Stat[] = [
    { label: "Units", value: units.length, caption: "", tone: "new" },
    { label: "Departments", value: totals.departments, caption: "", tone: "progress" },
    { label: "Members", value: totals.members, caption: "", tone: "completed" },
  ];

  if (session && !canManage) return null;

  return (
    <>
      <PageHeader
        title="Units"
        crumbs={[{ label: "Home", href: "/dashboard" }, { label: "Units" }]}
      />

      {error && <Banner message={error} />}

      <StatTiles stats={stats} loading={loading} className="mb-2" />

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-1.5">
          <div className="min-w-44 flex-1">
            <Input
              className="h-7 text-[12px]"
              icon={<Search className="text-ink-400" />}
              placeholder="Search units..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search units"
            />
          </div>

          {canManage && (
            <Button size="sm" className="h-7 shrink-0" onClick={() => setCreateOpen(true)}>
              <Plus className="size-3.5" strokeWidth={2.5} />
              New Unit
            </Button>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse">
            <thead className="border-b border-line bg-ink-50/60">
              <tr>
                <TableHead sortable>Unit</TableHead>
                <TableHead>Description</TableHead>
                <TableHead sortable>Departments</TableHead>
                <TableHead sortable>Members</TableHead>
                <TableHead>Actions</TableHead>
              </tr>
            </thead>
            <tbody>
              {loading && <TableSkeleton rows={3} columns={5} />}

              {!loading && visible.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-10 text-center">
                    <Building className="mx-auto size-6 text-ink-300" />
                    <p className="mt-2 text-sm font-semibold text-ink-700">No units yet</p>
                    <p className="mt-0.5 text-sm text-ink-400">
                      {canManage
                        ? "Create one, then add departments inside it."
                        : "An admin has not created any yet."}
                    </p>
                  </td>
                </tr>
              )}

              {!loading &&
                visible.map((unit) => (
                  <tr
                    key={unit.id}
                    onClick={() => router.push(`/units/${unit.id}`)}
                    className="cursor-pointer border-b border-line transition-colors last:border-0 hover:bg-ink-50/70"
                  >
                    <TableCell>
                      <span className="flex items-center gap-2">
                        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600">
                          <Building className="size-4" />
                        </span>
                        <span className="font-semibold text-ink-900">{unit.name}</span>
                        <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[11px] font-bold text-ink-500">
                          {unit.code}
                        </span>
                      </span>
                    </TableCell>
                    <TableCell className="max-w-[320px] truncate whitespace-normal text-ink-500">
                      {unit.description || "—"}
                    </TableCell>
                    <TableCell>
                      <span className="rounded-md bg-pill-members-bg px-2 py-0.5 text-[12px] font-bold text-pill-members-fg">
                        {unit.departmentCount}
                      </span>
                    </TableCell>
                    <TableCell className="font-semibold text-ink-900">{unit.memberCount}</TableCell>
                    <TableCell>
                      <span
                        className="flex items-center gap-2"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <Link
                          href={`/units/${unit.id}`}
                          className="text-[13px] font-semibold text-brand-600 hover:text-brand-700"
                        >
                          Open
                        </Link>
                        {canManage && (
                          <button
                            type="button"
                            onClick={() => setPendingDelete(unit)}
                            className="grid size-7 place-items-center rounded-lg text-ink-400 transition-colors hover:bg-ink-100 hover:text-brand-600"
                            aria-label={`Delete ${unit.name}`}
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

      <CreateUnitModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(unit) => {
          setUnits((current) => [...current, unit].sort((a, b) => a.name.localeCompare(b.name)));
          setCreateOpen(false);
          toast.success(`${unit.name} created`, `Short code ${unit.code}`);
        }}
      />

      <DeleteUnitModal
        unit={pendingDelete}
        onClose={() => setPendingDelete(null)}
        onDeleted={(id) => {
          const gone = units.find((unit) => unit.id === id);
          setUnits((current) => current.filter((unit) => unit.id !== id));
          setPendingDelete(null);
          toast.success(`${gone?.name ?? "Unit"} deleted`);
        }}
      />
    </>
  );
}

function CreateUnitModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (unit: Unit) => void;
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
      setError("Unit name is required.");
      return;
    }

    setPending(true);
    try {
      onCreated(await createUnit({ name: name.trim(), description: description.trim() }));
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
      title="New Unit"
      description="Departments are created inside a unit. The short code is generated for you."
    >
      <form className="space-y-4" onSubmit={submit} noValidate>
        {error && <Banner message={error} />}

        <Field label="Unit name" required htmlFor="unit-name">
          <Input
            id="unit-name"
            className="h-8"
            icon={<Building className="text-ink-500" />}
            placeholder="e.g. Aims Healthcare"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoFocus
          />
        </Field>

        <Field label="Description" hint="(optional)" htmlFor="unit-description">
          <Textarea
            id="unit-description"
            className="min-h-20"
            maxLength={280}
            placeholder="What sits under this unit?"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>

        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button type="button" variant="outline" size="sm" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Creating…" : "Create Unit"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function DeleteUnitModal({
  unit,
  onClose,
  onDeleted,
}: {
  unit: Unit | null;
  onClose: () => void;
  onDeleted: (id: string) => void;
}) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const confirm = async () => {
    if (!unit) return;
    setPending(true);
    try {
      await deleteUnit(unit.id);
      onDeleted(unit.id);
      setError("");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  };

  const blocked = (unit?.departmentCount ?? 0) > 0;

  return (
    <Modal
      open={unit !== null}
      onClose={onClose}
      title={`Delete ${unit?.name ?? ""}?`}
      description="A unit can only go once it is empty."
      className="max-w-md"
    >
      {error && <Banner message={error} />}

      <p className="text-sm text-ink-600">
        {blocked ? (
          <>
            <span className="font-semibold text-ink-900">{unit?.name}</span> still holds{" "}
            <span className="font-semibold text-ink-900">{unit?.departmentCount}</span> department
            {unit?.departmentCount === 1 ? "" : "s"}. Move them to another unit, or delete them
            first — deleting a unit never deletes what is inside it.
          </>
        ) : (
          <>This unit is empty and can be removed. It cannot be undone.</>
        )}
      </p>

      <div className="mt-4 flex justify-end gap-2 border-t border-line pt-4">
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" size="sm" onClick={confirm} disabled={pending || blocked}>
          {pending ? "Deleting…" : "Delete Unit"}
        </Button>
      </div>
    </Modal>
  );
}
