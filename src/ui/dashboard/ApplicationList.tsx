"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { ApplicationSummary } from "@/applications/schema";
import { api, errorMessage } from "@/ui/api";
import { Banner } from "@/ui/Banner";
import { Button, buttonClass } from "@/ui/Button";

export function ApplicationList() {
  const [apps, setApps] = useState<ApplicationSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const deleteButtons = useRef(new Map<string, HTMLButtonElement>());
  const refocusId = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ applications: ApplicationSummary[] }>("/api/applications")
      .then(({ applications }) => {
        if (!cancelled) setApps(applications);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The Delete button is unmounted while confirming, so focus returns to it after the next render.
  useEffect(() => {
    if (confirmId !== null || refocusId.current === null) return;
    deleteButtons.current.get(refocusId.current)?.focus();
    refocusId.current = null;
  }, [confirmId]);

  function cancelConfirm(id: string) {
    refocusId.current = id;
    setConfirmId(null);
  }

  async function remove(id: string) {
    try {
      await api.send(`/api/applications/${id}`, "DELETE");
      setApps((prev) => prev?.filter((a) => a.id !== id) ?? null);
      setConfirmId(null);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <section aria-labelledby="dash-heading">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 id="dash-heading" className="text-4xl tracking-tight">
          Tailored resumes
        </h1>
        <Link href="/tailor" className={buttonClass({ variant: "primary" })}>
          New tailored resume
        </Link>
      </div>

      {error && (
        <div className="mt-6">
          <Banner tone="error" title="Something went wrong">
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

      {apps && apps.length > 0 && (
        <ul className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {apps.map((app) => (
            <li
              key={app.id}
              className="rounded-lg border border-rule bg-card p-5 shadow-card transition-transform duration-150 motion-safe:hover:-translate-y-0.5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="break-words text-2xl leading-tight">{app.company}</h2>
                  {app.roleTitle && <p className="text-sm text-ink-soft">{app.roleTitle}</p>}
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    app.hasPdf ? "bg-ok-soft text-ok" : "bg-paper-deep text-ink-soft"
                  }`}
                >
                  {app.hasPdf ? "PDF ready" : "No PDF"}
                </span>
              </div>
              <p className="mt-3 text-xs text-ink-faint">
                {new Date(app.createdAt).toLocaleString()} · {app.model}
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Link href={`/tailor/${app.id}`} className={buttonClass({ variant: "secondary", size: "sm" })}>
                  Open
                </Link>
                {app.hasPdf && (
                  <a
                    href={`/api/applications/${app.id}/pdf`}
                    download={`${app.id}.pdf`}
                    className={buttonClass({ variant: "ghost", size: "sm" })}
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
                    <Button size="sm" variant="ghost" autoFocus onClick={() => cancelConfirm(app.id)}>
                      Cancel
                    </Button>
                  </>
                ) : (
                  <Button
                    ref={(el) => {
                      if (el) deleteButtons.current.set(app.id, el);
                      else deleteButtons.current.delete(app.id);
                    }}
                    size="sm"
                    variant="ghost"
                    aria-label={`Delete ${app.company}`}
                    onClick={() => setConfirmId(app.id)}
                  >
                    Delete
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
