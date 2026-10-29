import type { AdClientConfig } from "@/ads/provider";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { type Mode, type Plan, type PlanPolicy, policyFor } from "./plan";

/** What `GET /api/me` answers: the signed-in account and what its plan allows here. */
export type Me = {
  email: string;
  plan: Plan;
  mode: Mode;
  credits: number;
  policy: PlanPolicy;
  creditsPerTailor: number;
  creditsPerChatMessage: number;
  /** Whether this server has an ad network to earn credits with. */
  adsAvailable: boolean;
  ads: AdClientConfig;
  /** Whether the account is one of the operator's (ADMIN_EMAILS), which may open /admin. */
  isAdmin: boolean;
};

/** The policy for `plan` under this server's mode and model settings. */
export function currentPolicy(plan: Plan): PlanPolicy {
  return policyFor(plan, env.appMode, { freeModel: env.FREE_MODEL, unlimitedModel: env.UNLIMITED_MODEL });
}

/** Refuses ad requests from an account that sees no ads (400), and on a server without an ad network (503). */
export function ensureAdsAvailable(policy: Pick<PlanPolicy, "showsAds">): void {
  if (!policy.showsAds) throw new AppError("Ads are not available for this account", 400);
  if (env.adProvider === "none") throw new AppError("Ads are not available yet", 503);
}
