"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { type Bank, SECTION_LABELS, type SectionKey } from "@/bank/schema";
import { errorMessage } from "@/ui/api";
import { Banner } from "@/ui/Banner";
import { Button, FOCUS_RING } from "@/ui/Button";
import { useChatContext } from "@/ui/chat/ChatProvider";
import { useCountdown } from "@/ui/countdown";
import { nextSaveDelay, saveRateLimitWait } from "@/ui/save-backoff";
import { SavingAgain } from "@/ui/SavingAgain";
import { loadBank, saveBank, saveBankOnExit } from "./bank-saver";
import { EntryEditor } from "./EntryEditor";
import { ProfileForm } from "./ProfileForm";
import { SkillsEditor } from "./SkillsEditor";

export const BANK_SECTIONS = ["profile", "experience", "projects", "education", "skills"] as const;
export type BankSection = (typeof BANK_SECTIONS)[number];

const LABELS: Record<BankSection, string> = { profile: "Profile", skills: "Skills", ...SECTION_LABELS };

/** `waiting`: the server refused a save for now (429); the edits stay unsaved and are saved again after its wait. */
type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "error" | "waiting";
const SAVE_DELAY_MS = 800;

export function BankEditor({ section }: { section: BankSection }) {
  const [bank, setBank] = useState<Bank | null>(null);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<Bank | null>(null);
  // When a rate-limited save may run again; edits made before then wait for it too.
  const retryAt = useRef<number | null>(null);
  const mounted = useRef(false);
  const saveRef = useRef<() => Promise<void>>(async () => {});
  const { secondsLeft, start: startCountdown } = useCountdown();
  const tabs = useRef<HTMLElement>(null);
  const { register: registerChat } = useChatContext();

  // The tab strip scrolls sideways on narrow screens, and each section mounts fresh, so reveal the active tab.
  useEffect(() => {
    tabs.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [section]);

  useEffect(() => {
    let cancelled = false;
    loadBank()
      .then((loaded) => {
        if (cancelled) return;
        latest.current = loaded;
        setBank(loaded);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /** Saves the latest bank after `ms`, replacing any save already scheduled. */
  const schedule = useCallback((ms: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void saveRef.current();
    }, ms);
  }, []);

  const save = useCallback(async () => {
    const bank = latest.current;
    if (!bank) return;
    setStatus("saving");
    try {
      await saveBank(bank);
      retryAt.current = null;
      if (latest.current !== bank) return; // a newer edit supersedes this save; it reports its own status
      setStatus("saved");
      setSaveError(null);
    } catch (err) {
      const wait = saveRateLimitWait(err);
      if (wait !== null) {
        // The edits stay unsaved: the latest bank is saved once the server's wait is over, unless the editor has gone.
        retryAt.current = Date.now() + wait * 1000;
        if (!mounted.current) return;
        startCountdown(wait);
        setStatus("waiting");
        setSaveError(null);
        schedule(wait * 1000);
        return;
      }
      if (latest.current !== bank) return;
      setStatus("error");
      setSaveError(errorMessage(err));
    }
  }, [schedule, startCountdown]);
  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  const update = useCallback(
    (fn: (bank: Bank) => Bank) => {
      if (!latest.current) return;
      latest.current = fn(latest.current); // computed outside the updater: no side effect inside setState
      setBank(latest.current);
      const now = Date.now();
      setStatus(retryAt.current !== null && retryAt.current > now ? "waiting" : "dirty");
      schedule(nextSaveDelay(now, retryAt.current, SAVE_DELAY_MS));
    },
    [schedule],
  );

  // The chat drawer saves pending edits before Claude reads the bank, and re-reads it after Claude changes it.
  const flush = useCallback(async () => {
    if (!timer.current) return;
    clearTimeout(timer.current);
    timer.current = null;
    await save();
  }, [save]);
  const reloadBank = useCallback(async () => {
    const loaded = await loadBank();
    latest.current = loaded;
    setBank(loaded);
    setStatus("saved");
  }, []);
  useEffect(() => registerChat({ label: `Bank · ${LABELS[section]}`, flush, reloadBank }), [registerChat, section, flush, reloadBank]);

  useEffect(() => {
    const onPageHide = () => {
      if (!timer.current || !latest.current) return;
      clearTimeout(timer.current);
      timer.current = null;
      saveBankOnExit(latest.current);
    };
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      // Unmount (section tab, leaving /bank): save now rather than drop the edit.
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
        void save();
      }
    };
  }, [save]);

  return (
    <section aria-labelledby="bank-heading">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-ink-faint">Your bank</p>
          <h1 id="bank-heading" className="mt-1 text-4xl tracking-tight">
            {LABELS[section]}
          </h1>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3">
          {saveError && (
            <div role="alert" className="flex items-center gap-2 text-sm text-danger">
              <span>{saveError}</span>
              <Button size="sm" disabled={status === "saving"} onClick={() => void save()}>
                Retry
              </Button>
            </div>
          )}
          <SaveIndicator status={status} secondsLeft={secondsLeft} />
        </div>
      </div>

      <nav ref={tabs} aria-label="Bank sections" className="mt-6 flex flex-nowrap gap-1 overflow-x-auto whitespace-nowrap border-b border-rule">
        {BANK_SECTIONS.map((s) => (
          <Link
            key={s}
            href={`/bank/${s}`}
            aria-current={s === section ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm transition-colors ${FOCUS_RING} focus-visible:ring-inset ${
              s === section ? "border-accent text-ink" : "border-transparent text-ink-soft hover:text-ink"
            }`}
          >
            {LABELS[s]}
          </Link>
        ))}
      </nav>

      {loadError && (
        <div className="mt-4">
          <Banner tone="error" title="Problem with the bank">
            {loadError}
          </Banner>
        </div>
      )}
      {!bank && !loadError && <p className="mt-6 text-ink-soft">Loading bank…</p>}

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

function SaveIndicator({ status, secondsLeft }: { status: SaveStatus; secondsLeft: number }) {
  const text: Record<SaveStatus, string> = {
    idle: "",
    dirty: "Unsaved changes",
    saving: "Saving…",
    saved: "Saved",
    error: "Save failed",
    waiting: "Unsaved changes",
  };
  const tone = status === "saved" ? "text-ok" : status === "error" ? "text-danger" : "text-ink-faint";
  return (
    <span role="status" className={`text-sm ${tone}`}>
      {status === "waiting" && secondsLeft > 0 ? <SavingAgain secondsLeft={secondsLeft} /> : text[status]}
    </span>
  );
}
