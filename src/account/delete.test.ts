import { eq, isNull } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emptyBank } from "@/bank/schema";
import { CreditsService } from "@/credits/service";
import {
  account,
  adSessions,
  applications,
  banks,
  creditEvents,
  session,
  usageEvents,
  user,
  userPlans,
} from "@/db/schema";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { deleteAccount } from "./delete";

let close: () => Promise<void>;
let db: Db;
const ADA = "user_ada";
const BOB = "user_bob";
const NOON = new Date("2026-10-29T12:00:00Z");
const GRANTED = new Date("2026-10-29T12:00:08Z");
const AN_HOUR_LATER = new Date("2026-10-29T13:00:00Z");
const AD_SESSION = "7d3c0d0e-1b2a-4c5d-8e9f-0a1b2c3d4e5f";

/** Gives the account a row in every table that holds account data. */
async function seed(userId: string, name: string) {
  await db.insert(user).values({ id: userId, name, email: `${name.toLowerCase()}@example.com` });
  await db.insert(session).values({ id: `s_${userId}`, token: `t_${userId}`, userId, expiresAt: new Date("2099-01-01"), updatedAt: NOON });
  await db.insert(account).values({ id: `a_${userId}`, accountId: userId, providerId: "magic-link", userId, updatedAt: NOON });
  await db.insert(banks).values({ userId, data: emptyBank(name) });
  await db.insert(applications).values({ userId, id: "acme", data: {} as never, pdf: Buffer.from("%PDF"), pdfPages: 1 });
  await db.insert(userPlans).values({ userId, credits: 1 });
  await db.insert(creditEvents).values({ userId, kind: "ad", amount: 1, ref: null, createdAt: NOON });
  await db.insert(adSessions).values({ userId, ip: "203.0.113.1", provider: "test", startedAt: NOON, grantedAt: GRANTED, status: "granted" });
  await db.insert(usageEvents).values({ userId, kind: "tailor", model: "claude-haiku-5-5", inputTokens: 10, outputTokens: 5, costGbp: 0.01, free: true });
}

const rowsOf = async (userId: string) => ({
  user: await db.select().from(user).where(eq(user.id, userId)),
  session: await db.select().from(session).where(eq(session.userId, userId)),
  account: await db.select().from(account).where(eq(account.userId, userId)),
  banks: await db.select().from(banks).where(eq(banks.userId, userId)),
  applications: await db.select().from(applications).where(eq(applications.userId, userId)),
  userPlans: await db.select().from(userPlans).where(eq(userPlans.userId, userId)),
  creditEvents: await db.select().from(creditEvents).where(eq(creditEvents.userId, userId)),
  adSessions: await db.select().from(adSessions).where(eq(adSessions.userId, userId)),
  usageEvents: await db.select().from(usageEvents).where(eq(usageEvents.userId, userId)),
});

beforeEach(async () => {
  const t = await createTestDb();
  close = t.close;
  db = t.db;
  await seed(ADA, "Ada");
  await seed(BOB, "Bob");
});
afterEach(() => close());

describe("deleteAccount", () => {
  it("removes every row the account owns and nothing of another account's", async () => {
    await deleteAccount(db, ADA);

    const ada = await rowsOf(ADA);
    for (const [table, rows] of Object.entries(ada)) expect(rows, table).toEqual([]);
    const bob = await rowsOf(BOB);
    for (const [table, rows] of Object.entries(bob)) expect(rows, table).toHaveLength(1);
  });

  it("keeps the ledger, ad sessions and costed usage, anonymised", async () => {
    await deleteAccount(db, ADA, AN_HOUR_LATER);

    expect(await db.select().from(creditEvents).where(isNull(creditEvents.userId))).toEqual([
      expect.objectContaining({ kind: "ad", amount: 1 }),
    ]);
    // The per-IP ad cap still counts the deleted account's grants.
    expect(await db.select().from(adSessions).where(isNull(adSessions.userId))).toEqual([
      expect.objectContaining({ ip: "203.0.113.1", status: "granted" }),
    ]);
    // Anthropic billed the call, so the budget and the admin page still count it.
    expect(await db.select().from(usageEvents).where(isNull(usageEvents.userId))).toEqual([
      expect.objectContaining({ kind: "tailor", costGbp: 0.01, free: true }),
    ]);
  });

  it("blanks the IPs the per-IP cap no longer needs, and today's grants still count towards it", async () => {
    const ad = (startedAt: Date, status: "granted" | "rejected" | "started", grantedAt: Date | null = null) => ({
      userId: ADA,
      ip: "198.51.100.7",
      provider: "test",
      startedAt,
      grantedAt,
      status,
    });
    const yesterday = new Date("2026-10-28T15:00:00Z");
    const lateLastNight = new Date("2026-10-28T23:59:58Z");
    const [old, grantedAcrossMidnight, grantedToday, rejectedToday] = await db
      .insert(adSessions)
      .values([
        ad(yesterday, "granted", new Date("2026-10-28T15:00:08Z")),
        ad(lateLastNight, "granted", new Date("2026-10-29T00:00:06Z")),
        ad(NOON, "granted", new Date("2026-10-29T12:00:08Z")),
        ad(NOON, "rejected"),
      ])
      .returning({ id: adSessions.id });

    await deleteAccount(db, ADA, AN_HOUR_LATER);

    const ipOf = async (id: string) => (await db.select({ ip: adSessions.ip }).from(adSessions).where(eq(adSessions.id, id)))[0].ip;
    expect(await ipOf(old.id)).toBe("");
    expect(await ipOf(rejectedToday.id)).toBe("");
    expect(await ipOf(grantedAcrossMidnight.id)).toBe("198.51.100.7");
    expect(await ipOf(grantedToday.id)).toBe("198.51.100.7");
    const credits = new CreditsService(async () => db, { perAccountPerDay: 10, perIpPerDay: 30, minWatchSeconds: 7 });
    expect(await credits.grantedTodayByIp("198.51.100.7", AN_HOUR_LATER)).toBe(2);
  });

  it("clears the ledger's references to the account's resumes, whose ids carry the company's name", async () => {
    await db.insert(creditEvents).values([
      { userId: ADA, kind: "tailor", amount: -2, ref: "2026-10-29-acme-aaaaaaaa", createdAt: NOON },
      { userId: ADA, kind: "chat", amount: -1, ref: "2026-10-29-acme-aaaaaaaa", createdAt: NOON },
      { userId: ADA, kind: "refund", amount: 2, ref: "7d3c0d0e-1b2a-4c5d-8e9f-0a1b2c3d4e5f", createdAt: NOON },
      { userId: BOB, kind: "tailor", amount: -2, ref: "2026-10-29-globex-bbbbbbbb", createdAt: NOON },
    ]);

    await deleteAccount(db, ADA);

    const refs = await db.select({ kind: creditEvents.kind, ref: creditEvents.ref, userId: creditEvents.userId }).from(creditEvents);
    expect(refs.filter((row) => row.userId === null && (row.kind === "tailor" || row.kind === "chat"))).toEqual([
      { kind: "tailor", ref: null, userId: null },
      { kind: "chat", ref: null, userId: null },
    ]);
    expect(refs).toContainEqual({ kind: "refund", ref: "7d3c0d0e-1b2a-4c5d-8e9f-0a1b2c3d4e5f", userId: null });
    expect(refs).toContainEqual({ kind: "tailor", ref: "2026-10-29-globex-bbbbbbbb", userId: BOB });
  });

  it("leaves an ad started before the deletion with no account to grant to", async () => {
    await db.insert(adSessions).values({ id: AD_SESSION, userId: ADA, ip: "203.0.113.1", provider: "test", startedAt: NOON });
    await deleteAccount(db, ADA);

    const credits = new CreditsService(async () => db, { perAccountPerDay: 10, perIpPerDay: 30, minWatchSeconds: 7 });
    await expect(credits.grantVerifiedAd({ sessionId: AD_SESSION, transactionId: "tx1" }, new Date(NOON.getTime() + 60_000))).rejects.toMatchObject({
      status: 409,
    });
    expect(await db.select().from(creditEvents).where(eq(creditEvents.ref, AD_SESSION))).toEqual([]);
  });

  it("does nothing for an account that no longer exists", async () => {
    await deleteAccount(db, ADA);
    await expect(deleteAccount(db, ADA)).resolves.toBeUndefined();
    expect(await rowsOf(BOB)).toMatchObject({ user: [expect.objectContaining({ id: BOB })] });
  });
});
