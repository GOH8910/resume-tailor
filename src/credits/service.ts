import { and, count, desc, eq, gte, inArray, lt, ne, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import { adSessions, creditEvents, userPlans } from "@/db/schema";
import type { Db } from "@/db/types";
import { AppError } from "@/lib/errors";
import { nextUtcDay, startOfUtcDay } from "./day";
import { type AdSessionStatus, type CreditKind, CREDITS_PER_AD } from "./types";

export type CreditsSettings = {
  /** Most ad credits one account may be granted per UTC day. */
  perAccountPerDay: number;
  /** Most ad credits all accounts behind one client IP may be granted per UTC day. */
  perIpPerDay: number;
  /** Least time between an ad session starting and its grant. */
  minWatchSeconds: number;
};

export type ChargeKind = Extract<CreditKind, "tailor" | "chat">;
export type LedgerEntry = { id: string; kind: CreditKind; amount: number; ref: string | null; createdAt: Date };

type CapScope = "account" | "ip";

/**
 * How long an ad session keeps its client IP. The per-IP cap only counts the current UTC day, so two days covers it
 * with room to spare; after that the IP is blanked ('').
 */
export const AD_IP_RETENTION_MS = 48 * 60 * 60 * 1000;

/** Rows one purge statement blanks; the purge repeats until a batch comes back short. */
export const IP_PURGE_BATCH = 500;

/**
 * The longest an ad session stays grantable. Far inside AD_IP_RETENTION_MS, so a session's IP is always still there
 * when it is granted and the per-IP cap never counts a grant under the blanked ('') IP that old sessions share.
 */
export const AD_SESSION_MAX_AGE_MS = 60 * 60 * 1000;

type GrantOutcome =
  | { kind: "granted"; userId: string; credits: number }
  | { kind: "not-pending" }
  | { kind: "too-brief" }
  | { kind: "limit"; scope: CapScope; resetsAt: string };

const isUuid = (value: string) => z.uuid().safeParse(value).success;

/**
 * The credits ledger and the rewarded-ad sessions that feed it. Every balance change writes a `credit_events` row
 * in the same transaction as the `user_plans.credits` update. `db` is a getter so the connection opens lazily.
 */
export class CreditsService {
  constructor(
    private readonly db: () => Promise<Db>,
    private readonly settings: CreditsSettings,
  ) {}

  async balance(userId: string): Promise<number> {
    const db = await this.db();
    const [row] = await db.select({ credits: userPlans.credits }).from(userPlans).where(eq(userPlans.userId, userId));
    return row?.credits ?? 0;
  }

  /** Ad credits granted to the account in the UTC day containing `now`. */
  async grantedToday(userId: string, now = new Date()): Promise<number> {
    return grantedOn(await this.db(), eq(adSessions.userId, userId), now);
  }

  /** Ad credits granted to every account behind `ip` in the UTC day containing `now`. */
  async grantedTodayByIp(ip: string, now = new Date()): Promise<number> {
    return grantedOn(await this.db(), eq(adSessions.ip, ip), now);
  }

  /** Opens a pending ad session, or refuses (429) once the account or its IP has today's ad credits. */
  async startAdSession(
    { userId, ip, provider }: { userId: string; ip: string; provider: string },
    now = new Date(),
  ): Promise<{ sessionId: string }> {
    const db = await this.db();
    try {
      await forgetOldIps(db, now);
    } catch (err) {
      // The hourly purge (src/credits/ip-purge.ts) catches up; an ad start must not fail on housekeeping.
      console.error("[credits] blanking old ad-session IPs failed during an ad start", err);
    }
    const scope = await this.capReached(db, userId, ip, now);
    if (scope) throw limitError(scope, now);
    const [row] = await db.insert(adSessions).values({ userId, ip, provider, startedAt: now }).returning({ id: adSessions.id });
    return { sessionId: row.id };
  }

  /** Grants the account's pending session one credit, when the client reports the ad as watched. */
  async grantAd({ userId, sessionId }: { userId: string; sessionId: string }, now = new Date()): Promise<{ credits: number }> {
    const { credits } = await this.grant({ sessionId, owner: userId }, now);
    return { credits };
  }

  /** Grants a pending session one credit for whichever account started it, on the ad network's verified callback. */
  async grantVerifiedAd(
    { sessionId, transactionId }: { sessionId: string; transactionId: string },
    now = new Date(),
  ): Promise<{ userId: string; credits: number }> {
    return this.grant({ sessionId, transactionId }, now);
  }

  /** The status of one of the account's sessions, for a client waiting on a verified callback. */
  async adSessionStatus(userId: string, sessionId: string): Promise<{ status: AdSessionStatus }> {
    const notFound = new AppError("Ad session not found", 404);
    if (!isUuid(sessionId)) throw notFound;
    const db = await this.db();
    const [row] = await db
      .select({ status: adSessions.status })
      .from(adSessions)
      .where(and(eq(adSessions.id, sessionId), eq(adSessions.userId, userId)));
    if (!row) throw notFound;
    return row;
  }

  /** Spends `amount` credits, or refuses (402) without writing anything when the balance is short. */
  async charge(
    { userId, amount, kind, ref }: { userId: string; amount: number; kind: ChargeKind; ref?: string },
    now = new Date(),
  ): Promise<{ credits: number; eventId: string | null }> {
    checkAmount(amount);
    if (amount === 0) return { credits: await this.balance(userId), eventId: null };
    const db = await this.db();
    const charged = await db.transaction(async (tx) => {
      // The condition makes the check and the debit one statement, so two charges cannot both spend the last credit.
      const [row] = await tx
        .update(userPlans)
        .set({ credits: sql`${userPlans.credits} - ${amount}` })
        .where(and(eq(userPlans.userId, userId), gte(userPlans.credits, amount)))
        .returning({ credits: userPlans.credits });
      if (!row) return undefined;
      const [event] = await tx
        .insert(creditEvents)
        .values({ userId, kind, amount: -amount, ref, createdAt: now })
        .returning({ id: creditEvents.id });
      return { credits: row.credits, eventId: event.id };
    });
    if (!charged) throw new AppError("Not enough credits", 402, { credits: await this.balance(userId), needed: amount });
    return charged;
  }

  /** Gives back credits a failed call was charged; `ref` names the charge. */
  async refund({ userId, amount, ref }: { userId: string; amount: number; ref?: string }, now = new Date()): Promise<{ credits: number }> {
    checkAmount(amount);
    if (amount === 0) return { credits: await this.balance(userId) };
    const db = await this.db();
    const credits = await db.transaction((tx) => addCredits(tx, { userId, amount, kind: "refund", ref, now }));
    return { credits };
  }

  /** Gives a new account its starting credits, once: a second call for the same account does nothing. */
  async grantSignup(userId: string, amount: number, now = new Date()): Promise<void> {
    checkAmount(amount);
    if (amount === 0) return;
    const db = await this.db();
    await db.transaction(async (tx) => {
      await lockAccount(tx, userId);
      const [granted] = await tx
        .select({ id: creditEvents.id })
        .from(creditEvents)
        .where(and(eq(creditEvents.userId, userId), eq(creditEvents.kind, "signup")))
        .limit(1);
      if (!granted) await addCredits(tx, { userId, amount, kind: "signup", now });
    });
  }

  /** The account's ledger, newest first. */
  async history(userId: string, limit: number): Promise<LedgerEntry[]> {
    const db = await this.db();
    return db
      .select({ id: creditEvents.id, kind: creditEvents.kind, amount: creditEvents.amount, ref: creditEvents.ref, createdAt: creditEvents.createdAt })
      .from(creditEvents)
      .where(eq(creditEvents.userId, userId))
      .orderBy(desc(creditEvents.createdAt), desc(creditEvents.id))
      .limit(limit);
  }

  /** `owner` is the signed-in account for a client-reported grant; a verified callback grants to whoever started the session. */
  private async grant(
    { sessionId, owner, transactionId }: { sessionId: string; owner?: string; transactionId?: string },
    now: Date,
  ): Promise<{ userId: string; credits: number }> {
    const db = await this.db();
    // Rejections are returned rather than thrown, so that marking the session rejected is committed.
    const outcome = isUuid(sessionId)
      ? await db.transaction((tx) => this.grantInTransaction(tx, { sessionId, owner, transactionId }, now))
      : ({ kind: "not-pending" } as const);
    switch (outcome.kind) {
      case "granted":
        return { userId: outcome.userId, credits: outcome.credits };
      case "not-pending":
        throw new AppError("Ad session is not pending", 409);
      case "too-brief":
        throw new AppError("The ad was closed too early", 409, { reason: "watched too briefly" });
      case "limit":
        throw new AppError("Daily ad limit reached", 429, { reason: outcome.scope, resetsAt: outcome.resetsAt });
    }
  }

  private async grantInTransaction(
    tx: Db,
    { sessionId, owner, transactionId }: { sessionId: string; owner?: string; transactionId?: string },
    now: Date,
  ): Promise<GrantOutcome> {
    const [session] = await tx.select().from(adSessions).where(eq(adSessions.id, sessionId)).for("update");
    const userId = session?.userId;
    if (!session || session.status !== "started" || !userId || (owner !== undefined && userId !== owner)) {
      return { kind: "not-pending" };
    }
    if (now.getTime() - session.startedAt.getTime() > AD_SESSION_MAX_AGE_MS) {
      await reject(tx, sessionId, "expired");
      return { kind: "not-pending" };
    }
    if (now.getTime() - session.startedAt.getTime() < this.settings.minWatchSeconds * 1000) {
      await reject(tx, sessionId, "watched too briefly");
      return { kind: "too-brief" };
    }
    // Serialise grants per account and per IP, so concurrent grants cannot each see room under a cap.
    await lockAccount(tx, userId);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`ad-ip:${session.ip}`}))`);
    const scope = await this.capReached(tx, userId, session.ip, now);
    if (scope) {
      await reject(tx, sessionId, "daily limit reached");
      return { kind: "limit", scope, resetsAt: nextUtcDay(now).toISOString() };
    }
    await tx.update(adSessions).set({ status: "granted", grantedAt: now, transactionId }).where(eq(adSessions.id, sessionId));
    const credits = await addCredits(tx, { userId, amount: CREDITS_PER_AD, kind: "ad", ref: sessionId, now });
    return { kind: "granted", userId, credits };
  }

  private async capReached(db: Db, userId: string, ip: string, now: Date): Promise<CapScope | undefined> {
    if ((await grantedOn(db, eq(adSessions.userId, userId), now)) >= this.settings.perAccountPerDay) return "account";
    if ((await grantedOn(db, eq(adSessions.ip, ip), now)) >= this.settings.perIpPerDay) return "ip";
    return undefined;
  }
}

async function grantedOn(db: Db, who: SQL, now: Date): Promise<number> {
  const [row] = await db
    .select({ granted: count() })
    .from(adSessions)
    .where(
      and(who, eq(adSessions.status, "granted"), gte(adSessions.grantedAt, startOfUtcDay(now)), lt(adSessions.grantedAt, nextUtcDay(now))),
    );
  return row?.granted ?? 0;
}

/**
 * Blanks the IP of sessions past the retention window, a batch at a time, and returns how many it blanked. Each batch
 * skips rows another transaction has locked (an account deletion, an ad grant), so the purge never waits on them and
 * cannot deadlock with them; a skipped row is blanked by a later run. The partial index on rows that still have an
 * IP keeps each batch cheap.
 */
export async function forgetOldIps(db: Db, now: Date): Promise<number> {
  let blanked = 0;
  for (;;) {
    const rows = await db
      .update(adSessions)
      .set({ ip: "" })
      .where(inArray(adSessions.id, oldIpBatch(db, now)))
      .returning({ id: adSessions.id });
    blanked += rows.length;
    if (rows.length < IP_PURGE_BATCH) return blanked;
  }
}

/** The next batch of sessions whose IP is due to be blanked, locked in id order (the order a deletion locks them). */
export function oldIpBatch(db: Db, now: Date) {
  return db
    .select({ id: adSessions.id })
    .from(adSessions)
    .where(and(lt(adSessions.startedAt, new Date(now.getTime() - AD_IP_RETENTION_MS)), ne(adSessions.ip, "")))
    .orderBy(adSessions.id)
    .limit(IP_PURGE_BATCH)
    .for("update", { skipLocked: true });
}

function limitError(scope: CapScope, now: Date): AppError {
  return new AppError("Daily ad limit reached", 429, { reason: scope, resetsAt: nextUtcDay(now).toISOString() });
}

function checkAmount(amount: number): void {
  if (!Number.isInteger(amount) || amount < 0) throw new Error(`Credit amount must be a whole number >= 0, got ${amount}`);
}

/** Creates the account's plan row if missing (as free) and locks it until the transaction ends. */
async function lockAccount(tx: Db, userId: string): Promise<void> {
  await tx.insert(userPlans).values({ userId, plan: "free" }).onConflictDoNothing();
  await tx.select({ userId: userPlans.userId }).from(userPlans).where(eq(userPlans.userId, userId)).for("update");
}

async function reject(tx: Db, sessionId: string, reason: string): Promise<void> {
  await tx.update(adSessions).set({ status: "rejected", rejectReason: reason }).where(eq(adSessions.id, sessionId));
}

/** Adds `amount` to the balance and writes its ledger row; the account must have a plan row. */
async function addCredits(
  tx: Db,
  { userId, amount, kind, ref, now }: { userId: string; amount: number; kind: CreditKind; ref?: string; now: Date },
): Promise<number> {
  const [row] = await tx
    .update(userPlans)
    .set({ credits: sql`${userPlans.credits} + ${amount}` })
    .where(eq(userPlans.userId, userId))
    .returning({ credits: userPlans.credits });
  if (!row) throw new Error(`No plan row to credit for user ${userId}`);
  await tx.insert(creditEvents).values({ userId, kind, amount, ref, createdAt: now });
  return row.credits;
}
