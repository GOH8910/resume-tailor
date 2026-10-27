"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Application } from "@/applications/schema";
import { DEFAULT_MODEL_ID, MODEL_IDS, MODEL_LABELS, type ModelId } from "@/tailor/model";
import { api, errorMessage, withProfile } from "@/ui/api";
import { Banner } from "@/ui/Banner";
import { Button } from "@/ui/Button";
import { Field, Select, TextArea, TextInput } from "@/ui/Field";
import { useProfile } from "@/ui/ProfileProvider";

type Mode = "ai" | "manual";

export function TailorForm() {
  const router = useRouter();
  const { profile, loading, error: profileError } = useProfile();
  const [company, setCompany] = useState("");
  const [roleTitle, setRoleTitle] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [model, setModel] = useState<ModelId>(DEFAULT_MODEL_ID);
  const [busy, setBusy] = useState<Mode | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ready = Boolean(profile) && company.trim().length > 0 && jobDescription.trim().length > 0 && busy === null;

  async function start(mode: Mode) {
    if (!profile) return;
    setBusy(mode);
    setError(null);
    try {
      const { application } =
        mode === "ai"
          ? await api.send<{ application: Application }>("/api/tailor", "POST", { profile, company, roleTitle, jobDescription, model })
          : await api.send<{ application: Application }>(withProfile("/api/applications", profile), "POST", { company, roleTitle, jobDescription });
      router.push(`/tailor/${application.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(null);
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
  if (!profile) {
    return (
      <Banner tone="info" title="No profile yet">
        Create one with the “New profile” button in the top bar, then fill in your bank.
      </Banner>
    );
  }

  return (
    <section aria-labelledby="tailor-heading">
      <p className="text-xs font-semibold uppercase tracking-widest text-ink-faint">{profile}</p>
      <h1 id="tailor-heading" className="mt-1 text-4xl tracking-tight">
        Tailor to a job
      </h1>
      <p className="mt-2 max-w-2xl text-sm text-ink-soft">
        Paste the job description. Claude reads your whole bank, picks the bullets that fit, lightly rewords them, and you
        review every change before anything is compiled.
      </p>

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="rounded-lg border border-rule bg-card p-5 shadow-card">
          <Field label="Job description">
            <TextArea
              rows={22}
              value={jobDescription}
              onChange={(e) => setJobDescription(e.target.value)}
              placeholder="Paste the full posting here, requirements and all."
              className="font-mono text-[13px]"
            />
          </Field>
        </div>

        <div className="grid content-start gap-4 rounded-lg border border-rule bg-card p-5 shadow-card">
          <Field label="Company">
            <TextInput value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Acme Corp" />
          </Field>
          <Field label="Role title (optional)">
            <TextInput value={roleTitle} onChange={(e) => setRoleTitle(e.target.value)} placeholder="Backend Engineer" />
          </Field>
          <Field label="Model">
            <Select value={model} onChange={(e) => setModel(e.target.value as ModelId)}>
              {MODEL_IDS.map((id) => (
                <option key={id} value={id}>
                  {MODEL_LABELS[id]}
                </option>
              ))}
            </Select>
          </Field>

          {error && (
            <Banner tone="error" title="Could not start">
              {error}
            </Banner>
          )}

          <div className="mt-2 grid gap-2">
            <Button variant="primary" disabled={!ready} onClick={() => void start("ai")}>
              {busy === "ai" ? "Asking Claude… this can take a minute" : "Tailor with Claude"}
            </Button>
            <Button variant="ghost" disabled={!ready} onClick={() => void start("manual")}>
              {busy === "manual" ? "Creating…" : "Start from full bank (no AI)"}
            </Button>
          </div>
          <p className="text-xs text-ink-faint">
            The no-AI option loads every bullet so you can prune by hand. Useful before your API key is set up.
          </p>
        </div>
      </div>
    </section>
  );
}
