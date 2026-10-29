"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Application } from "@/applications/schema";
import type { Me } from "@/billing/policy";
import { MAX_CHARS } from "@/lib/input-caps";
import { MODEL_IDS, MODEL_LABELS, type ModelId, modelName } from "@/tailor/model";
import { type CreditProblem, creditProblem, creditsLabel } from "@/ui/ads/messages";
import { RewardedAdButton } from "@/ui/ads/RewardedAdButton";
import { api, errorMessage, retryAfterOf } from "@/ui/api";
import { Banner } from "@/ui/Banner";
import { Button, buttonClass } from "@/ui/Button";
import { useCountdown } from "@/ui/countdown";
import { Field, Select, TextArea, TextInput } from "@/ui/Field";
import { useMe } from "@/ui/useMe";

type Mode = "ai" | "manual";

/**
 * What the block under the Tailor button will hold once the account has loaded: the cost and the ad button, the cost
 * and a note that ads are not available, or nothing (self-hosted, unlimited, free tailoring).
 */
export type CostLine = "ad" | "note" | "none";

/**
 * Why the last start failed. `short` keeps the server's numbers and is shown until the balance covers the cost;
 * `limited` (a 429) is shown, and holds back the button that hit it, until its countdown ends.
 */
type Notice =
  | { kind: "error"; text: string }
  | { kind: "paused"; text: string }
  | { kind: "short"; credits: number; needed: number }
  | { kind: "limited"; mode: Mode; seconds: number };

function formatElapsed(totalSeconds: number): string {
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

function noticeFor(err: unknown, problem: CreditProblem | null, mode: Mode): Notice {
  const wait = retryAfterOf(err);
  if (wait !== null) return { kind: "limited", mode, seconds: wait };
  if (problem?.kind === "short") return { kind: "short", credits: problem.credits, needed: problem.needed };
  if (problem?.kind === "paused") return { kind: "paused", text: problem.message };
  return { kind: "error", text: errorMessage(err) };
}

/** "" leaves the choice to the server, which uses the plan's model. */
type ModelChoiceValue = ModelId | "";

type Started = { application: Application; credits?: number };

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

/** An invisible stand-in the size of the cost block, so the buttons below it do not jump when it appears. */
function CostLinePlaceholder({ costLine }: { costLine: Exclude<CostLine, "none"> }) {
  return (
    <div aria-hidden="true" className="invisible grid gap-2">
      <p className="text-xs">&nbsp;</p>
      {costLine === "ad" ? (
        <span className={buttonClass({ variant: "secondary" })}>&nbsp;</span>
      ) : (
        <p className="text-xs">&nbsp;</p>
      )}
    </div>
  );
}

export function TailorForm({ costLine }: { costLine: CostLine }) {
  const router = useRouter();
  const { me, refresh, setCredits } = useMe();
  const [company, setCompany] = useState("");
  const [roleTitle, setRoleTitle] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [model, setModel] = useState<ModelChoiceValue>("");
  const [busy, setBusy] = useState<Mode | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [notice, setNotice] = useState<Notice | null>(null);
  const countdown = useCountdown();
  const mounted = useRef(false);
  const inFlight = useRef(false);
  const noticeRef = useRef<HTMLDivElement>(null);

  const ready = company.trim().length > 0 && jobDescription.trim().length > 0 && busy === null;
  const chargesCredits = me?.policy.chargesCredits ?? false;
  const cost = me?.creditsPerTailor ?? 0;
  const credits = me?.credits ?? 0;
  const short = chargesCredits && credits < cost;
  const limitedMode = notice?.kind === "limited" && countdown.secondsLeft > 0 ? notice.mode : null;

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

  // The banner only exists after the render that sets `notice`, so focus it from an effect.
  useEffect(() => {
    if (notice) noticeRef.current?.focus();
  }, [notice]);

  async function start(mode: Mode) {
    // The ref catches a second click in the same tick, before `busy` has re-rendered.
    if (inFlight.current || busy !== null) return;
    inFlight.current = true;
    setBusy(mode);
    setElapsed(0);
    setNotice(null);
    try {
      const { application, credits: balance } =
        mode === "ai"
          ? await api.send<Started>("/api/tailor", "POST", {
              company,
              roleTitle,
              jobDescription,
              model: model || undefined,
            })
          : await api.send<Started>("/api/applications", "POST", { company, roleTitle, jobDescription });
      // The balance after the charge, for the top bar, which outlives this page.
      if (balance !== undefined) setCredits(balance);
      // The AI call can take a minute; don't pull the user back if they left the page meanwhile.
      if (mounted.current) router.push(`/tailor/${application.id}`);
    } catch (err) {
      const problem = creditProblem(err);
      // The server's balance is the truth: another tab may have spent credits since this page loaded.
      if (problem?.kind === "short") setCredits(problem.credits);
      // Without the account there is no balance to correct: load it.
      if (problem && me === null) refresh();
      if (mounted.current) {
        const next = noticeFor(err, problem, mode);
        if (next.kind === "limited") countdown.start(next.seconds);
        setNotice(next);
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
                maxLength={MAX_CHARS.jobDescription}
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
              <TextInput
                required
                maxLength={MAX_CHARS.company}
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder="e.g. Acme Corp"
              />
            </Field>
            <Field label="Role title (optional)">
              <TextInput
                maxLength={MAX_CHARS.roleTitle}
                value={roleTitle}
                onChange={(e) => setRoleTitle(e.target.value)}
                placeholder="e.g. Backend Engineer"
              />
            </Field>
            <ModelChoice me={me} model={model} onChange={setModel} />
          </fieldset>

          {notice?.kind === "error" && (
            <Banner ref={noticeRef} tabIndex={-1} tone="error" title="Could not start">
              {notice.text}
            </Banner>
          )}
          {notice?.kind === "paused" && (
            <Banner ref={noticeRef} tabIndex={-1} tone="warn">
              {notice.text}
            </Banner>
          )}
          {notice?.kind === "limited" && limitedMode !== null && (
            <Banner ref={noticeRef} tabIndex={-1} tone="warn">
              {/* Screen readers hear the first figure once; the ticking one is for sighted users. */}
              <span className="sr-only">Too many requests, try again in {notice.seconds} seconds.</span>
              <span aria-hidden="true">
                Too many requests, try again in <span className="tabular-nums">{countdown.secondsLeft}</span> s
              </span>
            </Banner>
          )}
          {notice?.kind === "short" && !(me && me.credits >= notice.needed) && (
            <Banner ref={noticeRef} tabIndex={-1} tone="warn" title="Not enough credits">
              {/* The live balance: an ad watched since the refusal raises it. */}
              Tailoring costs {creditsLabel(notice.needed)} and you have {me?.credits ?? notice.credits}.
            </Banner>
          )}

          <div className="mt-2 grid gap-2">
            <Button
              variant="primary"
              // Disabled until the account has loaded: until then the cost and the balance are unknown.
              disabled={busy !== "ai" && (!ready || short || me === null || limitedMode === "ai")}
              aria-disabled={busy !== null}
              onClick={() => void start("ai")}
            >
              {busy === "ai" ? "Asking Claude…" : "Tailor with Claude"}
            </Button>
            {me === null && costLine !== "none" && <CostLinePlaceholder costLine={costLine} />}
            {chargesCredits && cost > 0 && (
              <div className="grid gap-2">
                <p className={`text-xs ${short ? "text-warn" : "text-ink-faint"}`}>
                  Costs {creditsLabel(cost)} · you have {credits}
                </p>
                <RewardedAdButton />
              </div>
            )}
            <Button
              variant="ghost"
              disabled={busy !== "manual" && (!ready || limitedMode === "manual")}
              aria-disabled={busy !== null}
              onClick={() => void start("manual")}
            >
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
