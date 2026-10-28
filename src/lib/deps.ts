import { ApplicationRepository } from "@/applications/repository";
import { BankRepository } from "@/bank/repository";
import { getDb } from "@/db/client";

export const banks = new BankRepository(getDb);
export const applications = new ApplicationRepository(getDb);
