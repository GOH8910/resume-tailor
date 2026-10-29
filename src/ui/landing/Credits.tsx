function credits(count: number): string {
  return `${count} ${count === 1 ? "credit" : "credits"}`;
}

type Props = { creditsPerTailor: number; creditsPerChatMessage: number; model: string };

/** Hosted mode: what things cost, and why there are ads. */
export function CreditsExplainer({ creditsPerTailor, creditsPerChatMessage, model }: Props) {
  const prices = [
    { label: "Watch one ad", value: "+1 credit" },
    { label: "A tailored resume", value: credits(creditsPerTailor) },
    { label: "A chat message", value: credits(creditsPerChatMessage) },
  ];
  return (
    <section aria-labelledby="credits-heading" className="mx-auto w-full max-w-5xl px-4 py-16">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:gap-20">
        <div>
          <h2 id="credits-heading" className="text-3xl tracking-tight">
            How credits work
          </h2>
          <p className="mt-4 max-w-xl text-lg leading-relaxed text-ink-soft">
            The AI costs credits, and you earn them by watching short ads: one ad is worth about one credit. Free
            accounts run on {model}.
          </p>
          <p className="mt-8 max-w-xl border-l-2 border-accent pl-4 font-serif text-xl italic leading-snug">
            Each tailor costs me a fraction of a penny in AI usage; ads cover it so nobody has to pay.
          </p>
        </div>
        <dl className="self-start rounded-lg border border-rule bg-card px-6 py-2 shadow-card">
          {prices.map((price) => (
            <div key={price.label} className="flex items-baseline justify-between gap-4 border-b border-rule py-4 last:border-b-0">
              <dt className="text-ink-soft">{price.label}</dt>
              <dd className="font-serif text-2xl tabular-nums">{price.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

/** Self-hosted mode has no ads or credits to explain. */
export function SelfHostedNote() {
  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-12">
      <p className="text-lg text-ink-soft">This instance is self-hosted: no ads, no credits.</p>
    </section>
  );
}
