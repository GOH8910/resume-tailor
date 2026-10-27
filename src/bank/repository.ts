import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { AppError } from "@/lib/errors";
import { exists, isEnoent, writeJsonAtomic } from "@/lib/fs";
import { type Bank, BankSchema, emptyBank } from "./schema";

export const PROFILE_SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;

export function assertProfileSlug(slug: string): string {
  if (!PROFILE_SLUG.test(slug)) {
    throw new AppError(`Invalid profile "${slug}": use lowercase letters, digits and dashes`, 400);
  }
  return slug;
}

export class BankRepository {
  constructor(readonly root: string) {}

  bankPath(slug: string): string {
    return path.join(this.root, assertProfileSlug(slug), "bank.json");
  }

  async listProfiles(): Promise<string[]> {
    let entries;
    try {
      entries = await readdir(this.root, { withFileTypes: true });
    } catch (err) {
      if (isEnoent(err)) return [];
      throw err;
    }
    const candidates = entries.filter((e) => e.isDirectory() && PROFILE_SLUG.test(e.name)).map((e) => e.name);
    const checks = await Promise.all(candidates.map(async (slug) => ((await exists(this.bankPath(slug))) ? slug : null)));
    return checks.filter((slug): slug is string => slug !== null).sort();
  }

  async createProfile(slug: string, name: string): Promise<Bank> {
    const file = this.bankPath(slug);
    if (await exists(file)) throw new AppError(`Profile "${slug}" already exists`, 409);
    const bank = emptyBank(name);
    await writeJsonAtomic(file, bank);
    return bank;
  }

  async read(slug: string): Promise<Bank> {
    const file = this.bankPath(slug);
    let raw: string;
    try {
      raw = await readFile(file, "utf8");
    } catch (err) {
      if (isEnoent(err)) throw new AppError(`Profile "${slug}" not found`, 404);
      throw err;
    }
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new AppError(`${file} is not valid JSON`, 500);
    }
    const parsed = BankSchema.safeParse(json);
    if (!parsed.success) throw new AppError(`${file} does not match the bank schema`, 500, parsed.error.issues);
    return parsed.data;
  }

  async write(slug: string, bank: unknown): Promise<Bank> {
    const parsed = BankSchema.safeParse(bank);
    if (!parsed.success) throw new AppError("Bank does not match the schema", 400, parsed.error.issues);
    await writeJsonAtomic(this.bankPath(slug), parsed.data);
    return parsed.data;
  }
}
