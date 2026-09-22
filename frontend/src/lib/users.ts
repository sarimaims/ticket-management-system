import { api } from "./api";
import type { DepartmentRole, Role, Session } from "./auth";

/** A directory row. Same shape the API returns for the signed-in user. */
export type DirectoryUser = Session & {
  createdAt: string;
  lastActiveAt: string;
};

export type MembershipInput = { department: string; role: DepartmentRole };

export function listUsers(
  filters: { role?: string; status?: string; department?: string } = {},
  signal?: AbortSignal,
) {
  const query = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value) query.set(key, value);
  });
  const suffix = query.toString() ? `?${query}` : "";

  return api<{ users: DirectoryUser[] }>(`/users${suffix}`, { signal }).then((data) => data.users);
}

export function createUser(input: {
  name: string;
  email: string;
  password: string;
  role?: Extract<Role, "admin" | "user">;
  /** Where they sit from day one. Ignored for an admin, who belongs nowhere. */
  memberships?: MembershipInput[];
}) {
  return api<{ user: DirectoryUser }>("/users", { method: "POST", body: input }).then(
    (data) => data.user,
  );
}

export function updateUser(
  id: string,
  input: {
    name?: string;
    email?: string;
    status?: DirectoryUser["status"];
    role?: Extract<Role, "admin" | "user">;
    memberships?: MembershipInput[];
  },
) {
  return api<{ user: DirectoryUser }>(`/users/${id}`, { method: "PATCH", body: input }).then(
    (data) => data.user,
  );
}

export function deleteUser(id: string) {
  return api<{ success: boolean }>(`/users/${id}`, { method: "DELETE" });
}
