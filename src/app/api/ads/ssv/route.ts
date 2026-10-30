import { fetchSsvKeys, verifySsv } from "@/ads/ssv";
import { credits } from "@/lib/deps";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { handle } from "@/lib/http";

// The ad network's reward callback. Public (see src/proxy.ts): it carries no cookie, its signature is its proof.
// AdMob calls with GET; both methods are accepted until Ad Manager's web callback is confirmed in phase 2b.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return receive(request);
}

export async function POST(request: Request) {
  return receive(request);
}

/**
 * A callback that was checked answers 200, granted or not: a forged, replayed or refused reward is logged and
 * dropped. A failure to check it (keys or database unreachable) answers 500, so the network can retry.
 */
async function receive(request: Request): Promise<Response> {
  if (!env.AD_SSV_ENABLED) return Response.json({ error: "Server-side ad verification is not enabled" }, { status: 503 });
  return handle(async () => {
    const result = verifySsv(new URL(request.url), await fetchSsvKeys(env.AD_SSV_KEYS_URL));
    if (!result.ok) return ignored(result.reason);
    // custom_data carries the ad session id the client set on the ad slot.
    const sessionId = result.params.get("custom_data");
    const transactionId = result.params.get("transaction_id");
    if (!sessionId || !transactionId) return ignored("missing custom_data or transaction_id");
    try {
      await credits.grantVerifiedAd({ sessionId, transactionId });
    } catch (err) {
      if (isTransactionIdReused(err)) return ignored(`transaction_id already used (${transactionId})`);
      if (!(err instanceof AppError)) throw err;
      return ignored(`session ${sessionId}: ${err.message}`);
    }
    return new Response(null, { status: 200 });
  });
}

/** Postgres' unique violation on ad_sessions.transaction_id; drizzle wraps the driver's error as `cause`. */
function isTransactionIdReused(err: unknown): boolean {
  const cause = err instanceof Error ? (err.cause as { code?: unknown; constraint?: unknown } | undefined) : undefined;
  return cause?.code === "23505" && cause.constraint === "ad_sessions_transaction_id_unique";
}

function ignored(reason: string): Response {
  console.warn(`[ads] SSV callback ignored: ${reason}`);
  return new Response(null, { status: 200 });
}
