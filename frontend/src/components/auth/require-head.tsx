"use client";

import { RequireAuth } from "@/components/auth/require-auth";
import { DirectorySkeleton } from "@/components/ui/directory-skeleton";
import { isHead } from "@/lib/auth";

/**
 * Gate for a head's own pages.
 *
 * Narrower than {@link RequireOverseer} on purpose: an admin is not a head of
 * anything - managers hold no departments at all - and has the whole directory
 * under /admin/users instead. This is the view of one team by the person who
 * runs it.
 *
 * It exists as its own client component because the rule is a function, and a
 * function cannot be handed from a server component to a client one.
 */
export function RequireHead({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth allow={isHead} fallback={<DirectorySkeleton columns={6} />}>
      {children}
    </RequireAuth>
  );
}
