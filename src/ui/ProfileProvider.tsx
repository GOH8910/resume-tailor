"use client";

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, errorMessage } from "./api";

type ProfileContextValue = {
  profile: string | null;
  profiles: string[];
  loading: boolean;
  error: string | null;
  setProfile: (slug: string) => void;
  createProfile: (slug: string, name: string) => Promise<void>;
};

const STORAGE_KEY = "resume-tailor:profile";
const ProfileContext = createContext<ProfileContextValue | null>(null);

function readStoredProfile(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeProfile(slug: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, slug);
  } catch {
    // Storage can be unavailable (private mode); the selection just won't persist.
  }
}

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [profiles, setProfiles] = useState<string[]>([]);
  const [profile, setProfileState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ profiles: string[] }>("/api/profiles")
      .then(({ profiles }) => {
        if (cancelled) return;
        setProfiles(profiles);
        const stored = readStoredProfile();
        setProfileState(stored && profiles.includes(stored) ? stored : (profiles[0] ?? null));
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setProfile = useCallback((slug: string) => {
    setProfileState(slug);
    storeProfile(slug);
  }, []);

  const createProfile = useCallback(
    async (slug: string, name: string) => {
      await api.send("/api/profiles", "POST", { slug, name });
      setProfiles((prev) => [...prev, slug].sort());
      setProfile(slug);
    },
    [setProfile],
  );

  const value = useMemo(
    () => ({ profile, profiles, loading, error, setProfile, createProfile }),
    [profile, profiles, loading, error, setProfile, createProfile],
  );

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile(): ProfileContextValue {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error("useProfile must be used inside ProfileProvider");
  return ctx;
}
