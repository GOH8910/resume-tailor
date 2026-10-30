/**
 * Seed or enrich an account's bank from resume PDFs.
 *   npm run seed -- --email you@example.com "/path/to/CV one.pdf" "/path/to/CV two.pdf"
 * Needs: an account (sign in on the site once first), pdftotext (brew install poppler)
 * and ANTHROPIC_API_KEY (read from .env.local if not set).
 * Targets DATABASE_URL when set, else the local PGlite (single-process: stop `npm run dev` first).
 * Do not edit the bank in the browser while this runs: it reads the bank, calls Claude, then writes the whole bank.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { type ExtractedBank, mergeBank } from "@/bank/merge";
import { BankRepository } from "@/bank/repository";
import type { Bank } from "@/bank/schema";
import { recordUsageOrLog } from "@/billing/usage";
import { getDb } from "@/db/client";
import { findUserIdByEmail } from "@/db/users";
import { fitBankToCaps } from "@/import/fit-caps";
import { latexEnv } from "@/latex/compile";
import { createStructured } from "@/lib/anthropic";
import { jsonBytes, MAX_BANK_JSON_BYTES } from "@/lib/input-caps";

const SEED_MODEL = "claude-opus-5-5";

const ExtractedEntrySchema = z.object({
  title: z.string(),
  org: z.string(),
  location: z.string(),
  start: z.string(),
  end: z.string(),
  link: z.string(),
  bullets: z.array(z.string()),
});

const ExtractedBankSchema = z.object({
  profile: z.object({
    name: z.string(),
    email: z.string(),
    phone: z.string(),
    linkedin: z.string(),
    github: z.string(),
    website: z.string(),
  }),
  summary: z.string(),
  education: z.array(ExtractedEntrySchema),
  experience: z.array(ExtractedEntrySchema),
  projects: z.array(ExtractedEntrySchema),
  skills: z.array(z.object({ name: z.string(), items: z.array(z.string()) })),
});

const SYSTEM = `You extract resume content into structured JSON.
- Copy bullet text verbatim; only repair words broken across lines by PDF extraction.
- Use empty strings for anything not present. Dates exactly as written, e.g. "Jul 2025".
- Education: institution in "title", degree in "org".
- Projects: "org" empty unless an organisation is named.
- Skills: keep the resume's own category names and item spelling.
- "summary": the opening profile paragraph if there is one, else empty.`;

function usage(): never {
  console.error('Usage: npm run seed -- --email <email> "<file.pdf>" ["<more.pdf>" ...]');
  process.exit(1);
}

/** Minimal .env.local loader so the script works without Next.js. */
function loadDotEnvLocal(): void {
  if (process.env.ANTHROPIC_API_KEY) return;
  try {
    for (const line of readFileSync(path.join(process.cwd(), ".env.local"), "utf8").split("\n")) {
      const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    // no .env.local; the check below reports it
  }
}

function toExtracted(parsed: z.infer<typeof ExtractedBankSchema>): ExtractedBank {
  const entry = (e: z.infer<typeof ExtractedEntrySchema>) => ({
    title: e.title,
    org: e.org || undefined,
    location: e.location || undefined,
    start: e.start,
    end: e.end,
    link: e.link || undefined,
    bullets: e.bullets,
  });
  return {
    profile: {
      name: parsed.profile.name,
      email: parsed.profile.email,
      phone: parsed.profile.phone,
      linkedin: parsed.profile.linkedin || undefined,
      github: parsed.profile.github || undefined,
      website: parsed.profile.website || undefined,
    },
    summary: parsed.summary,
    education: parsed.education.map(entry),
    experience: parsed.experience.map(entry),
    projects: parsed.projects.map(entry),
    skills: parsed.skills,
  };
}

function countBullets(bank: Bank): number {
  return [...bank.education, ...bank.experience, ...bank.projects].reduce((n, e) => n + e.bullets.length, 0);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flag = args.indexOf("--email");
  if (flag === -1 || !args[flag + 1]) usage();
  const email = args[flag + 1];
  const pdfs = args.filter((_, i) => i !== flag && i !== flag + 1);
  if (pdfs.length === 0) usage();

  loadDotEnvLocal();
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is not set. Put it in .env.local or export it.");
    process.exit(1);
  }

  // After loading .env.local, which may set DATABASE_URL.
  const userId = await findUserIdByEmail(email);
  if (!userId) {
    console.error(`No account for ${email}: sign in on the site first, then re-run`);
    process.exit(1);
  }

  // Imported only now: the settings are read on import, and .env.local has just been loaded.
  const { usage: ledger } = await import("@/lib/deps");
  const repo = new BankRepository(getDb);
  // read() creates an empty bank when the account has none.
  let bank = await repo.read(userId);
  const client = new Anthropic();

  for (const pdf of pdfs) {
    console.log(`Extracting ${pdf} ...`);
    const text = execFileSync("pdftotext", ["-layout", pdf, "-"], { encoding: "utf8", env: latexEnv() });
    const { value, usage: used } = await createStructured(client, ExtractedBankSchema, {
      model: SEED_MODEL,
      system: SYSTEM,
      messages: [{ role: "user", content: `<resume_text>\n${text}\n</resume_text>` }],
      effort: "medium",
    });
    // The operator runs this, so it is never free usage.
    await recordUsageOrLog(ledger, { userId, kind: "seed", usage: used, free: false });
    const before = countBullets(bank);
    bank = mergeBank(bank, toExtracted(value));
    console.log(`  +${countBullets(bank) - before} new bullets`);
  }

  // The bank editor must be able to save what this writes.
  const fitted = fitBankToCaps(bank);
  if (fitted.truncated.length > 0) {
    console.log(`Cut ${fitted.truncated.length} text(s) to the editor's length caps: ${fitted.truncated.join(", ")}`);
  }
  if (jsonBytes(fitted.bank) > MAX_BANK_JSON_BYTES) {
    throw new Error(`The merged bank is over ${MAX_BANK_JSON_BYTES / 1000} KB as JSON, more than the bank editor can save; nothing was written`);
  }
  await repo.write(userId, fitted.bank);
  console.log(`Saved the bank for ${email} with ${countBullets(fitted.bank)} bullets.`);
}

// Exit explicitly: an open pg pool would otherwise keep the process alive.
main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
