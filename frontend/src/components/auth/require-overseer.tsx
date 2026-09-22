"use client";

import { RequireAuth } from "@/components/auth/require-auth";
import { canSeeAllTickets } from "@/lib/auth";

/**
 * Gate for the views that oversee rather than take part: an admin across the
 * workspace, a head across their own departments.
 *
 * It exists as its own client component because the rule is a function, and a
 * function cannot be handed from a server component to a client one. Stating
 * it here keeps the page a plain server component with its own metadata.
 */
export function RequireOverseer({ children }: { children: React.ReactNode }) {
  return <RequireAuth allow={canSeeAllTickets}>{children}</RequireAuth>;
}
