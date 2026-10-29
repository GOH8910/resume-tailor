import { and, eq, gte, lt, sql } from "drizzle-orm";
import { nextUtcDay, startOfUtcDay } from "@/credits/day";
import { settings, usageEvents } from "@/db/schema";
import type { Db } from "@/db/types";
import { AppError } from "@/lib/errors";
import { estimateCostGbp, roundGbp } from "./costs";
import type { PlanPolicy } from "./plan";
import type { ModelUsage, UsageKind } from "./usage-types";

export type UsageSettings = {
  usdToGbp: number;
  /** Free usage pauses for the rest of the UTC day once its cost reaches this; 0 keeps it paused. */
  freeDailyBudgetGbp: number;
};

export type UsageEvent = {
  userId: string;
  kind: UsageKind;
  usage: ModelUsage;
  /** Paid for with free credits, so it counts against the daily budget. */
  free: boolean;
};

export type PauseState = { paused: boolean; reason?: "budget" | "manual"; resumesAt?: string };

export type UsageTotals = { calls: number; inputTokens: number; outputTokens: number; costGbp: number };
export type UsageSummaryRow = { model: string; kind: UsageKind; free: boolean } & UsageTotals;
export type UsageSummary = { rows: UsageSummaryRow[]; totalGbp: number; freeGbp: number };

const FREE_PAUSED_KEY = "free_paused";

/** The costed ledger of Claude calls and the free-usage switch built on it. `db` is a getter so the connection opens lazily. */
export class UsageService {
  constructor(
    private readonly db: () => Promise<Db>,
    private readonly settings: UsageSettings,
  ) {}

  async record(event: UsageEvent, now = new Date()): Promise<void> {
    const db = await this.db();
    const { usage } = event;
    await db.insert(usageEvents).values({
      userId: event.userId,
      kind: event.kind,
      model: usage.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens ?? 0,
      cacheWriteTokens: usage.cacheWriteTokens ?? 0,
      costGbp: estimateCostGbp(usage.model, usage, this.settings.usdToGbp),
      free: event.free,
      createdAt: now,
    });
  }

  /** The cost of free usage in the UTC day containing `now`. */
  async freeSpendToday(now = new Date()): Promise<number> {
    const db = await this.db();
    const [row] = await db
      .select({ total: sql<number>`coalesce(sum(${usageEvents.costGbp}), 0)`.mapWith(Number) })
      .from(usageEvents)
      .where(
        and(eq(usageEvents.free, true), gte(usageEvents.createdAt, startOfUtcDay(now)), lt(usageEvents.createdAt, nextUtcDay(now))),
      );
    return roundGbp(row?.total ?? 0);
  }

  /**
   * Whether free accounts are refused AI calls right now: paused by the operator, or the day's free spend has
   * reached the budget (which lifts at the next UTC midnight). The check is not atomic with the calls it gates,
   * so concurrent requests can overshoot the budget by a few calls.
   */
  async isFreeUsagePaused(now = new Date()): Promise<PauseState> {
    if (await this.isPausedByHand()) return { paused: true, reason: "manual" };
    const budget = this.settings.freeDailyBudgetGbp;
    if (budget === 0) return { paused: true, reason: "budget" };
    if ((await this.freeSpendToday(now)) >= budget) {
      return { paused: true, reason: "budget", resumesAt: nextUtcDay(now).toISOString() };
    }
    return { paused: false };
  }

  async setFreePaused(paused: boolean): Promise<void> {
    const db = await this.db();
    await db
      .insert(settings)
      .values({ key: FREE_PAUSED_KEY, value: paused })
      .onConflictDoUpdate({ target: settings.key, set: { value: paused, updatedAt: new Date() } });
  }

  /** Usage since `since`, grouped by model, kind and whether it was free. */
  async summary({ since }: { since: Date }): Promise<UsageSummary> {
    const db = await this.db();
    const rows = await db
      .select({
        model: usageEvents.model,
        kind: usageEvents.kind,
        free: usageEvents.free,
        calls: sql<number>`count(*)`.mapWith(Number),
        inputTokens: sql<number>`coalesce(sum(${usageEvents.inputTokens}), 0)`.mapWith(Number),
        outputTokens: sql<number>`coalesce(sum(${usageEvents.outputTokens}), 0)`.mapWith(Number),
        costGbp: sql<number>`coalesce(sum(${usageEvents.costGbp}), 0)`.mapWith(Number),
      })
      .from(usageEvents)
      .where(gte(usageEvents.createdAt, since))
      .groupBy(usageEvents.model, usageEvents.kind, usageEvents.free);
    const sum = (list: UsageSummaryRow[]) => roundGbp(list.reduce((total, row) => total + row.costGbp, 0));
    return { rows, totalGbp: sum(rows), freeGbp: sum(rows.filter((row) => row.free)) };
  }

  private async isPausedByHand(): Promise<boolean> {
    const db = await this.db();
    const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, FREE_PAUSED_KEY));
    return row?.value === true;
  }
}

/** Refuses (402) an AI request paid for with free credits while free usage is paused. */
export async function ensureFreeUsageOpen(
  usage: Pick<UsageService, "isFreeUsagePaused">,
  policy: Pick<PlanPolicy, "chargesCredits">,
): Promise<void> {
  if (!policy.chargesCredits) return;
  const state = await usage.isFreeUsagePaused();
  if (!state.paused) return;
  const message = state.resumesAt
    ? `Free tailoring is paused until ${state.resumesAt} (daily budget reached)`
    : "Free tailoring is paused by the operator";
  throw new AppError(message, 402, { paused: true, reason: state.reason, resumesAt: state.resumesAt });
}

/** Books a Claude call. The user has already been served by then, so a failure to book is logged, not thrown. */
export async function recordUsageOrLog(usage: Pick<UsageService, "record">, event: UsageEvent): Promise<void> {
  try {
    await usage.record(event);
  } catch (err) {
    console.error(`[usage] could not record a ${event.kind} call on ${event.usage.model} for user ${event.userId}`, err);
  }
}
