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
import { ApiError, api, compilePdf, errorMessage, withProfile } from "@/ui/api";
import { Banner } from "@/ui/Banner";
import { Button, buttonClass } from "@/ui/Button";
import { Field, TextArea } from "@/ui/Field";
import { useChatContext } from "@/ui/chat/ChatProvider";
import { useProfile } from "@/ui/ProfileProvider";
import { loadApplication, saveApplication, saveApplicationOnExit } from "./application-saver";
import { LayoutControls } from "./LayoutControls";
import { PdfPreview } from "./PdfPreview";
import { SectionReview } from "./SectionReview";
import { SkillsReview } from "./SkillsReview";

type Props = { applicationId: string };
type Preview = { url: string; pages: number };
type Problem = { message: string; log?: string };

const SAVE_DELAY_MS = 800;

export function ReviewScreen({ applicationId }: Props) {
  const { profile, loading, error: profileError } = useProfile();
  if (loading) return <p className="text-ink-soft">Loading…</p>;
  if (profileError) {
    return (
      <Banner tone="error" title="Profiles failed to load">
        {profileError}
      </Banner>
    );
  }
  if (!profile) return <Banner tone="info" title="No profile selected" />;
  // Keyed so switching profile (or application) remounts with fresh state, without setState inside an effect.
  return <ProfileReview key={`${profile}/${applicationId}`} profile={profile} applicationId={applicationId} />;
}

function ProfileReview({ profile, applicationId }: { profile: string; applicationId: string }) {
  const [application, setApplication] = useState<Application | null>(null);
  const [bank, setBank] = useState<Bank | null>(null);
  const [resume, setResume] = useState<ResumeState | null>(null);
  // The snapshot last written to disk. Edit helpers return new objects, so reference inequality means unsaved changes.
  const [saved, setSaved] = useState<ResumeState | null>(null);
  const [pendingSaves, setPendingSaves] = useState(0);
  const [compiling, setCompiling] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const previewUrl = useRef<string | null>(null);
  const latest = useRef<ResumeState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = resume !== saved;
  const saving = pendingSaves > 0;
  const { register: registerChat } = useChatContext();

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadApplication(profile, applicationId), api.get<Bank>(withProfile("/api/bank", profile))])
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
        if (!cancelled) setProblem({ message: errorMessage(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [profile, applicationId]);

  useEffect(
    () => () => {
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    },
    [],
  );

  const save = useCallback(
    async (state: ResumeState): Promise<void> => {
      setPendingSaves((n) => n + 1);
      try {
        setApplication(await saveApplication(profile, applicationId, state));
        setSaved(state); // the snapshot that was written, so edits made while saving stay dirty
        setSaveError(null);
      } finally {
        setPendingSaves((n) => n - 1);
      }
    },
    [profile, applicationId],
  );

  const cancelTimer = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const saveLatest = useCallback(() => {
    cancelTimer();
    if (latest.current) save(latest.current).catch((err) => setSaveError(errorMessage(err)));
  }, [cancelTimer, save]);

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
      timer.current = setTimeout(saveLatest, SAVE_DELAY_MS);
    },
    [cancelTimer, saveLatest],
  );

  useEffect(() => {
    const onPageHide = () => {
      if (!timer.current || !latest.current) return;
      cancelTimer();
      saveApplicationOnExit(profile, applicationId, latest.current);
    };
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      // Unmount (dashboard link, profile switch): save now rather than drop the edit.
      if (timer.current && latest.current) {
        const state = latest.current;
        cancelTimer();
        void saveApplication(profile, applicationId, state).catch(() => undefined);
      }
    };
  }, [profile, applicationId, cancelTimer]);

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

  async function onCompile() {
    if (!resume) return;
    setCompiling(true);
    setProblem(null);
    try {
      cancelTimer();
      if (dirty) await save(resume);
      const { blob, pages } = await compilePdf(profile, resume, applicationId);
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
      const url = URL.createObjectURL(blob);
      previewUrl.current = url;
      setPreview({ url, pages });
    } catch (err) {
      const log = err instanceof ApiError && typeof err.details === "string" ? err.details : undefined;
      setProblem({ message: errorMessage(err), log });
    } finally {
      setCompiling(false);
    }
  }

  /** The current layout becomes the profile default; this resume then follows the default instead of its own copy. */
  async function saveDefaultLayout() {
    if (!bank || !resume) return;
    try {
      // Re-read the bank first so a stale copy here cannot overwrite edits made elsewhere.
      const fresh = await api.get<Bank>(withProfile("/api/bank", profile));
      const layout = resolveLayout(resume.layout, bank.layout);
      setBank(await api.send<Bank>(withProfile("/api/bank", profile), "PUT", { ...fresh, layout }));
      change((s) => edit.setLayout(s, undefined));
    } catch (err) {
      setSaveError(errorMessage(err));
    }
  }

  if (problem && !application) {
    return (
      <Banner tone="error" title="Could not load this application">
        {problem.message}
      </Banner>
    );
  }
  if (!application || !bank || !resume) return <p className="text-ink-soft">Loading application…</p>;

  const filename = `${slugify(application.company)}-resume.pdf`;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <aside className="grid content-start gap-4 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:self-start lg:overflow-auto">
        <div>
          <Link href="/" className="text-xs text-ink-faint hover:text-ink">
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
          <Button variant="primary" onClick={() => void onCompile()} disabled={compiling || saving}>
            {compiling ? "Compiling…" : "Compile PDF"}
          </Button>
          <Button onClick={saveLatest} disabled={!dirty || saving || compiling}>
            {saving ? "Saving…" : dirty ? "Save now" : "Saved"}
          </Button>
          {preview && (
            <a href={preview.url} download={filename} className={buttonClass({ variant: "secondary" })}>
              Download PDF
            </a>
          )}
          <span className="ml-auto text-xs text-ink-faint">{dirty ? "Unsaved changes" : ""}</span>
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

        {preview && <PdfPreview url={preview.url} pages={preview.pages} />}

        <section aria-labelledby="review-summary">
          <h2 id="review-summary" className="mb-3 border-b border-ink pb-1 text-2xl">
            Summary
          </h2>
          <Field label="Summary paragraph">
            <TextArea
              rows={4}
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
