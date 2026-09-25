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

/**
 * A head's own team: everyone in the departments they run.
 *
 * The scope is the server's to decide, not a parameter here - there is no
 * department id to pass, and nothing this call can be edited into showing.
 */
export function listMyTeam(
  filters: { role?: DepartmentRole; status?: string } = {},
  signal?: AbortSignal,
) {
  const query = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value) query.set(key, value);
  });
  const suffix = query.toString() ? `?${query}` : "";

  return api<{ users: DirectoryUser[]; departments: string[] }>(`/users/team${suffix}`, {
    signal,
  });
}

/**
 * One person's card, opened from their name anywhere in the app.
 *
 * Not the directory call with a filter on it: this one is open to everybody
 * signed in, because looking up the number of whoever raised a ticket is not
 * an admin's privilege.
 */
export function getUserProfile(id: string, signal?: AbortSignal) {
  return api<{ user: DirectoryUser }>(`/users/${id}/profile`, { signal }).then(
    (data) => data.user,
  );
}

export function createUser(input: {
  name: string;
  email: string;
  phone: string;
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
    phone?: string;
    password?: string;
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
