export const PLANS = ["free", "unlimited"] as const;
export type Plan = (typeof PLANS)[number];
export type Mode = "hosted" | "selfhost";
export type PlanPolicy = { model: string; chargesCredits: boolean; showsAds: boolean; limited: boolean };

/** The single table of what an account may do: which model it runs on, and whether credits, ads and limits apply. */
export function policyFor(plan: Plan, mode: Mode, settings: { freeModel: string; unlimitedModel: string }): PlanPolicy {
  if (mode === "selfhost") return { model: settings.unlimitedModel, chargesCredits: false, showsAds: false, limited: false };
  return plan === "unlimited"
    ? { model: settings.unlimitedModel, chargesCredits: false, showsAds: false, limited: true }
    : { model: settings.freeModel, chargesCredits: true, showsAds: true, limited: true };
}

/** Accounts that pay in credits always run on their plan's model; the others may pick one. */
export function chooseModel(policy: PlanPolicy, requested: string | undefined): string {
  return !policy.chargesCredits && requested ? requested : policy.model;
}

/** The plan a new account starts on. */
export function signupPlan(email: string, adminEmails: Set<string>): Plan {
  return adminEmails.has(email.toLowerCase()) ? "unlimited" : "free";
}
