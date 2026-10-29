"use client";

import Link from "next/link";
import type { Me } from "@/billing/policy";
import { modelName } from "@/tailor/model";
import { LINK_CLASS } from "@/ui/Button";
import { LEGAL_PAGES } from "@/ui/legal/legal-pages";
import { useMe } from "@/ui/useMe";
import { CreditsCard } from "./CreditsCard";
import { DataCard } from "./DataCard";
import { DeleteAccountCard } from "./DeleteAccountCard";

/** The plan as the account holder should read it: on a self-hosted server there are no plans in effect. */
function planOf(me: Me): { name: string; note: string } {
  if (me.mode === "selfhost") return { name: "Self-hosted", note: "No credits or limits on this server." };
  if (me.plan === "unlimited") return { name: "Unlimited", note: "Tailoring and chat need no credits." };
  return { name: "Free", note: "Tailoring and chat are paid for with credits." };
}

function ProfileCard({ me }: { me: Me }) {
  const plan = planOf(me);
  return (
    <section aria-labelledby="profile-heading" className="rounded-lg border border-rule bg-card p-5 shadow-card">
      <h2 id="profile-heading" className="text-2xl tracking-tight">
        Your account
      </h2>
      <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
        <dt className="text-ink-soft">Email</dt>
        <dd className="break-words">{me.email}</dd>
        <dt className="text-ink-soft">Plan</dt>
        <dd>
          <span className="font-medium">{plan.name}</span>
          <span className="block text-ink-soft">{plan.note}</span>
        </dd>
        <dt className="text-ink-soft">Model</dt>
        <dd>
          {modelName(me.policy.model)}
          {me.policy.picksModel && <span className="block text-ink-soft">You can pick another when tailoring.</span>}
        </dd>
      </dl>
    </section>
  );
}

export function AccountPage() {
  const { me, error } = useMe();
  const showsCredits = me?.policy.chargesCredits ?? false;

  return (
    <section aria-labelledby="account-heading">
      <h1 id="account-heading" className="text-4xl tracking-tight">
        Account
      </h1>
      <p className="mt-2 max-w-2xl text-sm text-ink-soft">Your sign-in, your plan, and everything you have stored here.</p>

      {/* The top bar explains a failed load and offers a retry. */}
      {!me && !error && (
        <p role="status" className="mt-8 text-sm text-ink-soft">
          Loading your account…
        </p>
      )}
      {me && (
        <div className={`mt-8 grid gap-6 ${showsCredits ? "lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]" : "max-w-2xl"}`}>
          {showsCredits && <CreditsCard me={me} />}
          <div className="grid content-start gap-6">
            <ProfileCard me={me} />
            <DataCard />
            <DeleteAccountCard email={me.email} />
          </div>
        </div>
      )}
      <nav aria-label="Legal" className="mt-10 border-t border-rule pt-4 text-sm text-ink-soft">
        <ul className="flex flex-wrap gap-x-6 gap-y-2">
          {LEGAL_PAGES.map((page) => (
            <li key={page.href}>
              <Link href={page.href} className={LINK_CLASS}>
                {page.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </section>
  );
}
