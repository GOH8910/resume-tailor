import { ApplicationRepository } from "@/applications/repository";
import { BankRepository } from "@/bank/repository";
import { PlansRepository } from "@/billing/plans-repo";
import { UsageService } from "@/billing/usage";
import { getDb } from "@/db/client";
import { env } from "@/lib/env";

export const banks = new BankRepository(getDb);
export const applications = new ApplicationRepository(getDb);
export const plans = new PlansRepository(getDb);
export const usage = new UsageService(getDb, { usdToGbp: env.USD_TO_GBP, freeDailyBudgetGbp: env.FREE_DAILY_BUDGET_GBP });
