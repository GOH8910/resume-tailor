import { ApplicationRepository } from "@/applications/repository";
import { BankRepository } from "@/bank/repository";
import { createInFlightCap } from "@/billing/in-flight";
import { PlansRepository } from "@/billing/plans-repo";
import { UsageService } from "@/billing/usage";
import { CreditsService } from "@/credits/service";
import { getDb } from "@/db/client";
import { env } from "@/lib/env";

export const banks = new BankRepository(getDb);
export const applications = new ApplicationRepository(getDb);
export const plans = new PlansRepository(getDb);
export const usage = new UsageService(getDb, {
  usdToGbp: env.USD_TO_GBP,
  freeDailyBudgetGbp: env.FREE_DAILY_BUDGET_GBP,
  freeDailyCostPerAccountGbp: env.FREE_DAILY_COST_PER_ACCOUNT_GBP,
});
export const credits = new CreditsService(getDb, {
  perAccountPerDay: env.AD_CREDITS_PER_ACCOUNT_PER_DAY,
  perIpPerDay: env.AD_CREDITS_PER_IP_PER_DAY,
  minWatchSeconds: env.AD_MIN_WATCH_SECONDS,
});
export const freeCalls = createInFlightCap(env.FREE_CALLS_IN_FLIGHT);
