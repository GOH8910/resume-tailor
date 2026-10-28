import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { z } from "zod";
import type { ApplicationRepository } from "@/applications/repository";
import { type Application, ApplicationSchema } from "@/applications/schema";
import type { BankRepository } from "@/bank/repository";
import { type Bank, BankSchema } from "@/bank/schema";
import { countPdfPages } from "@/latex/page-count";
import { isEnoent } from "@/lib/fs";

export type ImportOptions = {
  /** A profile directory of the local app: `bank.json` plus optional `applications/<id>.json` and `<id>.pdf`. */
  from: string;
  userId: string;
  /** Overwrite a bank that already has content. */
  replace: boolean;
  /** Validate and count only. */
  dryRun: boolean;
  banks: Pick<BankRepository, "read" | "write">;
  applications: Pick<ApplicationRepository, "save" | "savePdf">;
};

export type ImportResult = {
  bank: "imported" | "kept" | "replaced" | "would-import";
  applications: number;
  pdfs: number;
  /** `applications/<file>: <reason>` for each application file that was not imported. */
  skipped: string[];
};

type LocalApplication = { application: Application; pdf: Buffer | null };

/** Reads and validates everything first, so a bad bank.json fails before anything is written. */
export async function importLocalData(options: ImportOptions): Promise<ImportResult> {
  const bank = await readBank(options.from);
  const { found, skipped } = await readApplications(options.from);
  const pdfs = found.filter((a) => a.pdf).length;

  if (options.dryRun) return { bank: "would-import", applications: found.length, pdfs, skipped };

  const bankOutcome = await writeBank(options, bank);
  for (const { application, pdf } of found) {
    await options.applications.save(options.userId, application);
    if (pdf) await options.applications.savePdf(options.userId, application.id, pdf, countPdfPages(pdf));
  }
  return { bank: bankOutcome, applications: found.length, pdfs, skipped };
}

async function writeBank(options: ImportOptions, bank: Bank): Promise<ImportResult["bank"]> {
  const current = await options.banks.read(options.userId);
  if (isEmptyBank(current)) {
    await options.banks.write(options.userId, bank);
    return "imported";
  }
  if (!options.replace) return "kept";
  await options.banks.write(options.userId, bank);
  return "replaced";
}

/** The sign-up hook creates a bank with only a name, so the profile and skills do not count as content. */
function isEmptyBank(bank: Bank): boolean {
  return (
    bank.experience.length === 0 &&
    bank.projects.length === 0 &&
    bank.education.length === 0 &&
    bank.summary.trim() === ""
  );
}

async function readBank(from: string): Promise<Bank> {
  const file = path.join(from, "bank.json");
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (err) {
    if (isEnoent(err)) throw new Error(`${file} not found: --from must be a profile folder such as data/<profile>`);
    throw err;
  }
  const json = parseJson(raw);
  if (json === INVALID_JSON) throw new Error(`${file} is not valid JSON`);
  const parsed = BankSchema.safeParse(json);
  if (!parsed.success) throw new Error(`${file} is not a valid bank: ${describeIssues(parsed.error)}`);
  return parsed.data;
}

async function readApplications(from: string): Promise<{ found: LocalApplication[]; skipped: string[] }> {
  const dir = path.join(from, "applications");
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (err) {
    if (isEnoent(err)) return { found: [], skipped: [] };
    throw err;
  }

  const found: LocalApplication[] = [];
  const skipped: string[] = [];
  for (const name of names.filter((n) => n.endsWith(".json")).sort()) {
    const label = `applications/${name}`;
    const json = parseJson(await readFile(path.join(dir, name), "utf8"));
    if (json === INVALID_JSON) {
      skipped.push(`${label}: not valid JSON`);
      continue;
    }
    const parsed = ApplicationSchema.safeParse(json);
    if (!parsed.success) {
      skipped.push(`${label}: ${describeIssues(parsed.error)}`);
      continue;
    }
    found.push({ application: parsed.data, pdf: await readOptional(path.join(dir, `${parsed.data.id}.pdf`)) });
  }
  return { found, skipped };
}

const INVALID_JSON = Symbol("invalid JSON");

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return INVALID_JSON;
  }
}

async function readOptional(file: string): Promise<Buffer | null> {
  try {
    return await readFile(file);
  } catch (err) {
    if (isEnoent(err)) return null;
    throw err;
  }
}

/** Paths and messages only: zod messages do not echo the values, so résumé content stays out of the output. */
function describeIssues(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
}
