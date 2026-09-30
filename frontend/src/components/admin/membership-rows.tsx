"use client";

import { useState } from "react";
import { Building, Plus, X } from "lucide-react";

import { Input, Label, Select } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { DEPARTMENT_ROLE_LABEL, type DepartmentRole } from "@/lib/auth";
import type { Department } from "@/lib/departments";
import type { MembershipInput } from "@/lib/users";

/**
 * What someone is inside one department. Stored as head/team, which is the
 * vocabulary the rest of the workspace uses; "User" is simply the friendlier
 * word for the ordinary case.
 */
const ROLE_LABEL: Record<DepartmentRole, string> = DEPARTMENT_ROLE_LABEL;

type Row = {
  /** Stable across re-renders, so a half-filled row keeps its identity. */
  key: number;
  unit: string;
  department: string;
  role: DepartmentRole;
  /** Their title in this department; each role carries its own. */
  designation: string;
};

/**
 * One line per posting: unit, department, what they are in it, and their
 * title there - because the same person can be the HR Executive in one unit
 * and the Payroll Lead in another.
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
  invalid,
}: {
  departments: Department[];
  value: MembershipInput[];
  onChange: (value: MembershipInput[]) => void;
  /** Saving was refused for want of a role: say so where the row would go. */
  invalid?: boolean;
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
      designation: item.designation ?? "",
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
        .map((row) => ({
          department: row.department,
          role: row.role,
          designation: row.designation,
        })),
    );
  };

  const update = (key: number, change: Partial<Row>) =>
    publish(rows.map((row) => (row.key === key ? { ...row, ...change } : row)));

  const add = () => {
    // One past the highest in play, so a key is never reused after a removal.
    const key = rows.reduce((highest, row) => Math.max(highest, row.key), -1) + 1;
    publish([...rows, { key, unit: "", department: "", role: "team", designation: "" }]);
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
    return (
      <p className={cn("text-sm text-ink-400", invalid && "font-semibold text-brand-600")}>
        No departments yet — create one before this person can hold a role.
      </p>
    );
  }

  /** The unit a department sits under, by name - for the line at the top of its card. */
  const unitName = (id: string) => units.find((unit) => unit.id === id)?.name ?? "";

  return (
    <div className="space-y-2.5">
      {rows.map((row, index) => {
        const picked = departments.find((department) => department.id === row.department);
        const missingDepartment = invalid && !row.department;
        const missingDesignation =
          invalid && Boolean(row.department) && row.designation.trim().length < 2;
        const id = (field: string) => `membership-${row.key}-${field}`;

        return (
          <section
            key={row.key}
            aria-label={`Role ${index + 1}`}
            className="overflow-hidden rounded-lg border border-line bg-surface"
          >
            {/* Which posting this is, and what it has come to so far. */}
            <header className="flex items-center gap-2 border-b border-line bg-ink-50/70 px-3 py-1.5">
              <span className="grid size-5 shrink-0 place-items-center rounded-full bg-ink-800 text-[10px] font-bold text-white tabular-nums">
                {index + 1}
              </span>
              <p className="min-w-0 flex-1 truncate text-[12px] font-semibold text-ink-800">
                {picked ? (
                  <>
                    {picked.name}
                    {picked.unit?.id && (
                      <span className="font-normal text-ink-400"> · {unitName(picked.unit.id)}</span>
                    )}
                  </>
                ) : (
                  <span className="font-normal text-ink-400">New role</span>
                )}
              </p>
              <button
                type="button"
                onClick={() => remove(row.key)}
                aria-label={`Remove role ${index + 1}`}
                className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-ink-400 transition-colors hover:bg-brand-50 hover:text-brand-600"
              >
                <X className="size-3.5" />
                Remove
              </button>
            </header>

            <div className="space-y-2.5 p-3">
              {/* Where they work. */}
              <div className="grid gap-2.5 sm:grid-cols-2">
                <div>
                  <Label htmlFor={id("unit")} required>
                    Unit
                  </Label>
                  <Select
                    id={id("unit")}
                    className="h-8 text-[13px]"
                    icon={<Building className="text-ink-500" />}
                    value={row.unit}
                    onChange={(event) => {
                      // The department below belongs to the unit above it, so
                      // moving the unit lets go of one no longer under it.
                      const unit = event.target.value;
                      const keep = departments.some(
                        (department) =>
                          department.id === row.department && department.unit?.id === unit,
                      );
                      update(row.key, { unit, department: keep ? row.department : "" });
                    }}
                  >
                    <option value="">Any unit</option>
                    {units.map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        {unit.name}
                      </option>
                    ))}
                  </Select>
                </div>

                <div>
                  <Label htmlFor={id("department")} required>
                    Department
                  </Label>
                  <Select
                    id={id("department")}
                    className={cn(
                      "h-8 text-[13px]",
                      !row.department && "text-ink-400",
                      missingDepartment && "border-brand-400 bg-brand-50/40",
                    )}
                    value={row.department}
                    aria-invalid={missingDepartment || undefined}
                    onChange={(event) => {
                      const department = event.target.value;
                      // Picking a department says which unit it is in, so the
                      // unit box follows rather than being left on "Any".
                      const unit =
                        departments.find((item) => item.id === department)?.unit?.id ?? row.unit;
                      update(row.key, { department, unit });
                    }}
                  >
                    <option value="" disabled>
                      {optionsFor(row).length === 0 ? "Nothing left here" : "Choose a department"}
                    </option>
                    {optionsFor(row).map((department) => (
                      <option key={department.id} value={department.id}>
                        {department.name}
                        {!row.unit && department.unit?.id ? ` · ${unitName(department.unit.id)}` : ""}
                      </option>
                    ))}
                  </Select>
                  {missingDepartment && (
                    <p role="alert" className="mt-1 text-[11px] font-medium text-brand-600">
                      Choose the department for this role.
                    </p>
                  )}
                </div>
              </div>

              {/* What they are there. */}
              <div className="grid gap-2.5 sm:grid-cols-[8.5rem_1fr]">
                <div>
                  <Label htmlFor={id("role")} required>
                    Role
                  </Label>
                  <Select
                    id={id("role")}
                    className="h-8 text-[13px]"
                    value={row.role}
                    onChange={(event) =>
                      update(row.key, { role: event.target.value as DepartmentRole })
                    }
                  >
                    <option value="team">{ROLE_LABEL.team}</option>
                    <option value="head">{ROLE_LABEL.head}</option>
                  </Select>
                </div>

                <div>
                  <Label htmlFor={id("designation")} required>
                    Designation
                  </Label>
                  <Input
                    id={id("designation")}
                    className={cn("h-8 text-[13px]", missingDesignation && "border-brand-400 bg-brand-50/40")}
                    value={row.designation}
                    maxLength={80}
                    placeholder="e.g. HR Executive"
                    aria-invalid={missingDesignation || undefined}
                    onChange={(event) => update(row.key, { designation: event.target.value })}
                  />
                  {missingDesignation && (
                    <p role="alert" className="mt-1 text-[11px] font-medium text-brand-600">
                      Add their designation in this department.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </section>
        );
      })}

      <button
        type="button"
        onClick={add}
        className={cn(
          "flex w-full items-center justify-center gap-1.5 rounded-field border border-dashed border-line-strong py-2 text-[13px] font-semibold text-ink-500 transition-colors hover:border-brand-400 hover:bg-brand-50/40 hover:text-brand-700",
          rows.length === 0 && "py-3",
          invalid && "border-brand-400 bg-brand-50/40 text-brand-700",
        )}
      >
        <Plus className="size-4" />
        {rows.length === 0 ? "Add a role" : "Add another role"}
      </button>
    </div>
  );
}
