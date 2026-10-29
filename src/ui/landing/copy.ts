// The landing page's sentences that depend on how this server is set up, kept apart so each variant is tested.

export function credits(count: number): string {
  return `${count} ${count === 1 ? "credit" : "credits"}`;
}

/** How the hero paragraph ends: what pays for the AI, and that the code is open. */
export function heroFunding({ selfHosted, adsAvailable }: { selfHosted: boolean; adsAvailable: boolean }): string {
  if (selfHosted) return "It’s free and open source, so you can also run it yourself.";
  const free = adsAvailable ? "It’s free: watching an ad pays for the AI." : "It’s free, and it will be paid for by ads.";
  return `${free} It’s open source, so you can also run it yourself.`;
}

/** Hosted mode: where credits come from, without promising ads that cannot be watched yet. */
export function creditsSource({ adsAvailable, signupGrantCredits }: { adsAvailable: boolean; signupGrantCredits: number }): string {
  if (adsAvailable) return "The AI costs credits, and you earn them by watching short ads: one ad is worth about one credit.";
  const grant = signupGrantCredits > 0 ? `; new accounts start with ${credits(signupGrantCredits)}` : "";
  return `The AI costs credits. Credits will come from short ads once they’re switched on${grant}.`;
}
