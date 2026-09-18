"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import type { Membership } from "@/lib/auth";

const STORAGE_KEY = "flowdesk.activeDepartment";

type ActiveDepartmentValue = {
  /** null means "all of my departments". */
  active: Membership | null;
  departments: Membership[];
  setActive: (id: string | null) => void;
};

const ActiveDepartmentContext = createContext<ActiveDepartmentValue | null>(null);

/**
 * Which of their departments the user is currently working in. It only ever
 * narrows what they see - it never grants access, so the server still decides
 * what is visible.
 */
export function ActiveDepartmentProvider({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  const departments = useMemo(() => session?.departments ?? [], [session]);
  const [activeId, setActiveId] = useState<string | null>(null);

  // Restore the last choice, but only if they are still in that department.
  useEffect(() => {
    if (departments.length === 0) {
      setActiveId(null);
      return;
    }
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      setActiveId(stored && departments.some((item) => item.id === stored) ? stored : null);
    } catch {
      setActiveId(null);
    }
  }, [departments]);

  const setActive = useCallback((id: string | null) => {
    setActiveId(id);
    try {
      if (id) window.localStorage.setItem(STORAGE_KEY, id);
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* storage unavailable - the choice just will not persist */
    }
  }, []);

  const value = useMemo(
    () => ({
      active: departments.find((item) => item.id === activeId) ?? null,
      departments,
      setActive,
    }),
    [departments, activeId, setActive],
  );

  return (
    <ActiveDepartmentContext.Provider value={value}>{children}</ActiveDepartmentContext.Provider>
  );
}

export function useActiveDepartment() {
  const context = useContext(ActiveDepartmentContext);
  if (!context) {
    throw new Error("useActiveDepartment must be used inside <ActiveDepartmentProvider>");
  }
  return context;
}
