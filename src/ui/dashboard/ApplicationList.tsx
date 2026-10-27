"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { ApplicationSummary } from "@/applications/schema";
import { api, errorMessage } from "@/ui/api";
import { Banner } from "@/ui/Banner";
import { Button } from "@/ui/Button";
import { useProfile } from "@/ui/ProfileProvider";

export function ApplicationList() {
  const { profile, loading } = useProfile();
  const [apps, setApps] = useState<ApplicationSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!profile) return;
    try {
      const { applications } = await api.get<{ applications: ApplicationSummary[] }>(`/api/applications?profile=${profile}`);
      setApps(applications);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [profile]);

  useEffect(() => {
    // load() only sets state after its fetch resolves; the rule can't see past the await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function remove(id: string) {
    try {
      await api.send(`/api/applications/${id}?profile=${profile}`, "DELETE");
      setConfirmId(null);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  if (loading) return <p className="text-ink-soft">Loading…</p>;
  if (!profile) {
    return (
      <Banner tone="info" title="No profile yet">
        Create one with the “+ New” button in the top bar, then fill in your bank.
      </Banner>
    );
  }

  return (
    <section aria-labelledby="dash-heading">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-ink-faint">{profile}</p>
          <h1 id="dash-heading" className="mt-1 text-4xl tracking-tight">
            Tailored resumes
          </h1>
        </div>
        <Link
          href="/tailor"
          className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-paper transition-colors hover:bg-accent"
        >
          New tailored resume
        </Link>
      </div>

      {error && (
        <div className="mt-6">
          <Banner tone="error" title="Could not load applications">
            {error}
          </Banner>
        </div>
      )}

      {apps && apps.length === 0 && (
        <div className="mt-10 rounded-lg border border-dashed border-rule bg-card/60 p-10 text-center">
          <p className="font-serif text-xl">Nothing tailored yet.</p>
          <p className="mt-2 text-sm text-ink-soft">
            Fill in your{" "}
            <Link href="/bank/experience" className="underline">
              bank
            </Link>
            , then paste a job description under{" "}
            <Link href="/tailor" className="underline">
              Tailor
            </Link>
            .
          </p>
        </div>
      )}

      <ul className="mt-8 grid gap-4 sm:grid-cols-2">
        {apps?.map((app) => (
          <li
            key={app.id}
            className="rounded-lg border border-rule bg-card p-5 shadow-card transition-transform duration-150 hover:-translate-y-0.5"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-2xl leading-tight">{app.company}</h2>
                {app.roleTitle && <p className="text-sm text-ink-soft">{app.roleTitle}</p>}
              </div>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                  app.hasPdf ? "bg-ok-soft text-ok" : "bg-paper-deep text-ink-faint"
                }`}
              >
                {app.hasPdf ? "PDF ready" : "No PDF"}
              </span>
            </div>
            <p className="mt-3 text-xs text-ink-faint">
              {new Date(app.createdAt).toLocaleString()} · {app.model}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Link
                href={`/tailor/${app.id}`}
                className="rounded-md border border-rule bg-card px-3 py-1.5 text-sm font-medium transition-colors hover:border-ink"
              >
                Open
              </Link>
              {app.hasPdf && (
                <a
                  href={`/api/applications/${app.id}/pdf?profile=${profile}`}
                  download={`${app.id}.pdf`}
                  className="rounded-md px-3 py-1.5 text-sm text-ink-soft transition-colors hover:bg-paper-deep hover:text-ink"
                >
                  Download PDF
                </a>
              )}
              <span className="ml-auto" />
              {confirmId === app.id ? (
                <>
                  <Button size="sm" variant="danger" onClick={() => void remove(app.id)}>
                    Confirm delete
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmId(null)}>
                    Cancel
                  </Button>
                </>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => setConfirmId(app.id)}>
                  Delete
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
