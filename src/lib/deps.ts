import { ApplicationRepository } from "@/applications/repository";
import { BankRepository } from "@/bank/repository";
import { PlansRepository } from "@/billing/plans-repo";
import { getDb } from "@/db/client";

export const banks = new BankRepository(getDb);
export const applications = new ApplicationRepository(getDb);
export const plans = new PlansRepository(getDb);
