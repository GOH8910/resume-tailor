import type { PlanPolicy } from "@/billing/plan";
import { ensureFreeUsageOpen, recordUsageOrLog, type UsageService } from "@/billing/usage";
import { usageFromError } from "@/billing/usage-error";
import type { ModelUsage } from "@/billing/usage-types";
import type { CurrentUser } from "@/lib/http";
import type { ChargeKind, CreditsService } from "./service";

export type PaidCallDeps = {
  credits: Pick<CreditsService, "charge" | "refund">;
  usage: Pick<UsageService, "isFreeUsagePaused" | "record">;
};

export type PaidCall<T> = {
  user: CurrentUser;
  policy: PlanPolicy;
  kind: ChargeKind;
  /** Credits the call costs an account whose plan charges credits. */
  cost: number;
  /** What the charge is for, e.g. the application, when known before the call. */
  ref?: string;
  call: () => Promise<{ value: T; usage: ModelUsage }>;
};

/**
 * The one path every Claude call from a route takes. For a plan that charges credits: refuse while free usage is
 * paused, then charge (or refuse with a 402) before Claude is called. Afterwards book the call's usage, and if it
 * failed, book whatever usage Anthropic billed for it and refund the charge. Booking and refunding never throw:
 * the caller always gets the call's own result or error.
 */
export async function runPaidCall<T>({ user, policy, kind, cost, ref, call }: PaidCall<T>, deps: PaidCallDeps): Promise<T> {
  const paidWithCredits = policy.chargesCredits;
  let chargeId: string | null = null;
  if (paidWithCredits) {
    await ensureFreeUsageOpen(deps.usage, policy);
    if (cost > 0) chargeId = (await deps.credits.charge({ userId: user.id, amount: cost, kind, ref })).eventId;
  }

  let result: { value: T; usage: ModelUsage };
  try {
    result = await call();
  } catch (err) {
    const billed = usageFromError(err);
    if (billed) await recordUsageOrLog(deps.usage, { userId: user.id, kind, usage: billed, free: paidWithCredits });
    if (chargeId) await refundOrLog(deps.credits, { userId: user.id, amount: cost, ref: chargeId });
    throw err;
  }
  await recordUsageOrLog(deps.usage, { userId: user.id, kind, usage: result.usage, free: paidWithCredits });
  return result.value;
}

async function refundOrLog(credits: PaidCallDeps["credits"], refund: { userId: string; amount: number; ref: string }): Promise<void> {
  try {
    await credits.refund(refund);
  } catch (err) {
    console.error(`[credits] could not refund ${refund.amount} credits to user ${refund.userId} for charge ${refund.ref}`, err);
  }
}
