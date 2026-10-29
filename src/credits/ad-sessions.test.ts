import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { adSessions, creditEvents, user, userPlans } from "@/db/schema";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { CreditsService, type CreditsSettings } from "./service";

let close: () => Promise<void>;
let db: Db;
const ADA = "user_ada";
const BOB = "user_bob";
const CAROL = "user_carol";
const HOME = "203.0.113.1";
const CAFE = "198.51.100.7";

const NOON = new Date("2026-10-29T12:00:00Z");
const later = (from: Date, seconds: number) => new Date(from.getTime() + seconds * 1000);
const SETTINGS: CreditsSettings = { perAccountPerDay: 2, perIpPerDay: 3, minWatchSeconds: 7 };

function service(settings: Partial<CreditsSettings> = {}) {
  return new CreditsService(async () => db, { ...SETTINGS, ...settings });
}

beforeEach(async () => {
  const t = await createTestDb();
  close = t.close;
  db = t.db;
  await db.insert(user).values([
    { id: ADA, name: "Ada", email: "ada@example.com" },
    { id: BOB, name: "Bob", email: "bob@example.com" },
    { id: CAROL, name: "Carol", email: "carol@example.com" },
  ]);
  await db.insert(userPlans).values([{ userId: ADA }, { userId: BOB }, { userId: CAROL }]);
});
afterEach(() => close());

const session = async (id: string) => (await db.select().from(adSessions).where(eq(adSessions.id, id)))[0];

/** Starts an ad at `at` and grants it after the minimum watch time; returns the grant. */
async function watchAd(credits: CreditsService, userId: string, ip: string, at = NOON) {
  const { sessionId } = await credits.startAdSession({ userId, ip, provider: "test" }, at);
  return credits.grantAd({ userId, sessionId }, later(at, 7));
}

describe("CreditsService ad sessions", () => {
  it("starts a pending session for the account and IP", async () => {
    const { sessionId } = await service().startAdSession({ userId: ADA, ip: HOME, provider: "test" }, NOON);
    expect(await session(sessionId)).toMatchObject({
      userId: ADA,
      ip: HOME,
      provider: "test",
      status: "started",
      startedAt: NOON,
      grantedAt: null,
    });
  });

  it("grants one credit once the ad has been watched long enough, with a ledger row naming the session", async () => {
    const credits = service();
    const { sessionId } = await credits.startAdSession({ userId: ADA, ip: HOME, provider: "test" }, NOON);
    expect(await credits.grantAd({ userId: ADA, sessionId }, later(NOON, 7))).toEqual({ credits: 1 });
    expect(await session(sessionId)).toMatchObject({ status: "granted", grantedAt: later(NOON, 7) });
    expect(await db.select().from(creditEvents)).toEqual([
      expect.objectContaining({ userId: ADA, kind: "ad", amount: 1, ref: sessionId }),
    ]);
    expect(await credits.balance(ADA)).toBe(1);
  });

  it("rejects a grant before the minimum watch time and keeps the session rejected", async () => {
    const credits = service();
    const { sessionId } = await credits.startAdSession({ userId: ADA, ip: HOME, provider: "test" }, NOON);
    await expect(credits.grantAd({ userId: ADA, sessionId }, later(NOON, 6.9))).rejects.toMatchObject({
      status: 409,
      details: { reason: "watched too briefly" },
    });
    expect(await session(sessionId)).toMatchObject({ status: "rejected", rejectReason: "watched too briefly" });
    await expect(credits.grantAd({ userId: ADA, sessionId }, later(NOON, 60))).rejects.toMatchObject({ status: 409 });
    expect(await credits.balance(ADA)).toBe(0);
  });

  it("grants a session only once", async () => {
    const credits = service();
    const { sessionId } = await credits.startAdSession({ userId: ADA, ip: HOME, provider: "test" }, NOON);
    await credits.grantAd({ userId: ADA, sessionId }, later(NOON, 7));
    await expect(credits.grantAd({ userId: ADA, sessionId }, later(NOON, 8))).rejects.toMatchObject({
      status: 409,
      message: "Ad session is not pending",
    });
    expect(await credits.balance(ADA)).toBe(1);
  });

  // PGlite has one connection and runs transactions one after another, so this checks the logic (the second
  // grant sees the session already granted), not Postgres row locking under real parallelism.
  it("grants a session once when two grants race", async () => {
    const credits = service();
    const { sessionId } = await credits.startAdSession({ userId: ADA, ip: HOME, provider: "test" }, NOON);
    const results = await Promise.allSettled([
      credits.grantAd({ userId: ADA, sessionId }, later(NOON, 7)),
      credits.grantAd({ userId: ADA, sessionId }, later(NOON, 7)),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(await credits.balance(ADA)).toBe(1);
  });

  it("refuses to grant another account's session and leaves it pending", async () => {
    const credits = service();
    const { sessionId } = await credits.startAdSession({ userId: ADA, ip: HOME, provider: "test" }, NOON);
    await expect(credits.grantAd({ userId: BOB, sessionId }, later(NOON, 7))).rejects.toMatchObject({ status: 409 });
    expect(await session(sessionId)).toMatchObject({ status: "started" });
    expect(await credits.balance(BOB)).toBe(0);
  });

  it("answers an unknown or malformed session id with the same 409", async () => {
    const credits = service();
    for (const sessionId of ["00000000-0000-4000-8000-000000000000", "not-a-uuid"]) {
      await expect(credits.grantAd({ userId: ADA, sessionId }, NOON)).rejects.toMatchObject({ status: 409 });
    }
  });

  it("reports a session's status to its owner only", async () => {
    const credits = service();
    const { sessionId } = await credits.startAdSession({ userId: ADA, ip: HOME, provider: "test" }, NOON);
    expect(await credits.adSessionStatus(ADA, sessionId)).toEqual({ status: "started" });
    await expect(credits.adSessionStatus(BOB, sessionId)).rejects.toMatchObject({ status: 404 });
    await expect(credits.adSessionStatus(ADA, "not-a-uuid")).rejects.toMatchObject({ status: 404 });
  });
});

describe("CreditsService daily ad caps", () => {
  it("refuses a new ad once the account has its daily credits, until the next UTC day", async () => {
    const credits = service();
    await watchAd(credits, ADA, HOME);
    await watchAd(credits, ADA, CAFE);
    expect(await credits.grantedToday(ADA, NOON)).toBe(2);

    await expect(credits.startAdSession({ userId: ADA, ip: CAFE, provider: "test" }, later(NOON, 60))).rejects.toMatchObject({
      status: 429,
      message: "Daily ad limit reached",
      details: { reason: "account", resetsAt: "2026-10-30T00:00:00.000Z" },
    });
    const tomorrow = new Date("2026-10-30T00:00:00Z");
    expect(await credits.grantedToday(ADA, tomorrow)).toBe(0);
    await expect(watchAd(credits, ADA, HOME, tomorrow)).resolves.toEqual({ credits: 3 });
  });

  it("counts a grant on the UTC day it was granted", async () => {
    const credits = service({ perAccountPerDay: 1 });
    const beforeMidnight = new Date("2026-10-29T23:59:55Z");
    const { sessionId } = await credits.startAdSession({ userId: ADA, ip: HOME, provider: "test" }, beforeMidnight);
    await credits.grantAd({ userId: ADA, sessionId }, later(beforeMidnight, 7));
    expect(await credits.grantedToday(ADA, beforeMidnight)).toBe(0);
    expect(await credits.grantedToday(ADA, new Date("2026-10-30T12:00:00Z"))).toBe(1);
  });

  it("refuses a new ad once the IP has its daily credits across accounts", async () => {
    const credits = service();
    await watchAd(credits, ADA, HOME);
    await watchAd(credits, ADA, HOME);
    await watchAd(credits, BOB, HOME);
    expect(await credits.grantedTodayByIp(HOME, NOON)).toBe(3);

    await expect(credits.startAdSession({ userId: CAROL, ip: HOME, provider: "test" }, NOON)).rejects.toMatchObject({
      status: 429,
      details: { reason: "ip", resetsAt: "2026-10-30T00:00:00.000Z" },
    });
    await expect(watchAd(credits, CAROL, CAFE)).resolves.toEqual({ credits: 1 });
  });

  it("re-checks the caps when granting, so sessions started under the cap cannot overshoot it", async () => {
    const credits = service();
    await watchAd(credits, ADA, HOME);
    const first = await credits.startAdSession({ userId: ADA, ip: HOME, provider: "test" }, NOON);
    const second = await credits.startAdSession({ userId: ADA, ip: HOME, provider: "test" }, NOON);

    await credits.grantAd({ userId: ADA, sessionId: first.sessionId }, later(NOON, 7));
    await expect(credits.grantAd({ userId: ADA, sessionId: second.sessionId }, later(NOON, 7))).rejects.toMatchObject({
      status: 429,
      details: { reason: "account" },
    });
    expect(await session(second.sessionId)).toMatchObject({ status: "rejected", rejectReason: "daily limit reached" });
    expect(await credits.balance(ADA)).toBe(2);
  });

  it("re-checks the IP cap when granting, across accounts", async () => {
    const credits = service({ perIpPerDay: 1 });
    const ada = await credits.startAdSession({ userId: ADA, ip: HOME, provider: "test" }, NOON);
    const bob = await credits.startAdSession({ userId: BOB, ip: HOME, provider: "test" }, NOON);

    await credits.grantAd({ userId: ADA, sessionId: ada.sessionId }, later(NOON, 7));
    await expect(credits.grantAd({ userId: BOB, sessionId: bob.sessionId }, later(NOON, 7))).rejects.toMatchObject({
      status: 429,
      details: { reason: "ip", resetsAt: "2026-10-30T00:00:00.000Z" },
    });
    expect(await session(bob.sessionId)).toMatchObject({ status: "rejected", rejectReason: "daily limit reached" });
    expect(await credits.balance(BOB)).toBe(0);
  });

  it("refuses every ad when a cap is 0", async () => {
    await expect(service({ perIpPerDay: 0 }).startAdSession({ userId: ADA, ip: HOME, provider: "test" }, NOON)).rejects.toMatchObject({
      status: 429,
    });
  });

  it("keeps counting a deleted account's grants against its IP", async () => {
    const credits = service();
    await watchAd(credits, ADA, HOME);
    await watchAd(credits, ADA, HOME);
    await watchAd(credits, BOB, HOME);
    await db.delete(user).where(eq(user.id, ADA));
    expect(await credits.grantedTodayByIp(HOME, NOON)).toBe(3);
  });
});

describe("CreditsService.grantVerifiedAd", () => {
  it("grants the session to the account that started it and stores the network's transaction id", async () => {
    const credits = service();
    const { sessionId } = await credits.startAdSession({ userId: ADA, ip: HOME, provider: "google" }, NOON);
    expect(await credits.grantVerifiedAd({ sessionId, transactionId: "tx-1" }, later(NOON, 30))).toEqual({ userId: ADA, credits: 1 });
    expect(await session(sessionId)).toMatchObject({ status: "granted", transactionId: "tx-1" });
  });

  it("ignores a replayed callback for the same session", async () => {
    const credits = service();
    const { sessionId } = await credits.startAdSession({ userId: ADA, ip: HOME, provider: "google" }, NOON);
    await credits.grantVerifiedAd({ sessionId, transactionId: "tx-1" }, later(NOON, 30));
    await expect(credits.grantVerifiedAd({ sessionId, transactionId: "tx-1" }, later(NOON, 31))).rejects.toMatchObject({ status: 409 });
    expect(await credits.balance(ADA)).toBe(1);
  });

  it("refuses a transaction id already used by another session, granting nothing", async () => {
    const credits = service();
    const first = await credits.startAdSession({ userId: ADA, ip: HOME, provider: "google" }, NOON);
    const second = await credits.startAdSession({ userId: BOB, ip: CAFE, provider: "google" }, NOON);
    await credits.grantVerifiedAd({ sessionId: first.sessionId, transactionId: "tx-1" }, later(NOON, 30));
    // The SSV route recognises this shape (drizzle's wrapper, the driver's error as its cause) as a replay.
    await expect(credits.grantVerifiedAd({ sessionId: second.sessionId, transactionId: "tx-1" }, later(NOON, 30))).rejects.toMatchObject({
      cause: { code: "23505", constraint: "ad_sessions_transaction_id_unique" },
    });
    expect(await session(second.sessionId)).toMatchObject({ status: "started" });
    expect(await credits.balance(BOB)).toBe(0);
  });
});
