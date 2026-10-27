"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import * as edit from "@/applications/edit";
import { slugify } from "@/applications/ids";
import type { Application, ResumeState } from "@/applications/schema";
import { type Bank, SECTION_KEYS } from "@/bank/schema";
import { ApiError, api, compilePdf, errorMessage, withProfile } from "@/ui/api";
import { Banner } from "@/ui/Banner";
import { Button, buttonClass } from "@/ui/Button";
import { Field, TextArea } from "@/ui/Field";
import { useProfile } from "@/ui/ProfileProvider";
import { PdfPreview } from "./PdfPreview";
import { SectionReview } from "./SectionReview";
import { SkillsReview } from "./SkillsReview";

type Props = { applicationId: string };
type Preview = { url: string; pages: number };
type Problem = { message: string; log?: string };

export function ReviewScreen({ applicationId }: Props) {
  const { profile, loading, error: profileError } = useProfile();
  const [application, setApplication] = useState<Application | null>(null);
  const [bank, setBank] = useState<Bank | null>(null);
  const [resume, setResume] = useState<ResumeState | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [compiling, setCompiling] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const previewUrl = useRef<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    Promise.all([
      api.get<{ application: Application }>(withProfile(`/api/applications/${applicationId}`, profile)),
      api.get<Bank>(withProfile("/api/bank", profile)),
    ])
      .then(([{ application: loaded }, loadedBank]) => {
        if (cancelled) return;
        setApplication(loaded);
        setBank(loadedBank);
        // Entries deleted from the bank since tailoring are dropped so reordering stays predictable.
        setResume(edit.pruneMissing(loaded.resume, loadedBank));
        setDirty(false);
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

  const change = useCallback((fn: (state: ResumeState) => ResumeState) => {
    setResume((prev) => {
      if (!prev) return prev;
      const next = fn(prev);
      // The edit helpers return the same reference for no-op edits, so only real changes mark the state dirty.
      if (next !== prev) setDirty(true);
      return next;
    });
  }, []);

  async function save(state: ResumeState): Promise<void> {
    if (!profile) return;
    setSaving(true);
    try {
      const { application: saved } = await api.send<{ application: Application }>(
        withProfile(`/api/applications/${applicationId}`, profile),
        "PUT",
        { resume: state },
      );
      setApplication(saved);
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }

  async function onSave() {
    if (!resume) return;
    setProblem(null);
    try {
      await save(resume);
    } catch (err) {
      setProblem({ message: errorMessage(err) });
    }
  }

  async function onCompile() {
    if (!profile || !resume) return;
    setCompiling(true);
    setProblem(null);
    try {
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

  if (loading) return <p className="text-ink-soft">Loading…</p>;
  if (profileError) {
    return (
      <Banner tone="error" title="Profiles failed to load">
        {profileError}
      </Banner>
    );
  }
  if (!profile) return <Banner tone="info" title="No profile selected" />;
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
    <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
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
        <div className="rounded-lg border border-rule bg-card p-4 shadow-card">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-soft">Job description</p>
          <pre className="whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-ink-soft">{application.jobDescription}</pre>
        </div>
      </aside>

      <div className="grid content-start gap-6">
        <div className="sticky top-16 z-[5] -mx-1 flex flex-wrap items-center gap-2 rounded-lg border border-rule bg-paper/95 px-3 py-2 shadow-card backdrop-blur">
          <Button variant="primary" onClick={() => void onCompile()} disabled={compiling || saving}>
            {compiling ? "Compiling…" : "Compile PDF"}
          </Button>
          <Button onClick={() => void onSave()} disabled={!dirty || saving || compiling}>
            {saving ? "Saving…" : dirty ? "Save" : "Saved"}
          </Button>
          {preview && (
            <a href={preview.url} download={filename} className={buttonClass({ variant: "secondary" })}>
              Download PDF
            </a>
          )}
          <span className="ml-auto text-xs text-ink-faint">{dirty ? "Unsaved changes" : ""}</span>
        </div>

        {problem && (
          <Banner tone="error" title={problem.message}>
            {problem.log && (
              <details className="mt-1">
                <summary className="cursor-pointer text-xs">LaTeX log</summary>
                <pre className="mt-1 max-h-72 overflow-auto rounded bg-ink p-2 font-mono text-[11px] text-paper">{problem.log}</pre>
              </details>
            )}
          </Banner>
        )}

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
