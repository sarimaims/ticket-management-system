"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import {
  fetchSession,
  logout as logoutRequest,
  NO_FEATURES,
  type Features,
  type Session,
} from "@/lib/auth";

type AuthValue = {
  session: Session | null;
  /** What this deployment can do, e.g. whether chat attachments are storable. */
  features: Features;
  /** false until /auth/me has answered, so guards don't redirect too early */
  ready: boolean;
  setSession: (session: Session | null) => void;
  /** Signing in answers with both halves, so both are set together. */
  setAuth: (answer: { user: Session; features: Features }) => void;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [features, setFeatures] = useState<Features>(NO_FEATURES);
  const [ready, setReady] = useState(false);

  // The session cookie is httpOnly, so the only way to know who is signed in
  // is to ask the API. A 401 here simply means "signed out".
  useEffect(() => {
    const controller = new AbortController();

    fetchSession(controller.signal)
      .then((answer) => {
        setSession(answer.user);
        setFeatures(answer.features);
      })
      .catch(() => setSession(null))
      .finally(() => {
        if (!controller.signal.aborted) setReady(true);
      });

    return () => controller.abort();
  }, []);

  const setAuth = useCallback((answer: { user: Session; features: Features }) => {
    setSession(answer.user);
    setFeatures(answer.features);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const answer = await fetchSession();
      setSession(answer.user);
      setFeatures(answer.features);
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
    () => ({ session, features, ready, setSession, setAuth, refresh, signOut }),
    [session, features, ready, setAuth, refresh, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside <AuthProvider>");
  return context;
}
