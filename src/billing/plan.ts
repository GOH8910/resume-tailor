export const PLANS = ["free", "unlimited"] as const;
export type Plan = (typeof PLANS)[number];
export type Mode = "hosted" | "selfhost";
export type PlanPolicy = {
  /** The model the account runs on unless it picks another. */
  model: string;
  /** Whether the account may pick its model from MODEL_IDS. */
  picksModel: boolean;
  chargesCredits: boolean;
  showsAds: boolean;
  limited: boolean;
};

/** The single table of what an account may do: which model it runs on, and whether credits, ads and limits apply. */
export function policyFor(plan: Plan, mode: Mode, settings: { freeModel: string; unlimitedModel: string }): PlanPolicy {
  if (mode === "selfhost") {
    return { model: settings.unlimitedModel, picksModel: true, chargesCredits: false, showsAds: false, limited: false };
  }
  return plan === "unlimited"
    ? { model: settings.unlimitedModel, picksModel: true, chargesCredits: false, showsAds: false, limited: true }
    : { model: settings.freeModel, picksModel: false, chargesCredits: true, showsAds: true, limited: true };
}

/** The model a request runs on: the requested one if the account may pick, else the plan's. */
export function chooseModel(policy: PlanPolicy, requested: string | undefined): string {
  return policy.picksModel && requested ? requested : policy.model;
}

/** The plan a new account starts on. */
export function signupPlan(email: string, adminEmails: Set<string>): Plan {
  return adminEmails.has(email.toLowerCase()) ? "unlimited" : "free";
}
