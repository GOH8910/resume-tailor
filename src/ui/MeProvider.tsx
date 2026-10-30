"use client";

import { createContext, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Me } from "@/billing/policy";
import { api, errorMessage } from "./api";

export type MeState = {
  me: Me | null;
  error: string | null;
  /** Reloads the account, e.g. after a call that spent credits. */
  refresh: () => void;
  /** Takes a balance the server just reported, without another round trip. */
  setCredits: (credits: number) => void;
};

export const MeContext = createContext<MeState | null>(null);

/** Loads `GET /api/me` once for the signed-in app, so the top bar, the tailor form and the chat share one balance. */
export function MeProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  // Strict Mode runs effects twice in development; reusing the request keeps it to one per load.
  const request = useRef<{ version: number; promise: Promise<Me> } | null>(null);

  useEffect(() => {
    if (request.current?.version !== version) request.current = { version, promise: api.get<Me>("/api/me") };
    let cancelled = false;
    request.current.promise.then(
      (loaded) => {
        if (cancelled) return;
        setMe(loaded);
        setError(null);
      },
      (err: unknown) => {
        if (!cancelled) setError(errorMessage(err));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [version]);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  const setCredits = useCallback((credits: number) => setMe((current) => (current ? { ...current, credits } : current)), []);
  const value = useMemo(() => ({ me, error, refresh, setCredits }), [me, error, refresh, setCredits]);
  return <MeContext.Provider value={value}>{children}</MeContext.Provider>;
}
