"use client";

import { useCallback, useEffect, useState } from "react";
import type { AdminSummary } from "@/admin/summary";
import { api, errorMessage } from "@/ui/api";
import { Banner } from "@/ui/Banner";
import { Button } from "@/ui/Button";
import { FreeUsageCard } from "./FreeUsageCard";
import { SetPlanForm } from "./SetPlanForm";
import { UsageCard } from "./UsageCard";

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-xs text-ink-soft">{label}</dt>
      <dd className="font-serif text-3xl tabular-nums">{value}</dd>
    </div>
  );
}

function ActivityCard({ summary }: { summary: AdminSummary }) {
  return (
    <section aria-labelledby="activity-heading" className="rounded-lg border border-rule bg-card p-5 shadow-card">
      <h2 id="activity-heading" className="text-2xl tracking-tight">
        Credits and ads today
      </h2>
      <dl className="mt-3 grid grid-cols-2 gap-3">
        <Stat label="Credits granted" value={summary.credits.grantedToday} />
        <Stat label="Credits spent" value={summary.credits.spentToday} />
      </dl>
      <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-rule pt-4">
        <Stat label="Ads started" value={summary.ads.startedToday} />
        <Stat label="Granted" value={summary.ads.grantedToday} />
        <Stat label="Rejected" value={summary.ads.rejectedToday} />
      </dl>
      <p className="mt-3 text-xs text-ink-faint">Spent is net of refunds for failed calls.</p>
    </section>
  );
}

/** The operator's page: what the AI has cost, the free-usage switch, and plan changes. */
export function AdminPage() {
  const [summary, setSummary] = useState<AdminSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let cancelled = false;
    api.get<AdminSummary>("/api/admin/summary").then(
      (loaded) => {
        if (cancelled) return;
        setSummary(loaded);
        setLoadedAt(new Date());
        setError(null);
      },
      (err: unknown) => {
        if (!cancelled) setError(errorMessage(err));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [version]);

  return (
    <section aria-labelledby="admin-heading">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 id="admin-heading" className="text-4xl tracking-tight">
            Admin
          </h1>
          <p className="mt-2 text-sm text-ink-soft">
            Days and months run in UTC, like the budget and the ad caps.
            {loadedAt && ` Figures as of ${loadedAt.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}.`}
          </p>
        </div>
        <Button variant="secondary" onClick={reload}>
          Refresh
        </Button>
      </div>

      {error && (
        <div className="mt-6">
          <Banner tone="error" title="Could not load the figures">
            {error}
          </Banner>
        </div>
      )}

      {summary && (
        <>
          <div className="mt-8 grid gap-6 lg:grid-cols-3">
            <FreeUsageCard summary={summary} onChanged={reload} />
            <ActivityCard summary={summary} />
            <SetPlanForm />
          </div>
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <UsageCard title="Today" usage={summary.today} />
            <UsageCard title="This month" usage={summary.month} />
          </div>
        </>
      )}
    </section>
  );
}
