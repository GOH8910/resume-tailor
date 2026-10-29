import type { CreditKind } from "@/credits/types";

/** One row of `GET /api/account/credits`. */
export type LedgerEvent = { kind: CreditKind; amount: number; ref: string | null; createdAt: string };

const LABELS: Record<CreditKind, string> = {
  ad: "Ad watched",
  signup: "Welcome credits",
  tailor: "Tailor",
  chat: "Chat message",
  admin: "Adjustment",
  refund: "Refund",
};

export function ledgerLabel(kind: string): string {
  return LABELS[kind as CreditKind] ?? kind;
}

/** "+1" for credits earned, "−2" (a minus sign, not a hyphen) for credits spent. */
export function signedCredits(amount: number): string {
  if (amount > 0) return `+${amount}`;
  if (amount < 0) return `−${-amount}`;
  return "0";
}
