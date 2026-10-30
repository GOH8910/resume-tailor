import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { z } from "zod";
import type { ApplicationRepository } from "@/applications/repository";
import { type Application, ApplicationSchema } from "@/applications/schema";
import type { BankRepository } from "@/bank/repository";
import { type Bank, BankSchema, emptyBank } from "@/bank/schema";
import { countPdfPages } from "@/latex/page-count";
import { isEnoent } from "@/lib/fs";
import { jsonBytes, MAX_BANK_JSON_BYTES, MAX_RESUME_JSON_BYTES } from "@/lib/input-caps";
import { fitBankToCaps, fitResumeToCaps } from "./fit-caps";

export type ImportOptions = {
  /** A profile directory of the local app: `bank.json` plus optional `applications/<id>.json` and `<id>.pdf`. */
  from: string;
  userId: string;
  /** Overwrite a bank that already has content. */
  replace: boolean;
  /** Validate, count and decide only: nothing is written. */
  dryRun: boolean;
  banks: Pick<BankRepository, "find" | "write">;
  applications: Pick<ApplicationRepository, "save" | "savePdf">;
};

type BankDecision = "import" | "keep" | "replace";

export type ImportResult = {
  bank: "imported" | "kept" | "replaced" | "would-import" | "would-keep" | "would-replace";
  applications: number;
  pdfs: number;
  /** `applications/<file>: <reason>` for each application or PDF file that was not imported. */
  skipped: string[];
  /** `<file>: <field>` for each text cut to the caps the editors are held to (see fit-caps.ts). */
  truncated: string[];
};

type LocalApplication = { application: Application; pdf: Buffer | null };

const DONE: Record<BankDecision, ImportResult["bank"]> = { import: "imported", keep: "kept", replace: "replaced" };
const PLANNED: Record<BankDecision, ImportResult["bank"]> = {
  import: "would-import",
  keep: "would-keep",
  replace: "would-replace",
};

/** Reads and validates everything first, so a bad bank.json fails before anything is written. */
export async function importLocalData(options: ImportOptions): Promise<ImportResult> {
  const { bank, truncated: bankTruncated } = await readBank(options.from);
  const { found, skipped, truncated: applicationsTruncated } = await readApplications(options.from);
  const truncated = [...bankTruncated, ...applicationsTruncated];
  const pdfs = found.filter((a) => a.pdf).length;
  // find(), not read(): read() creates a missing bank, which a dry run must not do.
  const decision = decideBank(await options.banks.find(options.userId), options.replace);

  if (options.dryRun) return { bank: PLANNED[decision], applications: found.length, pdfs, skipped, truncated };

  if (decision !== "keep") await options.banks.write(options.userId, bank);
  for (const { application, pdf } of found) {
    await options.applications.save(options.userId, application);
    if (pdf) await options.applications.savePdf(options.userId, application.id, pdf, countPdfPages(pdf));
  }
  return { bank: DONE[decision], applications: found.length, pdfs, skipped, truncated };
}

/**
 * A missing bank, or one still exactly as the sign-up hook created it (only the name filled in), is imported over.
 * Any edit, even to skills or contact details alone, makes it content that is kept unless `replace` is set.
 */
function decideBank(current: Bank | null, replace: boolean): BankDecision {
  if (current === null || isDeepStrictEqual(current, emptyBank(current.profile.name))) return "import";
  return replace ? "replace" : "keep";
}

async function readBank(from: string): Promise<{ bank: Bank; truncated: string[] }> {
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
  const { bank, truncated } = fitBankToCaps(parsed.data);
  if (jsonBytes(bank) > MAX_BANK_JSON_BYTES) {
    throw new Error(`${file} is over ${MAX_BANK_JSON_BYTES / 1000} KB as JSON, more than the bank editor can save; trim it first`);
  }
  return { bank, truncated: truncated.map((field) => `bank.json: ${field}`) };
}

async function readApplications(from: string): Promise<{ found: LocalApplication[]; skipped: string[]; truncated: string[] }> {
  const dir = path.join(from, "applications");
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (err) {
    if (isEnoent(err)) return { found: [], skipped: [], truncated: [] };
    throw err;
  }

  const found: LocalApplication[] = [];
  const skipped: string[] = [];
  const truncated: string[] = [];
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
    // A renamed copy ("<id> copy.json") would otherwise overwrite the original's row.
    if (parsed.data.id !== path.basename(name, ".json")) {
      skipped.push(`${label}: id does not match the file name`);
      continue;
    }
    const fitted = fitResumeToCaps(parsed.data.resume);
    if (jsonBytes(fitted.resume) > MAX_RESUME_JSON_BYTES) {
      skipped.push(`${label}: resume is over ${MAX_RESUME_JSON_BYTES / 1000} KB as JSON`);
      continue;
    }
    truncated.push(...fitted.truncated.map((field) => `${label}: resume.${field}`));
    const application = { ...parsed.data, resume: fitted.resume };
    const pdfName = `${parsed.data.id}.pdf`;
    let pdf = await readOptional(path.join(dir, pdfName));
    if (pdf && !isPdf(pdf)) {
      skipped.push(`applications/${pdfName}: not a PDF`);
      pdf = null;
    }
    found.push({ application, pdf });
  }
  return { found, skipped, truncated };
}

function isPdf(bytes: Buffer): boolean {
  return bytes.subarray(0, 5).toString("latin1") === "%PDF-";
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
