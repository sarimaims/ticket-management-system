import { api } from "./api";
import { cached, forget } from "./cache";

/** A unit that moved or vanished changes both lists. */
const dropLists = () => {
  forget("departments:");
  forget("units:");
};
import type { Department } from "./departments";

/** The level above a department. Departments are created inside one. */
export type Unit = {
  id: string;
  name: string;
  code: string;
  description: string;
  isActive: boolean;
  departmentCount: number;
  memberCount: number;
  createdAt: string;
};

export type UnitOption = Pick<Unit, "id" | "name" | "code">;

/** The units you may inspect: yours, or all of them if you are an admin. */
export function listUnits(signal?: AbortSignal) {
  return api<{ units: Unit[] }>("/units", { signal }).then(
    (data) => data.units,
  );
}

/** Names only - what a department can be filed under. */
export function listUnitOptions(signal?: AbortSignal) {
  return cached(
    "units:options",
    () =>
      api<{ units: UnitOption[] }>("/units/options").then((data) => data.units),
    signal,
  );
}

export function getUnit(id: string, signal?: AbortSignal) {
  return api<{ unit: Unit; departments: Department[] }>(`/units/${id}`, {
    signal,
  });
}

export function createUnit(input: { name: string; description?: string }) {
  return api<{ unit: Unit }>("/units", { method: "POST", body: input })
    .then((data) => data.unit)
    .finally(dropLists);
}

export function updateUnit(
  id: string,
  input: { name?: string; description?: string },
) {
  return api<{ unit: Unit }>(`/units/${id}`, { method: "PATCH", body: input })
    .then((data) => data.unit)
    .finally(dropLists);
}

export function deleteUnit(id: string) {
  return api<{ success: boolean }>(`/units/${id}`, {
    method: "DELETE",
  }).finally(() => {
    forget("departments:");
    forget("units:");
  });
}
