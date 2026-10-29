import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { settings, usageEvents, user } from "@/db/schema";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { ensureFreeUsageOpen, type PauseState, recordUsageOrLog, UsageService, type UsageSettings } from "./usage";
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
afterEach(async () => {
  vi.restoreAllMocks();
  await close();
});

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

  // Anthropic billed the call whether or not the account still exists.
  it("outlives the account as an anonymous row that still counts against the budget", async () => {
    const usage = service();
    await usage.record({ userId: ADA, kind: "tailor", usage: poundsOfSonnet(1), free: true }, NOON);
    await db.delete(user).where(eq(user.id, ADA));
    expect(await db.select().from(usageEvents)).toEqual([expect.objectContaining({ userId: null, costGbp: 1 })]);
    expect(await usage.freeSpendToday(NOON)).toBe(1);
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

  it("fails closed on a hand-written pause flag: anything but false pauses", async () => {
    const usage = service();
    const flag = (value: unknown) =>
      db.insert(settings).values({ key: "free_paused", value }).onConflictDoUpdate({ target: settings.key, set: { value } });
    for (const value of ["true", 1, true, "false"]) {
      await flag(value);
      expect(await usage.isFreeUsagePaused(NOON), JSON.stringify(value)).toEqual({ paused: true, reason: "manual" });
    }
    await flag(false);
    expect(await usage.isFreeUsagePaused(NOON)).toEqual({ paused: false });
    await db.delete(settings);
    expect(await usage.isFreeUsagePaused(NOON)).toEqual({ paused: false });
  });

  it("follows the SQL the operator runs by hand", async () => {
    const usage = service();
    const set = (value: "true" | "false") =>
      db.execute(
        sql.raw(`insert into settings (key, value) values ('free_paused', '${value}') on conflict (key) do update set value = excluded.value, updated_at = now()`),
      );
    await set("true");
    expect(await usage.isFreeUsagePaused(NOON)).toEqual({ paused: true, reason: "manual" });
    await set("false");
    expect(await usage.isFreeUsagePaused(NOON)).toEqual({ paused: false });
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
    const haiku = { model: "claude-haiku-5-5", inputTokens: 0, outputTokens: 200_000 }; // £0.10
    await usage.record({ userId: ADA, kind: "tailor", usage: haiku, free: true }, new Date("2026-10-28T12:00:00Z")); // before
    await usage.record({ userId: ADA, kind: "tailor", usage: haiku, free: true }, NOON);
    await usage.record({ userId: BOB, kind: "tailor", usage: haiku, free: true }, NOON);
    await usage.record({ userId: ADA, kind: "chat", usage: haiku, free: true }, NOON);
    await usage.record({ userId: ADA, kind: "tailor", usage: poundsOfSonnet(1), free: false }, NOON);

    const summary = await usage.summary({ since: new Date("2026-10-29T00:00:00Z") });

    expect(summary.totalGbp).toBe(1.3);
    expect(summary.freeGbp).toBe(0.3);
    const none = { cacheReadTokens: 0, cacheWriteTokens: 0 };
    expect(summary.rows).toEqual(
      expect.arrayContaining([
        { model: "claude-haiku-5-5", kind: "tailor", free: true, calls: 2, inputTokens: 0, outputTokens: 400_000, ...none, costGbp: 0.2 },
        { model: "claude-haiku-5-5", kind: "chat", free: true, calls: 1, inputTokens: 0, outputTokens: 200_000, ...none, costGbp: 0.1 },
        { model: "claude-sonnet-5-5", kind: "tailor", free: false, calls: 1, inputTokens: 0, outputTokens: 100_000, ...none, costGbp: 1 },
      ]),
    );
    expect(summary.rows).toHaveLength(3);
  });

  it("stops at `until` and totals cache tokens", async () => {
    const usage = service();
    const cached = { model: "claude-sonnet-5-5", inputTokens: 10, outputTokens: 20, cacheReadTokens: 30, cacheWriteTokens: 40 };
    await usage.record({ userId: ADA, kind: "chat", usage: cached, free: false }, new Date("2026-10-29T08:00:00Z"));
    await usage.record({ userId: ADA, kind: "chat", usage: cached, free: false }, new Date("2026-10-29T09:00:00Z"));
    await usage.record({ userId: ADA, kind: "chat", usage: cached, free: false }, NOON); // at `until`: excluded

    const summary = await usage.summary({ since: new Date("2026-10-29T00:00:00Z"), until: NOON });

    expect(summary.rows).toEqual([
      expect.objectContaining({ calls: 2, inputTokens: 20, outputTokens: 40, cacheReadTokens: 60, cacheWriteTokens: 80 }),
    ]);
  });
});

describe("ensureFreeUsageOpen", () => {
  const free = { chargesCredits: true };
  const refusal = async (state: PauseState) => {
    const err = await ensureFreeUsageOpen({ isFreeUsagePaused: async () => state }, free).catch((e: unknown) => e);
    return err as { status: number; message: string; details: unknown };
  };

  it("says when a spent budget lifts", async () => {
    const resumesAt = "2026-10-30T00:00:00.000Z";
    expect(await refusal({ paused: true, reason: "budget", resumesAt })).toMatchObject({
      status: 402,
      message: `Free AI features are paused until ${resumesAt} (daily budget reached)`,
      details: { paused: true, reason: "budget", resumesAt },
    });
  });

  it("says a budget of 0 keeps free usage paused", async () => {
    expect(await refusal({ paused: true, reason: "budget" })).toMatchObject({
      status: 402,
      message: "Free AI features are paused (daily budget is 0)",
      details: { paused: true, reason: "budget" },
    });
  });

  it("says the operator paused it", async () => {
    expect(await refusal({ paused: true, reason: "manual" })).toMatchObject({
      status: 402,
      message: "Free AI features are paused by the operator",
      details: { paused: true, reason: "manual" },
    });
  });

  it("lets the request through when open, and never asks for accounts that do not pay in credits", async () => {
    await expect(ensureFreeUsageOpen({ isFreeUsagePaused: async () => ({ paused: false }) }, free)).resolves.toBeUndefined();
    const isFreeUsagePaused = vi.fn();
    await expect(ensureFreeUsageOpen({ isFreeUsagePaused }, { chargesCredits: false })).resolves.toBeUndefined();
    expect(isFreeUsagePaused).not.toHaveBeenCalled();
  });
});

describe("recordUsageOrLog", () => {
  it("logs a failure to record with the model and token counts, without throwing", async () => {
    const failure = new Error("db down");
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const used = { model: "claude-haiku-5-5", inputTokens: 1234, outputTokens: 567, cacheReadTokens: 89 };
    await recordUsageOrLog({ record: async () => Promise.reject(failure) }, { userId: ADA, kind: "tailor", usage: used, free: true });
    expect(logged).toHaveBeenCalledOnce();
    const [line, err] = logged.mock.calls[0];
    expect(err).toBe(failure);
    for (const part of ["[usage]", ADA, "tailor", "claude-haiku-5-5", "1234", "567", "89"]) expect(line).toContain(part);
  });
});
