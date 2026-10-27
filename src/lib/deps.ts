import path from "node:path";
import { ApplicationRepository } from "@/applications/repository";
import { BankRepository } from "@/bank/repository";

export function dataRoot(): string {
  return process.env.RESUME_DATA_DIR ?? path.join(process.cwd(), "data");
}

export const banks = new BankRepository(dataRoot());
export const applications = new ApplicationRepository(dataRoot());
