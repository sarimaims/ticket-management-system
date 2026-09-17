import { api } from "./api";
import type { DepartmentRole, Membership } from "./auth";

export type Department = {
  id: string;
  name: string;
  code: string;
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

export function listDepartments(signal?: AbortSignal) {
  return api<{ departments: Department[] }>("/departments", { signal }).then(
    (data) => data.departments,
  );
}

export function getDepartment(id: string, signal?: AbortSignal) {
  return api<{ department: Department; members: Member[] }>(`/departments/${id}`, { signal });
}

export function createDepartment(input: { name: string; description?: string }) {
  return api<{ department: Department }>("/departments", { method: "POST", body: input }).then(
    (data) => data.department,
  );
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
