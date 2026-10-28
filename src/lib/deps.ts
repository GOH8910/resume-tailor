import { ApplicationRepository } from "@/applications/repository";
import { BankRepository } from "@/bank/repository";
import { dataRoot } from "./data-root";

export const banks = new BankRepository(dataRoot());
export const applications = new ApplicationRepository(dataRoot());
