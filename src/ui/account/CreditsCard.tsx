"use client";

import { useEffect, useState } from "react";
import type { Me } from "@/billing/policy";
import { creditsLabel } from "@/ui/ads/messages";
import { api, errorMessage } from "@/ui/api";
import { Banner } from "@/ui/Banner";
import { type LedgerEvent, ledgerLabel, signedCredits } from "./ledger";

type Ledger = { credits: number; events: LedgerEvent[] };

const LEDGER_ROWS = 50;
const DATE_FORMAT: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" };

/** The balance, what things cost, and the latest ledger rows. Shown only to accounts that pay in credits. */
export function CreditsCard({ me }: { me: Me }) {
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reloaded whenever the balance moves (an ad watched in the chat, say), so the list always explains the number.
  useEffect(() => {
    let cancelled = false;
    api.get<Ledger>("/api/account/credits").then(
      (loaded) => {
        if (cancelled) return;
        setLedger(loaded);
        setError(null);
      },
      (err: unknown) => {
        if (!cancelled) setError(errorMessage(err));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [me.credits]);

  return (
    <section aria-labelledby="credits-heading" className="self-start rounded-lg border border-rule bg-card p-5 shadow-card">
      <h2 id="credits-heading" className="text-2xl tracking-tight">
        Credits
      </h2>
      <p className="mt-3 flex items-baseline gap-2">
        <span className="font-serif text-5xl leading-none tabular-nums">{me.credits}</span>
        <span className="text-sm text-ink-soft">{me.credits === 1 ? "credit" : "credits"} left</span>
      </p>
      <p className="mt-3 text-sm text-ink-soft">
        A tailored resume costs {creditsLabel(me.creditsPerTailor)} and a chat message {creditsLabel(me.creditsPerChatMessage)}.{" "}
        {me.adsAvailable
          ? "Watch an ad from the Tailor page or the chat to earn one more."
          : "Ads to earn more aren't available yet."}
      </p>

      <h3 className="mt-6 font-sans text-xs font-semibold uppercase tracking-wide text-ink-soft">Recent activity</h3>
      {error && (
        <div className="mt-2">
          <Banner tone="error" title="Could not load your credit history">
            {error}
          </Banner>
        </div>
      )}
      {ledger && ledger.events.length === 0 && <p className="mt-2 text-sm text-ink-faint">No credit activity yet.</p>}
      {ledger && ledger.events.length > 0 && <LedgerTable events={ledger.events} />}
      {ledger && ledger.events.length >= LEDGER_ROWS && (
        <p className="mt-2 text-xs text-ink-faint">The last {LEDGER_ROWS} entries. Download your data for the full history.</p>
      )}
    </section>
  );
}

function LedgerTable({ events }: { events: LedgerEvent[] }) {
  return (
    <table className="mt-2 w-full text-sm">
      <caption className="sr-only">Credit activity, newest first</caption>
      <thead>
        <tr className="border-b border-rule text-left text-xs text-ink-faint">
          <th scope="col" className="py-1.5 pr-3 font-medium">
            When
          </th>
          <th scope="col" className="py-1.5 pr-3 font-medium">
            Activity
          </th>
          <th scope="col" className="py-1.5 text-right font-medium">
            Credits
          </th>
        </tr>
      </thead>
      <tbody>
        {events.map((event, index) => (
          <tr key={`${event.createdAt}-${index}`} className="border-b border-rule/60 last:border-0">
            <td className="whitespace-nowrap py-2 pr-3 text-ink-soft tabular-nums">
              {new Date(event.createdAt).toLocaleString(undefined, DATE_FORMAT)}
            </td>
            <td className="py-2 pr-3">{ledgerLabel(event.kind)}</td>
            <td className={`whitespace-nowrap py-2 text-right font-medium tabular-nums ${event.amount > 0 ? "text-ok" : "text-ink"}`}>
              {signedCredits(event.amount)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
