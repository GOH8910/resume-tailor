import type { InFlightCap } from "@/billing/in-flight";
import type { PlanPolicy } from "@/billing/plan";
import { ensureFreeUsageOpen, recordUsageOrLog, type UsageService } from "@/billing/usage";
import { usageFromError } from "@/billing/usage-error";
import type { ModelUsage } from "@/billing/usage-types";
import type { CurrentUser } from "@/lib/http";
import type { ChargeKind, CreditsService } from "./service";

export type PaidCallDeps = {
  credits: Pick<CreditsService, "charge" | "refund">;
  usage: Pick<UsageService, "isFreeUsagePausedFor" | "record">;
  /** The server-wide cap on free calls running at once. */
  freeCalls: Pick<InFlightCap, "claim">;
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

/** The call's value, and the account's balance after the charge when one was taken (for the client to show). */
export type PaidResult<T> = { value: T; credits?: number };

/**
 * The one path every Claude call from a route takes. For a plan that charges credits: refuse while free usage is
 * paused for everyone or for this account (402), take one of the server's free-call slots (503 when none is free),
 * then charge (or refuse with a 402) before Claude is called. Afterwards book the call's usage, and if it failed,
 * book whatever usage Anthropic billed for it and refund the charge. Booking and refunding never throw: the caller
 * always gets the call's own result or error, plus the balance after a charge.
 */
export async function runPaidCall<T>(paid: PaidCall<T>, deps: PaidCallDeps): Promise<PaidResult<T>> {
  if (!paid.policy.chargesCredits) return runCall(paid, deps, null);
  await ensureFreeUsageOpen(deps.usage, paid.policy, paid.user.id);
  const release = deps.freeCalls.claim();
  try {
    const { user, cost, kind, ref } = paid;
    const charge = cost > 0 ? await deps.credits.charge({ userId: user.id, amount: cost, kind, ref }) : null;
    return await runCall(paid, deps, charge);
  } finally {
    release();
  }
}

/** Runs the call and books it; on failure, also refunds `charge`. */
async function runCall<T>(
  { user, policy, kind, cost, call }: PaidCall<T>,
  deps: PaidCallDeps,
  charge: { credits: number; eventId: string | null } | null,
): Promise<PaidResult<T>> {
  const paidWithCredits = policy.chargesCredits;
  let result: { value: T; usage: ModelUsage };
  try {
    result = await call();
  } catch (err) {
    const billed = usageFromError(err);
    if (billed) await recordUsageOrLog(deps.usage, { userId: user.id, kind, usage: billed, free: paidWithCredits });
    if (charge?.eventId) await refundOrLog(deps.credits, { userId: user.id, amount: cost, ref: charge.eventId });
    throw err;
  }
  await recordUsageOrLog(deps.usage, { userId: user.id, kind, usage: result.usage, free: paidWithCredits });
  return charge ? { value: result.value, credits: charge.credits } : { value: result.value };
}

async function refundOrLog(credits: PaidCallDeps["credits"], refund: { userId: string; amount: number; ref: string }): Promise<void> {
  try {
    await credits.refund(refund);
  } catch (err) {
    console.error(`[credits] could not refund ${refund.amount} credits to user ${refund.userId} for charge ${refund.ref}`, err);
  }
}
