"use client";

import { Building, Check } from "lucide-react";

import { cn } from "@/lib/utils";
import type { DepartmentRole } from "@/lib/auth";
import type { Department } from "@/lib/departments";
import type { MembershipInput } from "@/lib/users";

/**
 * Picks the departments a user belongs to and their role in each - the one
 * control behind both "add to several departments" and "edit a user".
 * `lockedDepartmentId` pins a row that cannot be unticked (the department you
 * are currently adding from).
 *
 * Rows are grouped under their unit, because one person can hold departments
 * in several units at once and two units may well have a department of the
 * same name.
 */
export function DepartmentRolePicker({
  departments,
  value,
  onChange,
  lockedDepartmentId,
}: {
  departments: Department[];
  value: MembershipInput[];
  onChange: (value: MembershipInput[]) => void;
  lockedDepartmentId?: string;
}) {
  const roleOf = (id: string) => value.find((item) => item.department === id)?.role;

  const toggle = (id: string) => {
    if (id === lockedDepartmentId) return;
    onChange(
      roleOf(id)
        ? value.filter((item) => item.department !== id)
        : [...value, { department: id, role: "team" }],
    );
  };

  const setRole = (id: string, role: DepartmentRole) =>
    onChange(value.map((item) => (item.department === id ? { ...item, role } : item)));

  if (departments.length === 0) {
    return <p className="text-sm text-ink-400">No departments yet.</p>;
  }

  // Group by unit, keeping the order the list arrived in.
  const groups: { id: string; name: string; departments: Department[] }[] = [];
  for (const department of departments) {
    const id = department.unit?.id ?? "none";
    const existing = groups.find((group) => group.id === id);
    if (existing) existing.departments.push(department);
    else
      groups.push({
        id,
        name: department.unit?.name ?? "No unit",
        departments: [department],
      });
  }

  const chosenIn = (group: (typeof groups)[number]) =>
    group.departments.filter((department) => roleOf(department.id) !== undefined).length;

  const renderRow = (department: Department) => {
    const role = roleOf(department.id);
    const selected = role !== undefined;
    const locked = department.id === lockedDepartmentId;

    return (
          <li
            key={department.id}
            className={cn("flex items-center gap-3 px-3 py-2", selected && "bg-ink-50/60")}
          >
            <button
              type="button"
              onClick={() => toggle(department.id)}
              disabled={locked}
              aria-pressed={selected}
              className="flex min-w-0 flex-1 items-center gap-2.5 text-left disabled:cursor-default"
            >
              <span
                className={cn(
                  "grid size-4.5 shrink-0 place-items-center rounded border transition-colors",
                  selected ? "border-brand-600 bg-brand-600 text-white" : "border-line-strong",
                  locked && "opacity-60",
                )}
              >
                {selected && <Check className="size-3" strokeWidth={3.5} />}
              </span>
              <span className="truncate text-sm text-ink-700">{department.name}</span>
              {locked && <span className="text-[11px] text-ink-400">(current)</span>}
            </button>

            <select
              value={role ?? "team"}
              disabled={!selected}
              onChange={(event) => setRole(department.id, event.target.value as DepartmentRole)}
              aria-label={`Role in ${department.name}`}
              className={cn(
                "h-8 rounded-lg border border-line-strong bg-surface px-2 text-xs font-medium text-ink-700",
                "focus:border-brand-400 focus:outline-none",
                !selected && "invisible",
              )}
            >
              <option value="head">Head</option>
              <option value="team">User</option>
            </select>
          </li>
        );
  };

  return (
    <div className="max-h-64 overflow-y-auto rounded-field border border-line-strong">
      {groups.map((group) => {
        const chosen = chosenIn(group);
        return (
          <section key={group.id}>
            <p className="sticky top-0 z-10 flex items-center gap-1.5 border-b border-line bg-ink-50 px-3 py-1.5 text-[11px] font-bold tracking-wide text-ink-500 uppercase">
              <Building className="size-3.5 text-ink-400" />
              <span className="min-w-0 flex-1 truncate">{group.name}</span>
              {chosen > 0 && (
                <span className="rounded-md bg-brand-600 px-1.5 py-0.5 text-[10px] text-white">
                  {chosen}
                </span>
              )}
            </p>
            <ul className="divide-y divide-line">{group.departments.map(renderRow)}</ul>
          </section>
        );
      })}
    </div>
  );
}
