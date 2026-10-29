"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Application } from "@/applications/schema";
import type { Me } from "@/billing/policy";
import { MODEL_IDS, MODEL_LABELS, type ModelId, modelName } from "@/tailor/model";
import { api, errorMessage } from "@/ui/api";
import { Banner } from "@/ui/Banner";
import { Button } from "@/ui/Button";
import { Field, Select, TextArea, TextInput } from "@/ui/Field";
import { useMe } from "@/ui/useMe";

type Mode = "ai" | "manual";

function formatElapsed(totalSeconds: number): string {
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

/** "" leaves the choice to the server, which uses the plan's model. */
type ModelChoiceValue = ModelId | "";

/** Plans that may pick a model get a picker defaulting to the plan's model; the others are told what they run on. */
function ModelChoice({
  me,
  model,
  onChange,
}: {
  me: Me | null;
  model: ModelChoiceValue;
  onChange: (model: ModelChoiceValue) => void;
}) {
  if (!me) return null;
  if (!me.policy.picksModel) {
    return <p className="text-sm text-ink-soft">Tailoring runs on {modelName(me.policy.model)}</p>;
  }
  return (
    <Field label="Model">
      <Select value={model} onChange={(e) => onChange(e.target.value as ModelChoiceValue)}>
        <option value="">Default: {modelName(me.policy.model)}</option>
        {MODEL_IDS.map((id) => (
          <option key={id} value={id}>
            {MODEL_LABELS[id]}
          </option>
        ))}
      </Select>
    </Field>
  );
}

export function TailorForm() {
  const router = useRouter();
  const { me } = useMe();
  const [company, setCompany] = useState("");
  const [roleTitle, setRoleTitle] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [model, setModel] = useState<ModelChoiceValue>("");
  const [busy, setBusy] = useState<Mode | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(false);
  const inFlight = useRef(false);
  const errorRef = useRef<HTMLDivElement>(null);

  const ready = company.trim().length > 0 && jobDescription.trim().length > 0 && busy === null;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Measure from a start timestamp rather than counting ticks: background tabs throttle timers.
  useEffect(() => {
    if (busy !== "ai") return;
    const startedAt = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(id);
  }, [busy]);

  // The banner only exists after the render that sets `error`, so focus it from an effect.
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  async function start(mode: Mode) {
    // The ref catches a second click in the same tick, before `busy` has re-rendered.
    if (inFlight.current || busy !== null) return;
    inFlight.current = true;
    setBusy(mode);
    setElapsed(0);
    setError(null);
    try {
      const { application } =
        mode === "ai"
          ? await api.send<{ application: Application }>("/api/tailor", "POST", {
              company,
              roleTitle,
              jobDescription,
              model: model || undefined,
            })
          : await api.send<{ application: Application }>("/api/applications", "POST", { company, roleTitle, jobDescription });
      // The AI call can take a minute; don't pull the user back if they left the page meanwhile.
      if (mounted.current) router.push(`/tailor/${application.id}`);
    } catch (err) {
      if (mounted.current) {
        setError(errorMessage(err));
        setBusy(null);
      }
    } finally {
      inFlight.current = false;
    }
  }

  return (
    <section aria-labelledby="tailor-heading">
      <h1 id="tailor-heading" className="text-4xl tracking-tight">
        Tailor to a job
      </h1>
      <p className="mt-2 max-w-2xl text-sm text-ink-soft">
        Paste the job description. Claude reads your whole bank, picks the bullets that fit, lightly rewords them, and you
        review every change before anything is compiled.
      </p>

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="rounded-lg border border-rule bg-card p-5 shadow-card">
          <fieldset disabled={busy !== null} className="contents">
            <Field label="Job description">
              <TextArea
                rows={22}
                value={jobDescription}
                onChange={(e) => setJobDescription(e.target.value)}
                placeholder="Paste the full posting here, requirements and all."
                className="font-mono text-[13px]"
              />
            </Field>
          </fieldset>
        </div>

        <div className="grid gap-4 self-start rounded-lg border border-rule bg-card p-5 shadow-card lg:sticky lg:top-20">
          {/* Buttons stay outside the fieldset so the clicked one keeps focus and full contrast while busy. */}
          <fieldset disabled={busy !== null} className="contents">
            <Field label="Company">
              <TextInput required value={company} onChange={(e) => setCompany(e.target.value)} placeholder="e.g. Acme Corp" />
            </Field>
            <Field label="Role title (optional)">
              <TextInput value={roleTitle} onChange={(e) => setRoleTitle(e.target.value)} placeholder="e.g. Backend Engineer" />
            </Field>
            <ModelChoice me={me} model={model} onChange={setModel} />
          </fieldset>

          {error && (
            <Banner ref={errorRef} tabIndex={-1} tone="error" title="Could not start">
              {error}
            </Banner>
          )}

          <div className="mt-2 grid gap-2">
            <Button variant="primary" disabled={busy !== "ai" && !ready} aria-disabled={busy !== null} onClick={() => void start("ai")}>
              {busy === "ai" ? "Asking Claude…" : "Tailor with Claude"}
            </Button>
            <Button variant="ghost" disabled={busy !== "manual" && !ready} aria-disabled={busy !== null} onClick={() => void start("manual")}>
              {busy === "manual" ? "Creating…" : "Start from full bank (no AI)"}
            </Button>
            {busy !== null && (
              <p role="status" className="flex items-center gap-2 text-sm text-ink-soft">
                <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-accent motion-safe:animate-pulse" />
                {busy === "ai" ? (
                  <span>
                    Claude is reading your bank…{" "}
                    {/* aria-hidden so the live region doesn't re-announce every second */}
                    <span aria-hidden="true" className="tabular-nums">
                      {formatElapsed(elapsed)}
                    </span>
                    . Usually 30-90 s.
                  </span>
                ) : (
                  <span>Creating…</span>
                )}
              </p>
            )}
            {!ready && busy === null && <p className="text-xs text-ink-faint">Add a company and a job description to start.</p>}
          </div>
          <p className="text-xs text-ink-faint">
            The no-AI option loads every bullet so you can prune by hand. Useful before your API key is set up.
          </p>
        </div>
      </div>
    </section>
  );
}
