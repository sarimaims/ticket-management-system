import { api } from "./api";
import type { Role } from "./auth";

export type ActivityEntry = {
  id: string;
  department: { id: string; name: string } | null;
  actor: { name: string; role: Role };
  action: string;
  summary: string;
  ticketNumber: string;
  createdAt: string;
};

/** The API decides the scope: your departments, or all of them for a manager. */
export function listActivity(
  filters: { departments?: string[]; limit?: number } = {},
  signal?: AbortSignal,
) {
  const query = new URLSearchParams();
  // Several ids ride as one comma-separated value; none means "no narrowing".
  if (filters.departments?.length) query.set("department", filters.departments.join(","));
  if (filters.limit) query.set("limit", String(filters.limit));
  const suffix = query.toString() ? `?${query}` : "";

  return api<{ activity: ActivityEntry[] }>(`/activity${suffix}`, { signal }).then(
    (data) => data.activity,
  );
}

/** Managers only. Omit the department to clear every log. */
export function clearActivity(department?: string) {
  const suffix = department ? `?department=${department}` : "";
  return api<{ cleared: number }>(`/activity${suffix}`, { method: "DELETE" });
}
