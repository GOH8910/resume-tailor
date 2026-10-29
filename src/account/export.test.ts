import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Application } from "@/applications/schema";
import { emptyBank } from "@/bank/schema";
import { applications, banks, creditEvents, user } from "@/db/schema";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { exportAccount } from "./export";

let close: () => Promise<void>;
let db: Db;
const ADA = { id: "user_ada", email: "ada@example.com" };
const BOB = { id: "user_bob", email: "bob@example.com" };
const NOW = new Date("2026-10-29T12:00:00Z");

const application = (id: string, company: string, createdAt: string): Application => ({
  id,
  createdAt,
  company,
  roleTitle: "SWE",
  jobDescription: "Build things",
  model: "manual",
  warnings: [],
  notes: "",
  resume: { summary: "", education: [], experience: [], projects: [], skills: [] },
});

beforeEach(async () => {
  const t = await createTestDb();
  close = t.close;
  db = t.db;
  await db.insert(user).values([
    { id: ADA.id, name: "Ada", email: ADA.email },
    { id: BOB.id, name: "Bob", email: BOB.email },
  ]);
});
afterEach(() => close());

describe("exportAccount", () => {
  it("holds the account's bank, applications and ledger, and no PDFs", async () => {
    const bank = { ...emptyBank("Ada"), summary: "Engineer who ships." };
    await db.insert(banks).values([
      { userId: ADA.id, data: bank },
      { userId: BOB.id, data: { ...emptyBank("Bob"), summary: "Bob's summary" } },
    ]);
    const older = application("2026-10-01-acme-aaaaaaaa", "Acme", "2026-10-01T00:00:00.000Z");
    const newer = application("2026-10-02-globex-bbbbbbbb", "Globex", "2026-10-02T00:00:00.000Z");
    await db.insert(applications).values([
      { userId: ADA.id, id: newer.id, data: newer, pdf: Buffer.from("%PDF-secret"), pdfPages: 1 },
      { userId: ADA.id, id: older.id, data: older },
      { userId: BOB.id, id: "2026-10-03-initech-cccccccc", data: application("2026-10-03-initech-cccccccc", "Initech", "2026-10-03T00:00:00.000Z") },
    ]);
    await db.insert(creditEvents).values([
      { userId: ADA.id, kind: "ad", amount: 1, ref: "ad-1", createdAt: new Date("2026-10-28T10:00:00Z") },
      { userId: ADA.id, kind: "tailor", amount: -2, ref: newer.id, createdAt: new Date("2026-10-28T11:00:00Z") },
      { userId: BOB.id, kind: "signup", amount: 4, ref: null, createdAt: new Date("2026-10-28T09:00:00Z") },
    ]);

    const exported = await exportAccount(db, ADA, NOW);

    expect(exported).toEqual({
      exportedAt: "2026-10-29T12:00:00.000Z",
      email: "ada@example.com",
      bank,
      applications: [older, newer],
      credits: [
        { kind: "ad", amount: 1, ref: "ad-1", createdAt: "2026-10-28T10:00:00.000Z" },
        { kind: "tailor", amount: -2, ref: newer.id, createdAt: "2026-10-28T11:00:00.000Z" },
      ],
    });
    const json = JSON.stringify(exported);
    expect(json).not.toContain("pdf");
    expect(json).not.toContain("Bob");
    expect(json).not.toContain("Initech");
  });

  it("exports an account with nothing stored yet", async () => {
    expect(await exportAccount(db, BOB, NOW)).toEqual({
      exportedAt: "2026-10-29T12:00:00.000Z",
      email: "bob@example.com",
      bank: null,
      applications: [],
      credits: [],
    });
  });
});
