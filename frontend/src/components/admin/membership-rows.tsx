"use client";

import { useState } from "react";
import { Building, Plus, X } from "lucide-react";

import { Select } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import type { DepartmentRole } from "@/lib/auth";
import type { Department } from "@/lib/departments";
import type { MembershipInput } from "@/lib/users";

/**
 * What someone is inside one department. Stored as head/team, which is the
 * vocabulary the rest of the workspace uses; "User" is simply the friendlier
 * word for the ordinary case.
 */
const ROLE_LABEL: Record<DepartmentRole, string> = { head: "Head", team: "User" };

type Row = {
  /** Stable across re-renders, so a half-filled row keeps its identity. */
  key: number;
  unit: string;
  department: string;
  role: DepartmentRole;
};

/**
 * One line per posting: unit, department, and what they are in it.
 *
 * A row rather than a tick-list, because the same person can hold several
 * departments in one unit and several units at once - add Reception under
 * Dubai Clinic and Radiology under Abu Dhabi Clinic, and the two rows say so
 * plainly. Each row narrows its own department list by its own unit, so the
 * two dropdowns never disagree.
 *
 * A department already spoken for is dropped from the other rows' options:
 * one person cannot hold two roles in the same department, and offering it
 * twice only invites the question.
 */
export function MembershipRows({
  departments,
  value,
  onChange,
}: {
  departments: Department[];
  value: MembershipInput[];
  onChange: (value: MembershipInput[]) => void;
}) {
  // Seeded from what is already held - editing an account opens on its
  // postings - and owned from then on, because a row being filled in has no
  // department yet and so cannot live in `value`.
  const [rows, setRows] = useState<Row[]>(() =>
    value.map((item, index) => ({
      key: index,
      unit: departments.find((department) => department.id === item.department)?.unit?.id ?? "",
      department: item.department,
      role: item.role,
    })),
  );

  const units: { id: string; name: string }[] = [];
  for (const department of departments) {
    if (department.unit && !units.some((unit) => unit.id === department.unit!.id)) {
      units.push({ id: department.unit.id, name: department.unit.name ?? "Unit" });
    }
  }

  /** Only the rows that name a department are worth handing back. */
  const publish = (next: Row[]) => {
    setRows(next);
    onChange(
      next
        .filter((row) => row.department)
        .map((row) => ({ department: row.department, role: row.role })),
    );
  };

  const update = (key: number, change: Partial<Row>) =>
    publish(rows.map((row) => (row.key === key ? { ...row, ...change } : row)));

  const add = () => {
    // One past the highest in play, so a key is never reused after a removal.
    const key = rows.reduce((highest, row) => Math.max(highest, row.key), -1) + 1;
    publish([...rows, { key, unit: "", department: "", role: "team" }]);
  };

  const remove = (key: number) => publish(rows.filter((row) => row.key !== key));

  const optionsFor = (row: Row) =>
    departments.filter(
      (department) =>
        (!row.unit || department.unit?.id === row.unit) &&
        // Its own pick stays listed; everyone else's is gone.
        !rows.some((other) => other.key !== row.key && other.department === department.id),
    );

  if (departments.length === 0) {
    return <p className="text-sm text-ink-400">No departments yet.</p>;
  }

  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div key={row.key} className="grid gap-2 sm:grid-cols-[1fr_1fr_7rem_auto]">
          <Select
            className="h-8 text-[13px]"
            icon={<Building className="text-ink-500" />}
            value={row.unit}
            aria-label="Unit"
            onChange={(event) => {
              // The department below belongs to the unit above it, so moving
              // the unit lets go of a department that is no longer under it.
              const unit = event.target.value;
              const keep = departments.some(
                (department) => department.id === row.department && department.unit?.id === unit,
              );
              update(row.key, { unit, department: keep ? row.department : "" });
            }}
          >
            <option value="">All units</option>
            {units.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.name}
              </option>
            ))}
          </Select>

          <Select
            className={cn("h-8 text-[13px]", !row.department && "text-ink-400")}
            value={row.department}
            aria-label="Department"
            onChange={(event) => update(row.key, { department: event.target.value })}
          >
            <option value="" disabled>
              {optionsFor(row).length === 0 ? "Nothing left here" : "Choose a department"}
            </option>
            {optionsFor(row).map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </Select>

          <Select
            className="h-8 text-[13px]"
            value={row.role}
            aria-label="Account type"
            onChange={(event) => update(row.key, { role: event.target.value as DepartmentRole })}
          >
            <option value="team">{ROLE_LABEL.team}</option>
            <option value="head">{ROLE_LABEL.head}</option>
          </Select>

          <button
            type="button"
            onClick={() => remove(row.key)}
            aria-label="Remove this department"
            className="grid h-10 w-10 shrink-0 place-items-center justify-self-end rounded-lg text-ink-400 transition-colors hover:bg-brand-50 hover:text-brand-600"
          >
            <X className="size-4" />
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={add}
        className={cn(
          "flex w-full items-center justify-center gap-1.5 rounded-field border border-dashed border-line-strong py-2 text-[13px] font-semibold text-ink-500 transition-colors hover:border-brand-400 hover:bg-brand-50/40 hover:text-brand-700",
          rows.length === 0 && "py-3",
        )}
      >
        <Plus className="size-4" />
        {rows.length === 0 ? "Add a department" : "Add another"}
      </button>
    </div>
  );
}
