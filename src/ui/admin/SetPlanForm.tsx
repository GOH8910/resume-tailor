"use client";

import { type FormEvent, useState } from "react";
import type { Plan } from "@/billing/plan";
import { api, errorMessage } from "@/ui/api";
import { Banner } from "@/ui/Banner";
import { Button } from "@/ui/Button";
import { Field, Select, TextInput } from "@/ui/Field";

const PLAN_NAMES: Record<Plan, string> = { free: "Free", unlimited: "Unlimited" };

type Result = { kind: "ok"; text: string } | { kind: "error"; text: string };

/** Moves an existing account to another plan (ADMIN_EMAILS only picks one when an account is first used). */
export function SetPlanForm() {
  const [email, setEmail] = useState("");
  const [plan, setPlan] = useState<Plan>("unlimited");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const saved = await api.send<{ email: string; plan: Plan }>("/api/admin/plan", "POST", { email, plan });
      setResult({ kind: "ok", text: `${saved.email} is now on the ${PLAN_NAMES[saved.plan]} plan.` });
    } catch (err) {
      setResult({ kind: "error", text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      aria-labelledby="set-plan-heading"
      onSubmit={(event) => void submit(event)}
      className="grid content-start gap-4 rounded-lg border border-rule bg-card p-5 shadow-card"
    >
      <div>
        <h2 id="set-plan-heading" className="text-2xl tracking-tight">
          Set a plan
        </h2>
        <p className="mt-1 text-sm text-ink-soft">For an account that already exists. Takes effect on its next request.</p>
      </div>
      <Field label="Account email">
        <TextInput type="email" required autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="Plan">
        <Select value={plan} onChange={(e) => setPlan(e.target.value as Plan)}>
          <option value="free">{PLAN_NAMES.free}</option>
          <option value="unlimited">{PLAN_NAMES.unlimited}</option>
        </Select>
      </Field>
      {result && (
        <Banner tone={result.kind === "ok" ? "ok" : "error"} title={result.kind === "error" ? "Could not set the plan" : undefined}>
          {result.text}
        </Banner>
      )}
      <div>
        <Button type="submit" variant="secondary" disabled={busy}>
          {busy ? "Saving…" : "Set plan"}
        </Button>
      </div>
    </form>
  );
}
