"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Bank, SectionKey } from "@/bank/schema";
import { api, errorMessage, withProfile } from "@/ui/api";
import { Banner } from "@/ui/Banner";
import { useProfile } from "@/ui/ProfileProvider";
import { EntryEditor } from "./EntryEditor";
import { ProfileForm } from "./ProfileForm";
import { SkillsEditor } from "./SkillsEditor";

export const BANK_SECTIONS = ["profile", "experience", "projects", "education", "skills"] as const;
export type BankSection = (typeof BANK_SECTIONS)[number];

const LABELS: Record<BankSection, string> = {
  profile: "Profile",
  experience: "Experience",
  projects: "Projects",
  education: "Education",
  skills: "Skills",
};

type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";
const SAVE_DELAY_MS = 800;

export function BankEditor({ section }: { section: BankSection }) {
  const { profile, loading, error: profileError } = useProfile();
  if (loading) return <p className="text-ink-soft">Loading…</p>;
  if (profileError) {
    return (
      <Banner tone="error" title="Profiles failed to load">
        {profileError}
      </Banner>
    );
  }
  if (!profile) {
    return (
      <Banner tone="info" title="No profile yet">
        Create one with the “+ New” button in the top bar.
      </Banner>
    );
  }
  // Keyed by profile so switching profiles remounts with fresh state (no setState inside an effect).
  return <ProfileBankEditor key={profile} profile={profile} section={section} />;
}

function ProfileBankEditor({ profile, section }: { profile: string; section: BankSection }) {
  const [bank, setBank] = useState<Bank | null>(null);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<Bank | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<Bank>(withProfile("/api/bank", profile))
      .then((loaded) => {
        if (cancelled) return;
        latest.current = loaded;
        setBank(loaded);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [profile]);

  const save = useCallback(async () => {
    if (!latest.current) return;
    setStatus("saving");
    try {
      await api.send(withProfile("/api/bank", profile), "PUT", latest.current);
      setStatus("saved");
      setError(null);
    } catch (err) {
      setStatus("error");
      setError(errorMessage(err));
    }
  }, [profile]);

  const update = useCallback(
    (fn: (bank: Bank) => Bank) => {
      setBank((prev) => {
        if (!prev) return prev;
        const next = fn(prev);
        latest.current = next;
        return next;
      });
      setStatus("dirty");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void save(), SAVE_DELAY_MS);
    },
    [save],
  );

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <section aria-labelledby="bank-heading">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-ink-faint">{profile} · bank</p>
          <h1 id="bank-heading" className="mt-1 text-4xl tracking-tight">
            {LABELS[section]}
          </h1>
        </div>
        <SaveIndicator status={status} />
      </div>

      <nav aria-label="Bank sections" className="mt-6 flex flex-wrap gap-1 border-b border-rule">
        {BANK_SECTIONS.map((s) => (
          <Link
            key={s}
            href={`/bank/${s}`}
            className={`-mb-px border-b-2 px-3 py-2 text-sm transition-colors ${
              s === section ? "border-accent text-ink" : "border-transparent text-ink-soft hover:text-ink"
            }`}
          >
            {LABELS[s]}
          </Link>
        ))}
      </nav>

      {error && (
        <div className="mt-4">
          <Banner tone="error" title="Problem with the bank">
            {error}
          </Banner>
        </div>
      )}
      {!bank && !error && <p className="mt-6 text-ink-soft">Loading bank…</p>}

      {bank && (
        <div className="mt-6">
          {section === "profile" && <ProfileForm bank={bank} onChange={update} />}
          {section === "skills" && (
            <SkillsEditor skills={bank.skills} onChange={(skills) => update((b) => ({ ...b, skills }))} />
          )}
          {(section === "experience" || section === "projects" || section === "education") && (
            <EntryEditor
              section={section as SectionKey}
              entries={bank[section as SectionKey]}
              onChange={(entries) => update((b) => ({ ...b, [section]: entries }))}
            />
          )}
        </div>
      )}
    </section>
  );
}

function SaveIndicator({ status }: { status: SaveStatus }) {
  const text: Record<SaveStatus, string> = {
    idle: "",
    dirty: "Unsaved changes",
    saving: "Saving…",
    saved: "Saved",
    error: "Save failed",
  };
  const tone = status === "saved" ? "text-ok" : status === "error" ? "text-danger" : "text-ink-faint";
  return (
    <span role="status" className={`text-sm ${tone}`}>
      {text[status]}
    </span>
  );
}
