"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import * as edit from "@/applications/edit";
import { slugify } from "@/applications/ids";
import type { Application, ResumeState } from "@/applications/schema";
import { type Bank, SECTION_KEYS } from "@/bank/schema";
import { applyResumeChanges } from "@/chat/apply-resume";
import type { ResumeChange } from "@/chat/schema";
import { resolveLayout } from "@/latex/layout";
import { MAX_CHARS } from "@/lib/input-caps";
import { api, errorMessage } from "@/ui/api";
import { Banner } from "@/ui/Banner";
import { Button, buttonClass } from "@/ui/Button";
import { Field, TextArea } from "@/ui/Field";
import { useChatContext } from "@/ui/chat/ChatProvider";
import { useCountdown } from "@/ui/countdown";
import { nextSaveDelay, saveRateLimitWait } from "@/ui/save-backoff";
import { SavingAgain } from "@/ui/SavingAgain";
import { loadApplication, saveApplication, saveApplicationOnExit } from "./application-saver";
import { LayoutControls } from "./LayoutControls";
import { PdfPreview } from "./PdfPreview";
import { SectionReview } from "./SectionReview";
import { SkillsReview } from "./SkillsReview";
import { usePdfCompiler } from "./use-pdf-compiler";

type Props = { applicationId: string };

const SAVE_DELAY_MS = 800;

export function ReviewScreen({ applicationId }: Props) {
  // Keyed so switching application remounts with fresh state, without setState inside an effect.
  return <ApplicationReview key={applicationId} applicationId={applicationId} />;
}

function ApplicationReview({ applicationId }: Props) {
  const [application, setApplication] = useState<Application | null>(null);
  const [bank, setBank] = useState<Bank | null>(null);
  const [resume, setResume] = useState<ResumeState | null>(null);
  // The snapshot last written to disk. Edit helpers return new objects, so reference inequality means unsaved changes.
  const [saved, setSaved] = useState<ResumeState | null>(null);
  const [pendingSaves, setPendingSaves] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const { preview, compiling, problem, compile } = usePdfCompiler(applicationId);
  const latest = useRef<ResumeState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // When a rate-limited save may run again; edits made before then wait for it too.
  const retryAt = useRef<number | null>(null);
  const mounted = useRef(false);
  const saveLatestRef = useRef<() => void>(() => {});
  const { secondsLeft, start: startCountdown } = useCountdown();
  const dirty = resume !== saved;
  const saving = pendingSaves > 0;
  const { register: registerChat } = useChatContext();

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadApplication(applicationId), api.get<Bank>("/api/bank")])
      .then(([loaded, loadedBank]) => {
        if (cancelled) return;
        // Entries deleted from the bank since tailoring are dropped so reordering stays predictable.
        const pruned = edit.pruneMissing(loaded.resume, loadedBank);
        latest.current = pruned;
        setApplication(loaded);
        setBank(loadedBank);
        setResume(pruned);
        setSaved(pruned);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [applicationId]);

  // The PDF follows what is on disk: the first load and every autosave compile that snapshot.
  useEffect(() => {
    if (saved) compile(saved);
  }, [saved, compile]);

  const save = useCallback(
    async (state: ResumeState): Promise<void> => {
      setPendingSaves((n) => n + 1);
      try {
        setApplication(await saveApplication(applicationId, state));
        retryAt.current = null;
        setSaved(state); // the snapshot that was written, so edits made while saving stay dirty
        setSaveError(null);
      } finally {
        setPendingSaves((n) => n - 1);
      }
    },
    [applicationId],
  );

  const cancelTimer = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const saveLatest = useCallback(() => {
    cancelTimer();
    if (!latest.current) return;
    save(latest.current).catch((err) => {
      const wait = saveRateLimitWait(err);
      if (wait === null) {
        setSaveError(errorMessage(err));
        return;
      }
      // The edits stay unsaved (dirty): the latest state is saved once the server's wait is over, unless the
      // screen has gone.
      retryAt.current = Date.now() + wait * 1000;
      if (!mounted.current) return;
      startCountdown(wait);
      cancelTimer();
      timer.current = setTimeout(() => saveLatestRef.current(), wait * 1000);
    });
  }, [cancelTimer, save, startCountdown]);
  useEffect(() => {
    saveLatestRef.current = saveLatest;
  }, [saveLatest]);

  const change = useCallback(
    (fn: (state: ResumeState) => ResumeState) => {
      const prev = latest.current;
      if (!prev) return;
      const next = fn(prev);
      // The edit helpers return the same reference for no-op edits, so only real changes are saved.
      if (next === prev) return;
      latest.current = next; // computed outside the updater: no side effect inside setState
      setResume(next);
      cancelTimer();
      timer.current = setTimeout(saveLatest, nextSaveDelay(Date.now(), retryAt.current, SAVE_DELAY_MS));
    },
    [cancelTimer, saveLatest],
  );

  useEffect(() => {
    const onPageHide = () => {
      if (!timer.current || !latest.current) return;
      cancelTimer();
      saveApplicationOnExit(applicationId, latest.current);
    };
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      // Unmount (dashboard link, another application): save now rather than drop the edit.
      if (timer.current && latest.current) {
        const state = latest.current;
        cancelTimer();
        void saveApplication(applicationId, state).catch(() => undefined);
      }
    };
  }, [applicationId, cancelTimer]);

  // Chat drawer hooks: flush pending edits before Claude reads the resume; apply its changes through `change`.
  const flush = useCallback(async () => {
    if (!timer.current || !latest.current) return;
    cancelTimer();
    await save(latest.current);
  }, [cancelTimer, save]);
  const applyChat = useCallback(
    (changes: ResumeChange[], updatedBank: Bank) => {
      setBank(updatedBank);
      const current = latest.current;
      if (!current) return { applied: [], warnings: [] };
      const result = applyResumeChanges(current, updatedBank, changes);
      change(() => result.state);
      return { applied: result.applied, warnings: result.warnings };
    },
    [change],
  );
  const company = application?.company;
  useEffect(() => {
    if (!company) return;
    return registerChat({ label: `Resume · ${company}`, applicationId, getResume: () => latest.current, applyResumeChanges: applyChat, flush });
  }, [registerChat, company, applicationId, applyChat, flush]);

  /** Manual retry: unsaved edits are saved first, and that save's snapshot triggers the compile. */
  function recompile() {
    if (dirty) saveLatest();
    else if (saved) compile(saved);
  }

  /** The current layout becomes the bank default; this resume then follows the default instead of its own copy. */
  async function saveDefaultLayout() {
    if (!bank || !resume) return;
    try {
      // Re-read the bank first so a stale copy here cannot overwrite edits made elsewhere.
      const fresh = await api.get<Bank>("/api/bank");
      const layout = resolveLayout(resume.layout, bank.layout);
      setBank(await api.send<Bank>("/api/bank", "PUT", { ...fresh, layout }));
      change((s) => edit.setLayout(s, undefined));
    } catch (err) {
      setSaveError(errorMessage(err));
    }
  }

  if (loadError) {
    return (
      <Banner tone="error" title="Could not load this application">
        {loadError}
      </Banner>
    );
  }
  if (!application || !bank || !resume) return <p className="text-ink-soft">Loading application…</p>;

  const filename = `${slugify(application.company)}-resume.pdf`;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <aside className="grid content-start gap-4 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:self-start lg:overflow-auto">
        <div>
          <Link href="/dashboard" className="text-xs text-ink-faint hover:text-ink">
            ← Dashboard
          </Link>
          <h1 className="mt-1 text-3xl leading-tight">{application.company}</h1>
          {application.roleTitle && <p className="text-ink-soft">{application.roleTitle}</p>}
          <p className="mt-1 text-xs text-ink-faint">
            {new Date(application.createdAt).toLocaleString()} · {application.model}
          </p>
        </div>
        {application.notes && (
          <Banner tone="info" title="Claude's notes">
            {application.notes}
          </Banner>
        )}
        {application.warnings.length > 0 && (
          <Banner tone="warn" title="Adjusted after validation">
            <ul className="list-disc pl-4">
              {application.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </Banner>
        )}
        <div className="max-h-64 overflow-auto rounded-lg border border-rule bg-card p-4 shadow-card lg:max-h-none lg:overflow-visible">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-soft">Job description</p>
          <pre className="whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-ink-soft">{application.jobDescription}</pre>
        </div>
      </aside>

      <div className="grid grid-cols-1 content-start gap-6">
        <div className="-mx-1 flex flex-wrap items-center gap-2 rounded-lg border border-rule bg-paper/95 px-3 py-2 shadow-card backdrop-blur lg:sticky lg:top-16 lg:z-[5]">
          {preview && (
            <a href={preview.url} download={filename} className={buttonClass({ variant: "primary" })}>
              Download PDF
            </a>
          )}
          <Button onClick={recompile} disabled={compiling || saving}>
            Recompile
          </Button>
          <Button onClick={saveLatest} disabled={!dirty || saving}>
            {saving ? "Saving…" : dirty ? "Save now" : "Saved"}
          </Button>
          <span className="ml-auto text-xs text-ink-faint" role="status">
            {secondsLeft > 0 ? <SavingAgain secondsLeft={secondsLeft} /> : compiling ? "Compiling…" : dirty ? "Unsaved changes" : ""}
          </span>
        </div>

        {saveError && (
          <Banner tone="error" title="Could not save your changes">
            <p>{saveError}</p>
            <p>Your edits are still on this page. Use Save now to try again.</p>
          </Banner>
        )}

        {problem && (
          <Banner tone="error" title={problem.message}>
            {problem.log && <LatexLog log={problem.log} />}
          </Banner>
        )}

        <LayoutControls
          layout={resolveLayout(resume.layout, bank.layout)}
          customised={resume.layout !== undefined}
          onChange={(layout) => change((s) => edit.setLayout(s, layout))}
          onReset={() => change((s) => edit.setLayout(s, undefined))}
          onSaveDefault={saveDefaultLayout}
        />

        {preview ? (
          <PdfPreview url={preview.url} pages={preview.pages} compiling={compiling} />
        ) : (
          !problem && (
            <p className="text-sm text-ink-faint" role="status">
              Compiling the PDF…
            </p>
          )
        )}

        <section aria-labelledby="review-summary">
          <h2 id="review-summary" className="mb-3 border-b border-ink pb-1 text-2xl">
            Summary
          </h2>
          <Field label="Summary paragraph">
            <TextArea
              rows={4}
              maxLength={MAX_CHARS.summary}
              value={resume.summary}
              onChange={(e) => {
                const summary = e.target.value;
                change((s) => edit.setSummary(s, summary));
              }}
            />
          </Field>
        </section>

        {SECTION_KEYS.map((section) => (
          <SectionReview key={section} section={section} bank={bank} resume={resume} onChange={change} />
        ))}

        <SkillsReview bank={bank} skills={resume.skills} onChange={(skills) => change((s) => edit.setSkills(s, skills))} />
      </div>
    </div>
  );
}

/** The error is at the end of a LaTeX log, so the panel opens scrolled to the bottom. */
function LatexLog({ log }: { log: string }) {
  const pre = useRef<HTMLPreElement>(null);
  return (
    <details
      className="mt-1"
      onToggle={(e) => {
        if (e.currentTarget.open && pre.current) pre.current.scrollTop = pre.current.scrollHeight;
      }}
    >
      <summary className="cursor-pointer text-xs">LaTeX log</summary>
      <pre ref={pre} className="mt-1 max-h-72 overflow-auto rounded bg-ink p-2 font-mono text-[11px] text-paper">
        {log}
      </pre>
    </details>
  );
}
