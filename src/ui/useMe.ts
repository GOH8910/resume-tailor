"use client";

import { useCallback, useEffect, useState } from "react";
import type { Me } from "@/billing/policy";
import { api, errorMessage } from "@/ui/api";

/** The signed-in account and what its plan allows, loaded on mount. `refresh` reloads it, e.g. after credits change. */
export function useMe(): { me: Me | null; error: string | null; refresh: () => void } {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api.get<Me>("/api/me").then(
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
  return { me, error, refresh };
}
