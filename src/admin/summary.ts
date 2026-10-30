import { and, gte, lt, type SQL, sql } from "drizzle-orm";
import { roundGbp } from "@/billing/costs";
import type { UsageService, UsageSummary } from "@/billing/usage";
import type { UsageKind } from "@/billing/usage-types";
import { nextUtcDay, startOfUtcDay } from "@/credits/day";
import { adSessions, creditEvents } from "@/db/schema";
import type { Db } from "@/db/types";

type CallTotals = { calls: number; costGbp: number };

/** Costed Claude calls over a period, most expensive first within each breakdown. */
export type UsageBreakdown = {
  calls: number;
  costGbp: number;
  /** The part paid for with free credits, which counts against the daily budget. */
  freeCostGbp: number;
  byModel: Array<{ model: string } & CallTotals>;
  byKind: Array<{ kind: UsageKind } & CallTotals>;
};

/** What `/admin` shows. Days and months are UTC, like the budget and the ad caps. */
export type AdminSummary = {
  today: UsageBreakdown;
  month: UsageBreakdown;
  /** Credits earned today (ads, sign-up grants, adjustments) and spent today, net of refunds. */
  credits: { grantedToday: number; spentToday: number };
  /** Ad sessions started today, all of them and by how they ended. */
  ads: { startedToday: number; grantedToday: number; rejectedToday: number };
  budget: { limitGbp: number; spentGbp: number; paused: boolean; reason: "budget" | "manual" | null; resumesAt: string | null };
  /** Whether the operator has paused free usage by hand (the switch on /admin). */
  manualPause: boolean;
};

type Deps = {
  db: Db;
  usage: Pick<UsageService, "summary" | "freeSpendToday" | "isFreeUsagePaused">;
  freeDailyBudgetGbp: number;
};

export async function adminSummary({ db, usage, freeDailyBudgetGbp }: Deps, now = new Date()): Promise<AdminSummary> {
  const day = { since: startOfUtcDay(now), until: nextUtcDay(now) };
  const [today, month, credits, ads, spentGbp, pause] = await Promise.all([
    usage.summary(day),
    usage.summary({ since: startOfUtcMonth(now), until: day.until }),
    creditsOn(db, day),
    adsOn(db, day),
    usage.freeSpendToday(now),
    usage.isFreeUsagePaused(now),
  ]);
  return {
    today: breakdown(today),
    month: breakdown(month),
    credits,
    ads,
    budget: { limitGbp: freeDailyBudgetGbp, spentGbp, paused: pause.paused, reason: pause.reason ?? null, resumesAt: pause.resumesAt ?? null },
    // The hand-set switch is checked before the budget, so a "manual" reason means it is on.
    manualPause: pause.reason === "manual",
  };
}

function startOfUtcMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function breakdown(summary: UsageSummary): UsageBreakdown {
  return {
    calls: summary.rows.reduce((total, row) => total + row.calls, 0),
    costGbp: summary.totalGbp,
    freeCostGbp: summary.freeGbp,
    byModel: totalsBy(summary.rows, (row) => row.model).map(([model, totals]) => ({ model, ...totals })),
    byKind: totalsBy(summary.rows, (row) => row.kind).map(([kind, totals]) => ({ kind, ...totals })),
  };
}

function totalsBy<K extends string>(rows: UsageSummary["rows"], key: (row: UsageSummary["rows"][number]) => K): Array<[K, CallTotals]> {
  const totals = new Map<K, CallTotals>();
  for (const row of rows) {
    const current = totals.get(key(row)) ?? { calls: 0, costGbp: 0 };
    totals.set(key(row), { calls: current.calls + row.calls, costGbp: roundGbp(current.costGbp + row.costGbp) });
  }
  return [...totals].sort(([, a], [, b]) => b.costGbp - a.costGbp);
}

type Day = { since: Date; until: Date };

async function creditsOn(db: Db, { since, until }: Day): Promise<AdminSummary["credits"]> {
  const total = (filter: SQL) => sql<number>`coalesce(sum(${creditEvents.amount}) filter (where ${filter}), 0)`.mapWith(Number);
  const [row] = await db
    .select({
      granted: total(sql`${creditEvents.kind} in ('ad', 'signup', 'admin') and ${creditEvents.amount} > 0`),
      // Charges are negative and refunds positive, so their sum is minus what was really spent.
      charged: total(sql`${creditEvents.kind} in ('tailor', 'chat', 'refund')`),
    })
    .from(creditEvents)
    .where(and(gte(creditEvents.createdAt, since), lt(creditEvents.createdAt, until)));
  const charged = row?.charged ?? 0;
  return { grantedToday: row?.granted ?? 0, spentToday: charged === 0 ? 0 : -charged };
}

async function adsOn(db: Db, { since, until }: Day): Promise<AdminSummary["ads"]> {
  const count = (filter?: SQL) =>
    (filter ? sql<number>`count(*) filter (where ${filter})` : sql<number>`count(*)`).mapWith(Number);
  const [row] = await db
    .select({
      started: count(),
      granted: count(sql`${adSessions.status} = 'granted'`),
      rejected: count(sql`${adSessions.status} = 'rejected'`),
    })
    .from(adSessions)
    .where(and(gte(adSessions.startedAt, since), lt(adSessions.startedAt, until)));
  return { startedToday: row?.started ?? 0, grantedToday: row?.granted ?? 0, rejectedToday: row?.rejected ?? 0 };
}
