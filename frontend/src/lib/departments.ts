import { api } from "./api";
import type { DepartmentRole, Membership } from "./auth";

/** The unit a department sits under, as the API sends it alongside. */
export type DepartmentUnit = { id: string; name?: string; code?: string };

export type Department = {
  id: string;
  name: string;
  code: string;
  unit: DepartmentUnit | null;
  description: string;
  isActive: boolean;
  memberCount: number;
  headCount: number;
  teamCount: number;
  createdAt: string;
};

export type Member = {
  id: string;
  name: string;
  email: string;
  role: "superadmin" | "user";
  status: "active" | "invited" | "suspended";
  departments: Membership[];
  departmentRole: DepartmentRole;
  createdAt: string;
  lastActiveAt: string;
};

export type DepartmentOption = Pick<Department, "id" | "name" | "code"> & {
  unit: { id: string; name: string } | null;
};

/** A name to address a ticket at, without the rest of the person's record. */
export type MemberOption = {
  id: string;
  name: string;
  departmentRole: DepartmentRole;
};

/**
 * One person as they sit in one department. Somebody in two departments comes
 * back twice - the two are different people to address, because the ticket
 * follows the department they were picked from.
 */
export type PersonOption = MemberOption & {
  department: { id: string; name: string };
  unit: { id: string; name: string } | null;
};

/**
 * Everyone a ticket can be addressed at. Both filters are optional: no unit
 * and no department means the whole org chart, a unit alone means everyone
 * under it.
 */
export function listPeopleOptions(
  filter: { unit?: string; department?: string } = {},
  signal?: AbortSignal,
) {
  const query = new URLSearchParams();
  if (filter.unit) query.set("unit", filter.unit);
  if (filter.department) query.set("department", filter.department);
  const suffix = query.toString() ? `?${query}` : "";

  return api<{ members: PersonOption[] }>(`/departments/members/options${suffix}`, { signal }).then(
    (data) => data.members,
  );
}

/**
 * Who is in one department, names only. Open to anyone signed in, on the same
 * footing as listing the departments themselves: you may send a request to a
 * department, so you may address it at somebody in it. Reading the department
 * proper still needs {@link getDepartment}.
 */
export function listDepartmentMembers(id: string, signal?: AbortSignal) {
  return api<{ members: MemberOption[] }>(`/departments/${id}/members/options`, { signal }).then(
    (data) => data.members,
  );
}

/** Every department, names only - what you may send a ticket to. */
export function listDepartmentOptions(signal?: AbortSignal) {
  return api<{ departments: DepartmentOption[] }>("/departments/options", { signal }).then(
    (data) => data.departments,
  );
}

/**
 * The departments you may manage or inspect: yours, or all if you are an
 * admin. Pass a unit id to see only what sits under it.
 */
export function listDepartments(signal?: AbortSignal, unit?: string) {
  const query = unit ? `?unit=${encodeURIComponent(unit)}` : "";
  return api<{ departments: Department[] }>(`/departments${query}`, { signal }).then(
    (data) => data.departments,
  );
}

export function getDepartment(id: string, signal?: AbortSignal) {
  return api<{ department: Department; members: Member[] }>(`/departments/${id}`, { signal });
}

export function createDepartment(input: { name: string; unit: string; description?: string }) {
  return api<{ department: Department }>("/departments", { method: "POST", body: input }).then(
    (data) => data.department,
  );
}

/** Renames a department, or moves it to another unit. */
export function updateDepartment(
  id: string,
  input: { name?: string; description?: string; unit?: string },
) {
  return api<{ department: Department }>(`/departments/${id}`, {
    method: "PATCH",
    body: input,
  }).then((data) => data.department);
}

export function deleteDepartment(id: string) {
  return api<{ success: boolean }>(`/departments/${id}`, { method: "DELETE" });
}

export function addMember(
  departmentId: string,
  input: { name?: string; email: string; password?: string; role: DepartmentRole },
) {
  return api<{ member: Member }>(`/departments/${departmentId}/members`, {
    method: "POST",
    body: input,
  }).then((data) => data.member);
}

export function updateMemberRole(departmentId: string, userId: string, role: DepartmentRole) {
  return api<{ member: Member }>(`/departments/${departmentId}/members/${userId}`, {
    method: "PATCH",
    body: { role },
  }).then((data) => data.member);
}

export function removeMember(departmentId: string, userId: string) {
  return api<{ success: boolean }>(`/departments/${departmentId}/members/${userId}`, {
    method: "DELETE",
  });
}
