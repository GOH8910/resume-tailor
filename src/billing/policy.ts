import { env } from "@/lib/env";
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
};

/** The policy for `plan` under this server's mode and model settings. */
export function currentPolicy(plan: Plan): PlanPolicy {
  return policyFor(plan, env.appMode, { freeModel: env.FREE_MODEL, unlimitedModel: env.UNLIMITED_MODEL });
}
