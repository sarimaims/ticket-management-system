"use client";

import { RequireAuth } from "@/components/auth/require-auth";
import { isSuperAdmin } from "@/lib/auth";

/**
 * Gate for the super admin's own views. A client component for the same
 * reason as RequireOverseer: the rule is a function, and a server page cannot
 * hand one to a client one.
 */
export function RequireSuperAdmin({ children }: { children: React.ReactNode }) {
  return <RequireAuth allow={isSuperAdmin}>{children}</RequireAuth>;
}
