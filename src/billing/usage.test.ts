import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { usageEvents, user } from "@/db/schema";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { UsageService, type UsageSettings } from "./usage";
import type { ModelUsage } from "./usage-types";

let close: () => Promise<void>;
let db: Db;
const ADA = "user_ada";
const BOB = "user_bob";

// At a rate of 1, 100k Sonnet output tokens cost exactly £1.00 ($10 per million).
const SETTINGS: UsageSettings = { usdToGbp: 1, freeDailyBudgetGbp: 2 };
const poundsOfSonnet = (pounds: number): ModelUsage => ({ model: "claude-sonnet-5-5", inputTokens: 0, outputTokens: pounds * 100_000 });

const NOON = new Date("2026-10-29T12:00:00Z");

function service(settings: Partial<UsageSettings> = {}) {
  return new UsageService(async () => db, { ...SETTINGS, ...settings });
}

beforeEach(async () => {
  const t = await createTestDb();
  close = t.close;
  db = t.db;
  await db.insert(user).values([
    { id: ADA, name: "Ada", email: "ada@example.com" },
    { id: BOB, name: "Bob", email: "bob@example.com" },
  ]);
});
afterEach(() => close());

describe("UsageService.record", () => {
  it("stores the call with its tokens and its cost in GBP", async () => {
    const usage = new UsageService(async () => db, { usdToGbp: 0.78, freeDailyBudgetGbp: 2 });
    await usage.record({ userId: ADA, kind: "tailor", usage: { model: "claude-haiku-5-5", inputTokens: 10_000, outputTokens: 2_500 }, free: true }, NOON);

    const rows = await db.select().from(usageEvents);
    expect(rows).toEqual([
      expect.objectContaining({
        userId: ADA,
        kind: "tailor",
        model: "claude-haiku-5-5",
        inputTokens: 10_000,
        outputTokens: 2_500,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costGbp: 0.001755,
        free: true,
        createdAt: NOON,
      }),
    ]);
  });

  it("stores cache tokens and costs them", async () => {
    await service().record(
      { userId: ADA, kind: "chat", usage: { model: "claude-sonnet-5-5", inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000, cacheWriteTokens: 100_000 }, free: false },
      NOON,
    );
    const [row] = await db.select().from(usageEvents);
    expect(row).toMatchObject({ cacheReadTokens: 1_000_000, cacheWriteTokens: 100_000, costGbp: 0.45 });
  });

  it("refuses a kind the app does not know", async () => {
    await expect(
      db.execute(sql`insert into usage_events (user_id, kind, model, input_tokens, output_tokens, cost_gbp, free) values (${ADA}, 'other', 'm', 0, 0, 0, false)`),
    ).rejects.toThrow();
  });

  it("is deleted with the account", async () => {
    await service().record({ userId: ADA, kind: "tailor", usage: poundsOfSonnet(1), free: true }, NOON);
    await db.delete(user).where(eq(user.id, ADA));
    expect(await db.select().from(usageEvents)).toEqual([]);
  });
});

describe("UsageService.freeSpendToday", () => {
  it("sums free usage within the current UTC day, across accounts", async () => {
    const usage = service();
    const at = (iso: string, pounds: number, free = true, userId = ADA) =>
      usage.record({ userId, kind: "tailor", usage: poundsOfSonnet(pounds), free }, new Date(iso));
    await at("2026-10-28T23:59:59.999Z", 100); // yesterday
    await at("2026-10-29T00:00:00.000Z", 0.25);
    await at("2026-10-29T08:00:00.000Z", 0.5, true, BOB);
    await at("2026-10-29T09:00:00.000Z", 100, false); // not free
    await at("2026-10-29T23:59:59.000Z", 0.125);
    await at("2026-10-30T00:00:00.000Z", 100); // tomorrow

    expect(await usage.freeSpendToday(NOON)).toBe(0.875);
  });

  it("is zero on a day without free usage", async () => {
    expect(await service().freeSpendToday(NOON)).toBe(0);
  });
});

describe("UsageService.isFreeUsagePaused", () => {
  it("is open while the day's free spend is under the budget", async () => {
    const usage = service();
    await usage.record({ userId: ADA, kind: "tailor", usage: poundsOfSonnet(1.5), free: true }, NOON);
    expect(await usage.isFreeUsagePaused(NOON)).toEqual({ paused: false });
  });

  it("pauses once the day's free spend reaches the budget, until the next UTC day", async () => {
    const usage = service();
    await usage.record({ userId: ADA, kind: "tailor", usage: poundsOfSonnet(1.5), free: true }, NOON);
    await usage.record({ userId: BOB, kind: "chat", usage: poundsOfSonnet(0.5), free: true }, NOON);

    expect(await usage.isFreeUsagePaused(NOON)).toEqual({ paused: true, reason: "budget", resumesAt: "2026-10-30T00:00:00.000Z" });
    expect(await usage.isFreeUsagePaused(new Date("2026-10-29T23:59:59.999Z"))).toMatchObject({ paused: true });
    expect(await usage.isFreeUsagePaused(new Date("2026-10-30T00:00:00.000Z"))).toEqual({ paused: false });
  });

  it("does not count usage that was not free", async () => {
    const usage = service();
    await usage.record({ userId: ADA, kind: "tailor", usage: poundsOfSonnet(50), free: false }, NOON);
    expect(await usage.isFreeUsagePaused(NOON)).toEqual({ paused: false });
  });

  it("treats a budget of 0 as free usage switched off, with no time it resumes", async () => {
    expect(await service({ freeDailyBudgetGbp: 0 }).isFreeUsagePaused(NOON)).toEqual({ paused: true, reason: "budget" });
  });

  it("pauses by hand until resumed by hand, ahead of the budget", async () => {
    const usage = service();
    await usage.setFreePaused(true);
    expect(await usage.isFreeUsagePaused(NOON)).toEqual({ paused: true, reason: "manual" });

    await usage.record({ userId: ADA, kind: "tailor", usage: poundsOfSonnet(5), free: true }, NOON);
    expect(await usage.isFreeUsagePaused(NOON)).toEqual({ paused: true, reason: "manual" });

    await usage.setFreePaused(false);
    expect(await usage.isFreeUsagePaused(NOON)).toMatchObject({ paused: true, reason: "budget" });
    expect(await usage.isFreeUsagePaused(new Date("2026-10-30T09:00:00Z"))).toEqual({ paused: false });
  });
});

describe("UsageService.summary", () => {
  it("totals usage since a time by model, kind and whether it was free", async () => {
    const usage = service();
    const haiku = { model: "claude-haiku-5-5", inputTokens: 1_000_000, outputTokens: 0 }; // £0.10
    await usage.record({ userId: ADA, kind: "tailor", usage: haiku, free: true }, new Date("2026-10-28T12:00:00Z")); // before
    await usage.record({ userId: ADA, kind: "tailor", usage: haiku, free: true }, NOON);
    await usage.record({ userId: BOB, kind: "tailor", usage: haiku, free: true }, NOON);
    await usage.record({ userId: ADA, kind: "chat", usage: haiku, free: true }, NOON);
    await usage.record({ userId: ADA, kind: "tailor", usage: poundsOfSonnet(1), free: false }, NOON);

    const summary = await usage.summary({ since: new Date("2026-10-29T00:00:00Z") });

    expect(summary.totalGbp).toBe(1.3);
    expect(summary.freeGbp).toBe(0.3);
    expect(summary.rows).toEqual(
      expect.arrayContaining([
        { model: "claude-haiku-5-5", kind: "tailor", free: true, calls: 2, inputTokens: 2_000_000, outputTokens: 0, costGbp: 0.2 },
        { model: "claude-haiku-5-5", kind: "chat", free: true, calls: 1, inputTokens: 1_000_000, outputTokens: 0, costGbp: 0.1 },
        { model: "claude-sonnet-5-5", kind: "tailor", free: false, calls: 1, inputTokens: 0, outputTokens: 100_000, costGbp: 1 },
      ]),
    );
    expect(summary.rows).toHaveLength(3);
  });
});
