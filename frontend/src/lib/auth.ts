import { api } from "./api";

/**
 * Workspace-wide role. Department-level roles (head/team) live on a membership.
 *  superadmin - the single owner; cannot be created, demoted or deleted
 *  admin      - full management rights, except deleting the super admin
 *  user       - no management rights
 */
export type Role = "superadmin" | "admin" | "user";

export type DepartmentRole = "head" | "team";

export type Membership = {
  id: string;
  name?: string;
  code?: string;
  role: DepartmentRole;
  /** The unit this department sits under. */
  unit?: { id: string; name?: string } | null;
};

export type Session = {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: "active" | "invited" | "suspended";
  departments: Membership[];
};

/** What this deployment supports. Attachments need a configured S3 bucket. */
export type Features = { attachments: boolean };

export const NO_FEATURES: Features = { attachments: false };

type UserResponse = { success: boolean; user: Session; features?: Features };

/* The session is an httpOnly cookie set by the API: it is never readable from
   JavaScript, so "who am I" is always a round trip to /auth/me. */

export function fetchSession(signal?: AbortSignal) {
  return api<UserResponse>("/auth/me", { signal }).then((data) => ({
    user: data.user,
    features: data.features ?? NO_FEATURES,
  }));
}

export function login(email: string, password: string) {
  return api<UserResponse>("/auth/login", {
    method: "POST",
    body: { email, password },
  }).then((data) => ({ user: data.user, features: data.features ?? NO_FEATURES }));
}

/**
 * Your own password. The current one goes with it: the cookie proves the
 * session, not the person sitting in front of it.
 */
export function changePassword(currentPassword: string, newPassword: string) {
  return api<{ success: boolean }>("/auth/password", {
    method: "POST",
    body: { currentPassword, newPassword },
  });
}

export function logout() {
  return api<{ success: boolean }>("/auth/logout", { method: "POST" });
}

export function isSuperAdmin(session: Session | null) {
  return session?.role === "superadmin";
}

/** May manage departments, members and other admins. */
export function isAdmin(session: Session | null) {
  return session?.role === "superadmin" || session?.role === "admin";
}

/** Runs at least one department, whatever their standing across the workspace. */
export function isHead(session: Session | null) {
  return (session?.departments ?? []).some((membership) => membership.role === "head");
}

/**
 * Who gets the whole picture: a manager sees every ticket in the workspace, a
 * head sees every ticket their departments have been asked to do. The server
 * decides which of the two applies - this only decides whether to offer it.
 */
/** The departments this person runs, which is the whole scope of a head. */
export function headDepartments(session: Session | null) {
  return (session?.departments ?? []).filter((membership) => membership.role === "head");
}

export function canSeeAllTickets(session: Session | null) {
  return isAdmin(session) || isHead(session);
}

export const ROLE_LABEL: Record<Role, string> = {
  superadmin: "Super Admin",
  admin: "Admin",
  user: "Member",
};

/** Head-ish accounts wear the brand tone, everyone else reads as team. */
export function avatarTone(user: {
  role?: Role;
  departments?: Membership[];
} | null): "head" | "team" {
  if (!user) return "team";
  if (user.role === "superadmin") return "head";
  return user.departments?.some((item) => item.role === "head") ? "head" : "team";
}

export function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}
