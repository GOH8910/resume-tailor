"use client";

import { useState } from "react";
import type { AdminSummary } from "@/admin/summary";
import { api, errorMessage } from "@/ui/api";
import { Banner } from "@/ui/Banner";
import { Button } from "@/ui/Button";
import { formatGbp } from "./format";

function stateOf({ budget }: AdminSummary): { label: string; tone: "ok" | "warn"; detail: string | null } {
  if (!budget.paused) return { label: "Running", tone: "ok", detail: null };
  if (budget.reason === "manual") return { label: "Paused by you", tone: "warn", detail: "Free accounts get no AI calls until you resume." };
  if (!budget.resumesAt) return { label: "Paused", tone: "warn", detail: "The daily budget is £0, so free usage stays paused." };
  const at = new Date(budget.resumesAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return { label: "Paused: budget spent", tone: "warn", detail: `Resumes at ${at} (midnight UTC).` };
}

const TONES = { ok: "bg-ok-soft text-ok", warn: "bg-warn-soft text-warn" };

/** Whether free accounts can use AI right now, today's spend against the budget, and the operator's switch. */
export function FreeUsageCard({ summary, onChanged }: { summary: AdminSummary; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const state = stateOf(summary);
  const { budget, manualPause } = summary;

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      await api.send("/api/admin/pause", "POST", { paused: !manualPause });
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="free-usage-heading" className="rounded-lg border border-rule bg-card p-5 shadow-card">
      <h2 id="free-usage-heading" className="text-2xl tracking-tight">
        Free usage
      </h2>
      <div role="status" className="mt-3">
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${TONES[state.tone]}`}>{state.label}</span>
        {state.detail && <p className="mt-2 text-sm text-ink-soft">{state.detail}</p>}
      </div>
      <p className="mt-4 text-sm">
        <span className="font-serif text-3xl tabular-nums">{formatGbp(budget.spentGbp)}</span>
        <span className="text-ink-soft"> of {formatGbp(budget.limitGbp)} budget spent today</span>
      </p>
      {budget.limitGbp > 0 && (
        <progress
          aria-label="Today's free spend against the budget"
          value={Math.min(budget.spentGbp, budget.limitGbp)}
          max={budget.limitGbp}
          className="mt-2 h-2 w-full appearance-none overflow-hidden rounded-full bg-paper-deep [&::-moz-progress-bar]:bg-accent [&::-webkit-progress-bar]:bg-paper-deep [&::-webkit-progress-value]:bg-accent"
        />
      )}
      {error && (
        <div className="mt-3">
          <Banner tone="error" title="Could not change free usage">
            {error}
          </Banner>
        </div>
      )}
      <div className="mt-4 grid gap-1.5">
        <Button variant={manualPause ? "primary" : "secondary"} disabled={busy} onClick={() => void toggle()}>
          {manualPause ? "Resume free usage" : "Pause free usage"}
        </Button>
        <p className="text-xs text-ink-faint">Unlimited accounts are never paused.</p>
      </div>
    </section>
  );
}
