import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UsageService } from "@/billing/usage";
import { adSessions, creditEvents, usageEvents, user } from "@/db/schema";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { adminSummary } from "./summary";

let close: () => Promise<void>;
let db: Db;
const ADA = "user_ada";
const NOON = new Date("2026-10-29T12:00:00Z");
const YESTERDAY = new Date("2026-10-28T23:59:59Z");
const EARLIER_THIS_MONTH = new Date("2026-10-05T08:00:00Z");
const LAST_MONTH = new Date("2026-09-30T23:59:59Z");
const HAIKU = "claude-haiku-5-5";
const SONNET = "claude-sonnet-5-5";

const usage = () => new UsageService(async () => db, { usdToGbp: 1, freeDailyBudgetGbp: 2, freeDailyCostPerAccountGbp: 1 });
const summarise = (budgetGbp = 2) => adminSummary({ db, usage: usage(), freeDailyBudgetGbp: budgetGbp }, NOON);

async function call(model: string, kind: "tailor" | "chat", costGbp: number, free: boolean, createdAt: Date) {
  await db.insert(usageEvents).values({ userId: ADA, kind, model, inputTokens: 1, outputTokens: 1, costGbp, free, createdAt });
}

beforeEach(async () => {
  const t = await createTestDb();
  close = t.close;
  db = t.db;
  await db.insert(user).values({ id: ADA, name: "Ada", email: "ada@example.com" });
});
afterEach(() => close());

describe("adminSummary", () => {
  it("totals today's and this month's costed calls by model and by kind", async () => {
    await call(HAIKU, "tailor", 0.01, true, NOON);
    await call(HAIKU, "tailor", 0.01, true, YESTERDAY);
    await call(SONNET, "chat", 0.5, false, NOON);
    await call(HAIKU, "tailor", 0.02, true, EARLIER_THIS_MONTH);
    await call(SONNET, "tailor", 9, false, LAST_MONTH);

    const { today, month } = await summarise();

    expect(today).toEqual({
      calls: 2,
      costGbp: 0.51,
      freeCostGbp: 0.01,
      byModel: [
        { model: SONNET, calls: 1, costGbp: 0.5 },
        { model: HAIKU, calls: 1, costGbp: 0.01 },
      ],
      byKind: [
        { kind: "chat", calls: 1, costGbp: 0.5 },
        { kind: "tailor", calls: 1, costGbp: 0.01 },
      ],
    });
    expect(month).toEqual({
      calls: 4,
      costGbp: 0.54,
      freeCostGbp: 0.04,
      byModel: [
        { model: SONNET, calls: 1, costGbp: 0.5 },
        { model: HAIKU, calls: 3, costGbp: 0.04 },
      ],
      byKind: [
        { kind: "chat", calls: 1, costGbp: 0.5 },
        { kind: "tailor", calls: 3, costGbp: 0.04 },
      ],
    });
  });

  it("counts today's credits granted and spent net of refunds, including deleted accounts' rows", async () => {
    const event = (kind: "ad" | "signup" | "tailor" | "chat" | "refund", amount: number, createdAt = NOON, userId: string | null = ADA) => ({
      userId,
      kind,
      amount,
      createdAt,
    });
    await db.insert(creditEvents).values([
      event("signup", 4),
      event("ad", 1),
      event("ad", 1),
      event("ad", 1, NOON, null),
      event("tailor", -2),
      event("tailor", -2),
      event("chat", -1),
      event("refund", 2),
      event("ad", 1, YESTERDAY),
      event("tailor", -2, YESTERDAY),
    ]);

    expect((await summarise()).credits).toEqual({ grantedToday: 7, spentToday: 3 });
  });

  it("counts the ad sessions started today by how they ended", async () => {
    const ad = (status: "started" | "granted" | "rejected", startedAt = NOON) => ({ userId: ADA, ip: "203.0.113.1", provider: "test", status, startedAt });
    await db.insert(adSessions).values([ad("started"), ad("granted"), ad("granted"), ad("rejected"), ad("granted", YESTERDAY)]);

    expect((await summarise()).ads).toEqual({ startedToday: 4, grantedToday: 2, rejectedToday: 1 });
  });

  it("reports the budget and an open free tier", async () => {
    await call(HAIKU, "tailor", 0.25, true, NOON);

    const summary = await summarise();

    expect(summary.budget).toEqual({ limitGbp: 2, spentGbp: 0.25, paused: false, reason: null, resumesAt: null });
    expect(summary.manualPause).toBe(false);
  });

  it("reports a spent budget, which lifts at midnight UTC", async () => {
    await call(HAIKU, "tailor", 2, true, NOON);

    const summary = await summarise();

    expect(summary.budget).toEqual({ limitGbp: 2, spentGbp: 2, paused: true, reason: "budget", resumesAt: "2026-10-30T00:00:00.000Z" });
    expect(summary.manualPause).toBe(false);
  });

  it("reports a pause by hand", async () => {
    await usage().setFreePaused(true);

    const summary = await summarise();

    expect(summary.budget).toMatchObject({ paused: true, reason: "manual", resumesAt: null });
    expect(summary.manualPause).toBe(true);
  });

  it("is all zeros on a quiet day", async () => {
    expect(await summarise()).toEqual({
      today: { calls: 0, costGbp: 0, freeCostGbp: 0, byModel: [], byKind: [] },
      month: { calls: 0, costGbp: 0, freeCostGbp: 0, byModel: [], byKind: [] },
      credits: { grantedToday: 0, spentToday: 0 },
      ads: { startedToday: 0, grantedToday: 0, rejectedToday: 0 },
      budget: { limitGbp: 2, spentGbp: 0, paused: false, reason: null, resumesAt: null },
      manualPause: false,
    });
  });
});
