"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { fetchSession, logout as logoutRequest, type Session } from "@/lib/auth";

type AuthValue = {
  session: Session | null;
  /** false until /auth/me has answered, so guards don't redirect too early */
  ready: boolean;
  setSession: (session: Session | null) => void;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  // The session cookie is httpOnly, so the only way to know who is signed in
  // is to ask the API. A 401 here simply means "signed out".
  useEffect(() => {
    const controller = new AbortController();

    fetchSession(controller.signal)
      .then(setSession)
      .catch(() => setSession(null))
      .finally(() => {
        if (!controller.signal.aborted) setReady(true);
      });

    return () => controller.abort();
  }, []);

  const refresh = useCallback(async () => {
    try {
      setSession(await fetchSession());
    } catch {
      setSession(null);
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await logoutRequest();
    } finally {
      setSession(null);
      router.push("/login");
    }
  }, [router]);

  const value = useMemo(
    () => ({ session, ready, setSession, refresh, signOut }),
    [session, ready, refresh, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside <AuthProvider>");
  return context;
}
