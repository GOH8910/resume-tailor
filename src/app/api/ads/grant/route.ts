import { z } from "zod";
import { currentPolicy, ensureAdsAvailable } from "@/billing/policy";
import { credits } from "@/lib/deps";
import { env } from "@/lib/env";
import { handle, readJson, requireUser } from "@/lib/http";

const GrantRequestSchema = z.object({ sessionId: z.uuid() });

/**
 * The client reports its ad as watched. Without server-side verification this grants the credit (bounded by the
 * daily caps and the minimum watch time); with it, only the network's callback grants, and this reports progress.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser(request);
    ensureAdsAvailable(currentPolicy(user.plan));
    const { sessionId } = GrantRequestSchema.parse(await readJson(request));
    if (env.AD_SSV_ENABLED) {
      const { status } = await credits.adSessionStatus(user.id, sessionId);
      return Response.json({ status, credits: await credits.balance(user.id) });
    }
    return Response.json(await credits.grantAd({ userId: user.id, sessionId }));
  });
}
