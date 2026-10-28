/**
 * Seed or enrich a profile's bank from resume PDFs.
 *   npm run seed -- --profile edward "/path/to/CV one.pdf" "/path/to/CV two.pdf"
 * Needs: pdftotext (brew install poppler) and ANTHROPIC_API_KEY (read from .env.local if not set).
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { type ExtractedBank, mergeBank } from "@/bank/merge";
import { BankRepository } from "@/bank/repository";
import { type Bank, emptyBank } from "@/bank/schema";
import { getDb } from "@/db/client";
import { AppError } from "@/lib/errors";

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
  console.error('Usage: npm run seed -- --profile <slug> "<file.pdf>" ["<more.pdf>" ...]');
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
  const flag = args.indexOf("--profile");
  if (flag === -1 || !args[flag + 1]) usage();
  const slug = args[flag + 1];
  const pdfs = args.filter((_, i) => i !== flag && i !== flag + 1);
  if (pdfs.length === 0) usage();

  loadDotEnvLocal();
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is not set. Put it in .env.local or export it.");
    process.exit(1);
  }

  const repo = new BankRepository(getDb);
  let bank = await repo.read(slug).catch((err: unknown) => {
    if (err instanceof AppError && err.status === 404) return emptyBank();
    throw err;
  });
  const client = new Anthropic();

  for (const pdf of pdfs) {
    console.log(`Extracting ${pdf} ...`);
    const text = execFileSync("pdftotext", ["-layout", pdf, "-"], { encoding: "utf8" });
    const response = await client.messages.parse({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      system: SYSTEM,
      messages: [{ role: "user", content: `<resume_text>\n${text}\n</resume_text>` }],
      output_config: { effort: "medium", format: zodOutputFormat(ExtractedBankSchema) },
    });
    if (!response.parsed_output) {
      throw new Error(`Claude returned no structured output for ${pdf} (stop_reason=${response.stop_reason})`);
    }
    const before = countBullets(bank);
    bank = mergeBank(bank, toExtracted(response.parsed_output));
    console.log(`  +${countBullets(bank) - before} new bullets`);
  }

  await repo.write(slug, bank);
  console.log(`Saved the bank for ${slug} with ${countBullets(bank)} bullets.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
