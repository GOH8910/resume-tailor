import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Application } from "@/applications/schema";
import { emptyBank } from "@/bank/schema";
import { account, adSessions, applications, banks, creditEvents, session, usageEvents, user, userPlans } from "@/db/schema";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { APPLICATION_BATCH, exportStream } from "./export";

let close: () => Promise<void>;
let db: Db;
const ADA = { id: "user_ada", email: "ada@example.com" };
const BOB = { id: "user_bob", email: "bob@example.com" };
const NOW = new Date("2026-10-29T12:00:00Z");
const T = (iso: string) => new Date(iso);

const application = (id: string, company: string): Application => ({
  id,
  createdAt: `${id.slice(0, 10)}T00:00:00.000Z`,
  company,
  roleTitle: "SWE",
  jobDescription: "Build things",
  model: "manual",
  warnings: [],
  notes: "",
  resume: { summary: "", education: [], experience: [], projects: [], skills: [] },
});

/** Reads the whole export, as the browser would. */
async function download(who = ADA, onEnd = vi.fn()) {
  const text = await new Response(await exportStream(db, who, onEnd, NOW)).text();
  return { text, json: JSON.parse(text) as Record<string, unknown>, onEnd };
}

beforeEach(async () => {
  const t = await createTestDb();
  close = t.close;
  db = t.db;
  await db.insert(user).values([
    { id: ADA.id, name: "Ada", email: ADA.email, image: null, createdAt: T("2026-10-01T09:00:00Z") },
    { id: BOB.id, name: "Bob", email: BOB.email, createdAt: T("2026-10-02T09:00:00Z") },
  ]);
});
afterEach(() => close());

describe("exportStream", () => {
  it("holds everything the account has stored, and no PDFs, tokens or other accounts' data", async () => {
    const bank = { ...emptyBank("Ada"), summary: "Engineer who ships." };
    await db.insert(banks).values([
      { userId: ADA.id, data: bank },
      { userId: BOB.id, data: { ...emptyBank("Bob"), summary: "Bob's summary" } },
    ]);
    const acme = application("2026-10-01-acme-aaaaaaaa", "Acme");
    const globex = application("2026-10-02-globex-bbbbbbbb", "Globex");
    await db.insert(applications).values([
      { userId: ADA.id, id: globex.id, data: globex, pdf: Buffer.from("%PDF-secret"), pdfPages: 1 },
      { userId: ADA.id, id: acme.id, data: acme },
      { userId: BOB.id, id: "2026-10-03-initech-cccccccc", data: application("2026-10-03-initech-cccccccc", "Initech") },
    ]);
    await db.insert(userPlans).values([{ userId: ADA.id, plan: "free", credits: 3 }, { userId: BOB.id }]);
    await db.insert(account).values({
      id: "acc_1",
      accountId: "google-123",
      providerId: "google",
      userId: ADA.id,
      accessToken: "secret-access-token",
      refreshToken: "secret-refresh-token",
      createdAt: T("2026-10-01T09:00:00Z"),
      updatedAt: T("2026-10-01T09:00:00Z"),
    });
    await db.insert(session).values({
      id: "ses_1",
      token: "secret-session-token",
      userId: ADA.id,
      ipAddress: "203.0.113.1",
      userAgent: "Firefox",
      createdAt: T("2026-10-28T08:00:00Z"),
      expiresAt: T("2026-11-04T08:00:00Z"),
      updatedAt: T("2026-10-28T08:00:00Z"),
    });
    await db.insert(creditEvents).values([
      { userId: ADA.id, kind: "ad", amount: 1, ref: "ad-1", createdAt: T("2026-10-28T10:00:00Z") },
      { userId: ADA.id, kind: "tailor", amount: -2, ref: globex.id, createdAt: T("2026-10-28T11:00:00Z") },
      { userId: BOB.id, kind: "signup", amount: 4, ref: null, createdAt: T("2026-10-28T09:00:00Z") },
    ]);
    await db.insert(adSessions).values([
      { userId: ADA.id, ip: "203.0.113.1", provider: "test", startedAt: T("2026-10-28T09:59:50Z"), grantedAt: T("2026-10-28T10:00:00Z"), status: "granted" },
      { userId: BOB.id, ip: "198.51.100.7", provider: "test", startedAt: T("2026-10-28T09:00:00Z"), status: "rejected", rejectReason: "watched too briefly" },
    ]);
    await db.insert(usageEvents).values([
      { userId: ADA.id, kind: "tailor", model: "claude-haiku-5-5", inputTokens: 10, outputTokens: 5, cacheReadTokens: 2, costGbp: 0.01, free: true, createdAt: T("2026-10-28T11:00:01Z") },
      { userId: BOB.id, kind: "chat", model: "claude-haiku-5-5", inputTokens: 1, outputTokens: 1, costGbp: 0.001, free: true },
    ]);

    const { text, json } = await download();

    expect(json).toEqual({
      exportedAt: "2026-10-29T12:00:00.000Z",
      email: "ada@example.com",
      profile: { name: "Ada", image: null, createdAt: "2026-10-01T09:00:00.000Z" },
      plan: { plan: "free", credits: 3 },
      signIns: [{ providerId: "google", accountId: "google-123", createdAt: "2026-10-01T09:00:00.000Z" }],
      sessions: [{ createdAt: "2026-10-28T08:00:00.000Z", expiresAt: "2026-11-04T08:00:00.000Z", ipAddress: "203.0.113.1", userAgent: "Firefox" }],
      credits: [
        { kind: "ad", amount: 1, ref: "ad-1", createdAt: "2026-10-28T10:00:00.000Z" },
        { kind: "tailor", amount: -2, ref: globex.id, createdAt: "2026-10-28T11:00:00.000Z" },
      ],
      adSessions: [
        { startedAt: "2026-10-28T09:59:50.000Z", grantedAt: "2026-10-28T10:00:00.000Z", status: "granted", rejectReason: null, ip: "203.0.113.1" },
      ],
      usage: [
        {
          kind: "tailor",
          model: "claude-haiku-5-5",
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 2,
          cacheWriteTokens: 0,
          costGbp: 0.01,
          createdAt: "2026-10-28T11:00:01.000Z",
        },
      ],
      bank,
      applications: [acme, globex],
    });
    for (const secret of ["pdf", "secret", "Bob", "Initech", "198.51.100.7", ADA.id]) expect(text).not.toContain(secret);
  });

  it("streams many applications in batches, in id order, and calls onEnd once at the end", async () => {
    const many = Array.from({ length: APPLICATION_BATCH * 2 + 3 }, (_, i) =>
      application(`2026-10-01-co${String(i).padStart(2, "0")}-aaaaaaaa`, `Company ${i}`),
    );
    await db.insert(applications).values([...many].reverse().map((data) => ({ userId: ADA.id, id: data.id, data })));

    const { json, onEnd } = await download();

    expect(json.applications).toEqual(many);
    expect(onEnd).toHaveBeenCalledOnce();
  });

  it("exports an account with nothing stored yet", async () => {
    const { json } = await download(BOB);
    expect(json).toMatchObject({
      email: "bob@example.com",
      profile: { name: "Bob", image: null, createdAt: "2026-10-02T09:00:00.000Z" },
      plan: null,
      signIns: [],
      sessions: [],
      credits: [],
      adSessions: [],
      usage: [],
      bank: null,
      applications: [],
    });
  });

  it("calls onEnd when the download is abandoned part-way", async () => {
    const onEnd = vi.fn();
    const stream = await exportStream(db, ADA, onEnd, NOW);
    const reader = stream.getReader();
    await reader.read();
    await reader.cancel();
    expect(onEnd).toHaveBeenCalledOnce();
  });
});
