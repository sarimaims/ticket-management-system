"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/components/auth/auth-provider";
import { homeFor } from "@/lib/auth";

/**
 * The app's root sends each person to their own start: the super admin to the
 * escalations waiting on them, everyone else to the dashboard. Decided here in
 * the browser, because who is signed in is only known once the session has
 * been asked for.
 */
export default function Home() {
  const { session, ready } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!ready) return;
    router.replace(session ? homeFor(session) : "/login");
  }, [ready, session, router]);

  return null;
}
