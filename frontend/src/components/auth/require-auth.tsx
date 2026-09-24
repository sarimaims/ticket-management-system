"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/components/auth/auth-provider";
import type { Role, Session } from "@/lib/auth";

function Splash() {
  return (
    <div className="grid min-h-screen place-items-center bg-canvas">
      <span className="size-6 animate-spin rounded-full border-2 border-line-strong border-t-brand-600" />
      <span className="sr-only">Loading</span>
    </div>
  );
}

/**
 * Client-side gate. The mock session lives in localStorage, so the check can
 * only run in the browser; once real cookie auth exists this moves to
 * middleware and the page renders already-authorised.
 */
export function RequireAuth({
  children,
  role,
  allow,
  fallback,
}: {
  children: React.ReactNode;
  /** when set, the session must carry one of these roles or it is bounced */
  role?: Role | Role[];
  /**
   * For rights that are not a workspace role. Running a department is held on
   * a membership, not on the account, so it cannot be spelled as a role.
   */
  allow?: (session: Session) => boolean;
  /**
   * What to show while the session is being checked. A page that knows its own
   * shape should pass it, so the wait looks like the page filling in rather
   * than a spinner where the page was.
   */
  fallback?: React.ReactNode;
}) {
  const { session, ready } = useAuth();
  const router = useRouter();

  const byRole = role === undefined || [role].flat().includes(session?.role as Role);
  const byRule = allow === undefined || (session !== null && allow(session));
  const permitted = byRole && byRule;
  const allowed = session !== null && permitted;

  useEffect(() => {
    if (!ready) return;
    if (!session) router.replace("/login");
    else if (!permitted) router.replace("/dashboard");
  }, [ready, session, permitted, router]);

  if (!ready || !allowed) return <>{fallback ?? <Splash />}</>;

  return <>{children}</>;
}
