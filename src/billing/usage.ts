import { and, eq, gte, lt, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { nextUtcDay, startOfUtcDay } from "@/credits/day";
import { FOREIGN_KEY_VIOLATION, pgErrorCode } from "@/db/errors";
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
  /** One account's free usage pauses for the rest of the UTC day once its own cost reaches this; 0 keeps it paused. */
  freeDailyCostPerAccountGbp: number;
};

export type UsageEvent = {
  /** Null for a call whose account was deleted while it ran. */
  userId: string | null;
  kind: UsageKind;
  usage: ModelUsage;
  /** Paid for with free credits, so it counts against the daily budget. */
  free: boolean;
};

/** Whether free usage is paused for every account, and why. */
export type PauseState = { paused: boolean; reason?: "budget" | "manual"; resumesAt?: string };
/** For one account: also paused (`account`) once it reached its own daily cap. */
export type AccountPauseState = Omit<PauseState, "reason"> & { reason?: PauseState["reason"] | "account" };

export type UsageTotals = {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costGbp: number;
};
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

  /** The cost of free usage in the UTC day containing `now`, for every account or for one. */
  async freeSpendToday(now = new Date(), userId?: string): Promise<number> {
    const db = await this.db();
    const [row] = await db
      .select({ total: sql<number>`coalesce(sum(${usageEvents.costGbp}), 0)`.mapWith(Number) })
      .from(usageEvents)
      .where(
        and(
          eq(usageEvents.free, true),
          userId === undefined ? undefined : eq(usageEvents.userId, userId),
          gte(usageEvents.createdAt, startOfUtcDay(now)),
          lt(usageEvents.createdAt, nextUtcDay(now)),
        ),
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

  /**
   * Whether one account is refused free AI calls right now: free usage is paused for everyone, or the account's own
   * free spend today has reached its cap, so a single account cannot use up the whole day's budget.
   */
  async isFreeUsagePausedFor(userId: string, now = new Date()): Promise<AccountPauseState> {
    const everyone = await this.isFreeUsagePaused(now);
    if (everyone.paused) return everyone;
    const cap = this.settings.freeDailyCostPerAccountGbp;
    if (cap === 0) return { paused: true, reason: "account" };
    if ((await this.freeSpendToday(now, userId)) >= cap) {
      return { paused: true, reason: "account", resumesAt: nextUtcDay(now).toISOString() };
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

  /** Usage from `since` up to (not including) `until`, grouped by model, kind and whether it was free. */
  async summary({ since, until }: { since: Date; until?: Date }): Promise<UsageSummary> {
    const db = await this.db();
    const total = (column: AnyPgColumn) => sql<number>`coalesce(sum(${column}), 0)`.mapWith(Number);
    const rows = await db
      .select({
        model: usageEvents.model,
        kind: usageEvents.kind,
        free: usageEvents.free,
        calls: sql<number>`count(*)`.mapWith(Number),
        inputTokens: total(usageEvents.inputTokens),
        outputTokens: total(usageEvents.outputTokens),
        cacheReadTokens: total(usageEvents.cacheReadTokens),
        cacheWriteTokens: total(usageEvents.cacheWriteTokens),
        costGbp: total(usageEvents.costGbp),
      })
      .from(usageEvents)
      .where(and(gte(usageEvents.createdAt, since), until ? lt(usageEvents.createdAt, until) : undefined))
      .groupBy(usageEvents.model, usageEvents.kind, usageEvents.free);
    const sum = (list: UsageSummaryRow[]) => roundGbp(list.reduce((total, row) => total + row.costGbp, 0));
    return { rows, totalGbp: sum(rows), freeGbp: sum(rows.filter((row) => row.free)) };
  }

  // Fails closed: the row may be written by hand in psql, so any value but jsonb `false` (1, the string "false")
  // pauses. Compared in SQL because drizzle parses a jsonb string a second time on read, turning "false" into false.
  private async isPausedByHand(): Promise<boolean> {
    const db = await this.db();
    const [row] = await db
      .select({ paused: sql<boolean>`${settings.value} <> 'false'::jsonb` })
      .from(settings)
      .where(eq(settings.key, FREE_PAUSED_KEY));
    return row?.paused ?? false;
  }
}

/** Refuses (402) an AI request paid for with free credits while free usage is paused for everyone or for the account. */
export async function ensureFreeUsageOpen(
  usage: Pick<UsageService, "isFreeUsagePausedFor">,
  policy: Pick<PlanPolicy, "chargesCredits">,
  userId: string,
): Promise<void> {
  if (!policy.chargesCredits) return;
  const state = await usage.isFreeUsagePausedFor(userId);
  if (!state.paused) return;
  throw new AppError(pausedMessage(state), 402, { paused: true, reason: state.reason, resumesAt: state.resumesAt });
}

function pausedMessage(state: AccountPauseState): string {
  if (state.reason === "manual") return "Free AI features are paused by the operator";
  if (state.reason === "account") {
    const limit = "You've reached today's free AI limit for this account";
    return state.resumesAt ? `${limit}; it resets at ${state.resumesAt}` : limit;
  }
  return state.resumesAt
    ? `Free AI features are paused until ${state.resumesAt} (daily budget reached)`
    : "Free AI features are paused (daily budget is 0)";
}

/** Books a Claude call. The user has already been served by then, so a failure to book is logged, not thrown. */
export async function recordUsageOrLog(usage: Pick<UsageService, "record">, event: UsageEvent): Promise<void> {
  try {
    await recordEvenWithoutAccount(usage, event);
  } catch (err) {
    const { model, inputTokens, outputTokens, cacheReadTokens = 0, cacheWriteTokens = 0 } = event.usage;
    console.error(
      `[usage] could not record a ${event.kind} call for user ${event.userId}: model=${model} input=${inputTokens} ` +
        `output=${outputTokens} cacheRead=${cacheReadTokens} cacheWrite=${cacheWriteTokens} free=${event.free}`,
      err,
    );
  }
}

/** Anthropic billed the call even if the account was deleted while it ran: then it is booked without the account. */
async function recordEvenWithoutAccount(usage: Pick<UsageService, "record">, event: UsageEvent): Promise<void> {
  try {
    await usage.record(event);
  } catch (err) {
    if (event.userId === null || pgErrorCode(err) !== FOREIGN_KEY_VIOLATION) throw err;
    await usage.record({ ...event, userId: null });
  }
}
