import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApplicationRepository } from "@/applications/repository";
import type { Application } from "@/applications/schema";
import { BankRepository } from "@/bank/repository";
import { type Bank, emptyBank } from "@/bank/schema";
import { banks as banksTable, user } from "@/db/schema";
import { createTestDb } from "@/db/test-db";
import { importLocalData } from "./import-local";

const USER = "user_1";
const WITH_PDF = "2026-10-01-acme-aaaaaaaa";
const WITHOUT_PDF = "2026-10-02-globex-bbbbbbbb";
// Two page objects plus the page tree, which countPdfPages must not count.
const PDF = Buffer.from("%PDF-1.5\n1 0 obj << /Type /Pages >>\n2 0 obj << /Type /Page >>\n3 0 obj << /Type /Page >>\n");

const bank = (): Bank => ({
  ...emptyBank("Ada Example"),
  summary: "Engineer.",
  experience: [{ id: "e_1", title: "Engineer", org: "Acme", start: "2024", end: "2025", bullets: [{ id: "b_1", text: "Built it." }] }],
});

const app = (id: string, company: string): Application => ({
  id,
  createdAt: "2026-10-01T00:00:00.000Z",
  company,
  roleTitle: "SWE",
  jobDescription: "Build things",
  model: "manual",
  warnings: [],
  notes: "",
  resume: { summary: "", education: [], experience: [], projects: [], skills: [] },
});

let dir: string;
let close: () => Promise<void>;
let db: Awaited<ReturnType<typeof createTestDb>>["db"];
let banks: BankRepository;
let applications: ApplicationRepository;

async function writeFixture(files: Record<string, string | Buffer>): Promise<void> {
  for (const [name, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, name)), { recursive: true });
    await writeFile(path.join(dir, name), content);
  }
}

async function standardFixture(): Promise<void> {
  await writeFixture({
    "bank.json": JSON.stringify(bank()),
    [`applications/${WITH_PDF}.json`]: JSON.stringify(app(WITH_PDF, "Acme")),
    [`applications/${WITH_PDF}.pdf`]: PDF,
    [`applications/${WITHOUT_PDF}.json`]: JSON.stringify(app(WITHOUT_PDF, "Globex")),
    "applications/notes.txt": "not an application",
  });
}

const run = (overrides: { replace?: boolean; dryRun?: boolean } = {}) =>
  importLocalData({ from: dir, userId: USER, replace: false, dryRun: false, banks, applications, ...overrides });

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "import-local-"));
  const t = await createTestDb();
  close = t.close;
  db = t.db;
  await t.db.insert(user).values({ id: USER, name: "Ada", email: "ada@example.com" });
  banks = new BankRepository(async () => t.db);
  applications = new ApplicationRepository(async () => t.db);
});

afterEach(async () => {
  await close();
  await rm(dir, { recursive: true, force: true });
});

describe("importLocalData", () => {
  it("imports the bank, the applications and their pdfs with page counts", async () => {
    await standardFixture();

    const result = await run();

    expect(result).toEqual({ bank: "imported", applications: 2, pdfs: 1, skipped: [], truncated: [] });
    expect(await banks.read(USER)).toEqual(bank());
    expect(await applications.get(USER, WITHOUT_PDF)).toEqual(app(WITHOUT_PDF, "Globex"));
    const list = await applications.list(USER);
    expect(list.map((a) => [a.id, a.hasPdf])).toEqual([
      [WITHOUT_PDF, false],
      [WITH_PDF, true],
    ]);
    const stored = await applications.readPdf(USER, WITH_PDF);
    expect(stored?.pages).toBe(2);
    expect(stored?.pdf.equals(PDF)).toBe(true);
  });

  it("imports over a bank that only has the sign-up name", async () => {
    await banks.createEmpty(USER, "Ada");
    await standardFixture();

    expect((await run()).bank).toBe("imported");
    expect(await banks.read(USER)).toEqual(bank());
  });

  it("counts a bank where only the skills were edited as non-empty", async () => {
    await banks.write(USER, { ...emptyBank("Ada"), skills: [{ id: "s_1", name: "Languages", items: ["Go"] }] });
    await standardFixture();

    expect((await run()).bank).toBe("kept");
  });

  it("keeps a non-empty bank unless replace is set", async () => {
    const existing = { ...emptyBank("Existing"), summary: "Already here." };
    await banks.write(USER, existing);
    await standardFixture();

    expect((await run()).bank).toBe("kept");
    expect(await banks.read(USER)).toEqual(existing);

    expect((await run({ replace: true })).bank).toBe("replaced");
    expect(await banks.read(USER)).toEqual(bank());
  });

  it("skips an invalid or unparseable application file and imports the rest", async () => {
    await standardFixture();
    await writeFixture({
      "applications/2026-10-03-bad-cccccccc.json": JSON.stringify({ ...app("2026-10-03-bad-cccccccc", "Bad"), createdAt: "yesterday" }),
      "applications/broken.json": "{ not json",
    });

    const result = await run();

    expect(result.applications).toBe(2);
    expect(result.skipped).toHaveLength(2);
    expect(result.skipped[0]).toMatch(/^applications\/2026-10-03-bad-cccccccc\.json: createdAt: /);
    expect(result.skipped[1]).toMatch(/^applications\/broken\.json: not valid JSON/);
    expect(await applications.list(USER)).toHaveLength(2);
  });

  it("skips an application whose id does not match its file name", async () => {
    await standardFixture();
    await writeFixture({ [`applications/${WITH_PDF} copy.json`]: JSON.stringify(app(WITH_PDF, "Copied")) });

    const result = await run();

    expect(result.applications).toBe(2);
    expect(result.skipped).toEqual([`applications/${WITH_PDF} copy.json: id does not match the file name`]);
    expect((await applications.get(USER, WITH_PDF)).company).toBe("Acme");
  });

  it("saves the application but skips a sibling pdf that is not a PDF", async () => {
    await standardFixture();
    await writeFixture({ [`applications/${WITH_PDF}.pdf`]: "<html>not a pdf</html>" });

    const result = await run();

    expect(result).toEqual({
      bank: "imported",
      applications: 2,
      pdfs: 0,
      skipped: [`applications/${WITH_PDF}.pdf: not a PDF`],
      truncated: [],
    });
    expect(await applications.get(USER, WITH_PDF)).toEqual(app(WITH_PDF, "Acme"));
    expect(await applications.readPdf(USER, WITH_PDF)).toBeNull();
  });

  it("treats a missing applications directory as zero applications", async () => {
    await writeFixture({ "bank.json": JSON.stringify(bank()) });

    expect(await run()).toEqual({ bank: "imported", applications: 0, pdfs: 0, skipped: [], truncated: [] });
  });

  it("fails with the file name when bank.json is missing or invalid, writing nothing", async () => {
    await expect(run()).rejects.toThrow(path.join(dir, "bank.json"));

    await standardFixture();
    await writeFixture({ "bank.json": JSON.stringify({ ...bank(), version: 2 }) });
    await expect(run()).rejects.toThrow(`${path.join(dir, "bank.json")} is not a valid bank: version: `);
    await writeFixture({ "bank.json": "{ not json" });
    await expect(run()).rejects.toThrow(`${path.join(dir, "bank.json")} is not valid JSON`);
    expect(await applications.list(USER)).toEqual([]);
  });

  it("validates and counts on a dry run without writing anything", async () => {
    await standardFixture();
    await writeFixture({ "applications/broken.json": "{ not json" });

    const result = await run({ dryRun: true });

    expect(result).toEqual({
      bank: "would-import",
      applications: 2,
      pdfs: 1,
      skipped: [expect.stringMatching(/^applications\/broken\.json: /)],
      truncated: [],
    });
    expect(await applications.list(USER)).toEqual([]);
    // Not banks.read(): it creates an empty bank on a miss.
    expect(await db.select().from(banksTable)).toEqual([]);
  });

  it("reports on a dry run whether a non-empty bank would be kept or replaced", async () => {
    const existing = { ...emptyBank("Existing"), summary: "Already here." };
    await banks.write(USER, existing);
    await standardFixture();

    expect((await run({ dryRun: true })).bank).toBe("would-keep");
    expect((await run({ dryRun: true, replace: true })).bank).toBe("would-replace");
    expect(await banks.read(USER)).toEqual(existing);
    expect(await applications.list(USER)).toEqual([]);
  });

  it("cuts text over the caps the editors are held to, and lists each field without its text", async () => {
    const long = { ...bank(), summary: "s".repeat(2_100) };
    long.experience[0].bullets[0].text = "x".repeat(650);
    const application = app(WITH_PDF, "Acme");
    application.resume = {
      ...application.resume,
      experience: [{ entryId: "e_1", rationale: "", bullets: [{ bulletId: "b_1", original: "Built it.", text: "y".repeat(700) }] }],
    };
    await writeFixture({ "bank.json": JSON.stringify(long), [`applications/${WITH_PDF}.json`]: JSON.stringify(application) });

    const result = await run();

    expect(result.truncated).toEqual([
      "bank.json: summary",
      "bank.json: experience.0.bullets.0.text",
      `applications/${WITH_PDF}.json: resume.experience.0.bullets.0.text`,
    ]);
    const stored = await banks.read(USER);
    expect(stored.summary).toHaveLength(2_000);
    expect(stored.experience[0].bullets[0].text).toHaveLength(600);
    expect((await applications.get(USER, WITH_PDF)).resume.experience[0].bullets[0].text).toHaveLength(600);
    expect(JSON.stringify(result)).not.toContain("xxxx");
  });

  it("refuses a bank over 300 KB of JSON, writing nothing", async () => {
    const big = bank();
    big.experience[0].bullets = Array.from({ length: 600 }, (_, i) => ({ id: `b_${i}`, text: "é".repeat(300) }));
    await writeFixture({ "bank.json": JSON.stringify(big) });
    await expect(run()).rejects.toThrow(/bank\.json is over 300 KB as JSON/);
    expect(await db.select().from(banksTable)).toEqual([]);
  });

  it("skips an application whose resume is over 700 KB of JSON", async () => {
    await standardFixture();
    const big = app(WITHOUT_PDF, "Globex");
    const bullets = Array.from({ length: 1_200 }, (_, i) => ({ bulletId: `b_${i}`, original: "", text: "x".repeat(600) }));
    big.resume = { ...big.resume, experience: [{ entryId: "e_1", rationale: "", bullets }] };
    await writeFixture({ [`applications/${WITHOUT_PDF}.json`]: JSON.stringify(big) });

    const result = await run();

    expect(result.applications).toBe(1);
    expect(result.skipped).toEqual([`applications/${WITHOUT_PDF}.json: resume is over 700 KB as JSON`]);
  });
});
