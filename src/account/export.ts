import { and, asc, eq, gt, sql } from "drizzle-orm";
import type { Plan } from "@/billing/plan";
import type { UsageKind } from "@/billing/usage-types";
import type { AdSessionStatus, CreditKind } from "@/credits/types";
import { account as signInAccounts, adSessions, applications, banks, creditEvents, session, usageEvents, user, userPlans } from "@/db/schema";
import type { Db } from "@/db/types";

/** Applications read per query: one can be up to 700 KB of JSON. */
export const APPLICATION_BATCH = 10;

/** How long the stream waits for the browser to read the next piece before ending the download. */
export const EXPORT_IDLE_MS = 60_000;

/** What "Download my data" hands the account holder. Dates are ISO strings. */
export type AccountExport = {
  exportedAt: string;
  email: string;
  profile: { name: string; image: string | null; createdAt: string } | null;
  plan: { plan: Plan; credits: number } | null;
  /** How the account signs in (magic link, Google); never the tokens. */
  signIns: Array<{ providerId: string; accountId: string; createdAt: string }>;
  /** The signed-in browsers; never the session tokens. */
  sessions: Array<{ createdAt: string; expiresAt: string; ipAddress: string | null; userAgent: string | null }>;
  /** The whole credits ledger, oldest first. */
  credits: Array<{ kind: CreditKind; amount: number; ref: string | null; createdAt: string }>;
  /** Every rewarded ad started; `ip` is blank once older than the per-IP cap needs. */
  adSessions: Array<{ startedAt: string; grantedAt: string | null; status: AdSessionStatus; rejectReason: string | null; ip: string }>;
  /** Every Claude call made for the account, costed at list prices. */
  usage: Array<{
    kind: UsageKind;
    model: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    costGbp: number;
    createdAt: string;
  }>;
  /** The bank as stored, or null if the account never had one. */
  bank: unknown;
  /** Each tailored resume with its job description, as stored, in id order. */
  applications: unknown[];
};

type Account = { id: string; email: string };

/**
 * The export as a stream of compact JSON (the AccountExport shape). Everything but the applications is read before the
 * stream is handed out, so a failure there is still an ordinary error response; the applications follow a batch at a
 * time, each as the database stores it (`data::text`, never parsed), so a large account is never in memory whole.
 * PDFs are left out: they compile again from the JSON. `onEnd` runs once, when the stream ends, fails, is cancelled
 * or goes unread for EXPORT_IDLE_MS (a stalled browser would otherwise hold its export slot for good).
 */
export async function exportStream(db: Db, account: Account, onEnd: () => void, now = new Date()): Promise<ReadableStream<Uint8Array>> {
  const pieces = exportPieces(db, account, now);
  const first = await pieces.next();
  const encoder = new TextEncoder();
  let ended = false;
  // Set when the browser abandons the download or stops reading: a batch still being read then has nowhere to go.
  let abandoned = false;
  let idle: ReturnType<typeof setTimeout> | undefined;
  const end = () => {
    if (ended) return;
    ended = true;
    onEnd();
  };
  const stopWaiting = () => {
    clearTimeout(idle);
    idle = undefined;
  };
  // Runs while a piece waits in the queue; a read (pull) stops it.
  const waitForRead = (controller: ReadableStreamDefaultController<Uint8Array>) => {
    stopWaiting();
    idle = setTimeout(() => {
      idle = undefined;
      abandoned = true;
      end();
      console.warn(`[account] a data export went unread for ${EXPORT_IDLE_MS / 1000} s and was ended`);
      controller.error(new Error("The download stalled"));
      void pieces.return(undefined);
    }, EXPORT_IDLE_MS);
  };
  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (!first.done) controller.enqueue(encoder.encode(first.value));
      waitForRead(controller);
    },
    async pull(controller) {
      stopWaiting();
      try {
        const next = await pieces.next();
        if (abandoned) return;
        if (next.done) {
          end();
          controller.close();
        } else {
          controller.enqueue(encoder.encode(next.value));
          waitForRead(controller);
        }
      } catch (err) {
        end();
        if (abandoned) return;
        // Driver errors carry SQL and bound parameters in their message: log the cause, as handle() does.
        console.error("[account] a data export failed part-way", err instanceof Error && err.cause ? err.cause : err);
        controller.error(err);
      }
    },
    async cancel() {
      abandoned = true;
      stopWaiting();
      end();
      await pieces.return(undefined);
    },
  });
}

async function* exportPieces(db: Db, account: Account, now: Date): AsyncGenerator<string> {
  yield await head(db, account, now);
  let after: string | undefined;
  for (;;) {
    const rows = await db
      .select({ id: applications.id, data: sql<string>`${applications.data}::text` })
      .from(applications)
      .where(and(eq(applications.userId, account.id), after === undefined ? undefined : gt(applications.id, after)))
      .orderBy(asc(applications.id))
      .limit(APPLICATION_BATCH);
    if (rows.length > 0) yield (after === undefined ? "" : ",") + rows.map((row) => row.data).join(",");
    if (rows.length < APPLICATION_BATCH) break;
    after = rows[rows.length - 1].id;
  }
  yield "]}";
}

/** The opening of the JSON object: every field but the applications, then the start of their array. */
async function head(db: Db, account: Account, now: Date): Promise<string> {
  const [profile] = await db.select({ name: user.name, image: user.image, createdAt: user.createdAt }).from(user).where(eq(user.id, account.id));
  const [plan] = await db.select({ plan: userPlans.plan, credits: userPlans.credits }).from(userPlans).where(eq(userPlans.userId, account.id));
  const signIns = await db
    .select({ providerId: signInAccounts.providerId, accountId: signInAccounts.accountId, createdAt: signInAccounts.createdAt })
    .from(signInAccounts)
    .where(eq(signInAccounts.userId, account.id))
    .orderBy(asc(signInAccounts.createdAt));
  const sessions = await db
    .select({ createdAt: session.createdAt, expiresAt: session.expiresAt, ipAddress: session.ipAddress, userAgent: session.userAgent })
    .from(session)
    .where(eq(session.userId, account.id))
    .orderBy(asc(session.createdAt));
  const credits = await db
    .select({ kind: creditEvents.kind, amount: creditEvents.amount, ref: creditEvents.ref, createdAt: creditEvents.createdAt })
    .from(creditEvents)
    .where(eq(creditEvents.userId, account.id))
    .orderBy(asc(creditEvents.createdAt), asc(creditEvents.id));
  const ads = await db
    .select({
      startedAt: adSessions.startedAt,
      grantedAt: adSessions.grantedAt,
      status: adSessions.status,
      rejectReason: adSessions.rejectReason,
      ip: adSessions.ip,
    })
    .from(adSessions)
    .where(eq(adSessions.userId, account.id))
    .orderBy(asc(adSessions.startedAt), asc(adSessions.id));
  const usage = await db
    .select({
      kind: usageEvents.kind,
      model: usageEvents.model,
      inputTokens: usageEvents.inputTokens,
      outputTokens: usageEvents.outputTokens,
      cacheReadTokens: usageEvents.cacheReadTokens,
      cacheWriteTokens: usageEvents.cacheWriteTokens,
      costGbp: usageEvents.costGbp,
      createdAt: usageEvents.createdAt,
    })
    .from(usageEvents)
    .where(eq(usageEvents.userId, account.id))
    .orderBy(asc(usageEvents.createdAt), asc(usageEvents.id));
  const [bank] = await db.select({ data: sql<string>`${banks.data}::text` }).from(banks).where(eq(banks.userId, account.id));
  // JSON.stringify writes the Dates as ISO strings. The object's closing brace makes way for the bank and applications.
  const fields = JSON.stringify({
    exportedAt: now,
    email: account.email,
    profile: profile ?? null,
    plan: plan ?? null,
    signIns,
    sessions,
    credits,
    adSessions: ads,
    usage,
  });
  return `${fields.slice(0, -1)},"bank":${bank?.data ?? "null"},"applications":[`;
}
