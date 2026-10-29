import { currentPolicy, ensureAdsAvailable } from "@/billing/policy";
import { credits } from "@/lib/deps";
import { env } from "@/lib/env";
import { clientIp, handle, requireUser } from "@/lib/http";

/** Opens an ad session for the client to show a rewarded ad against. */
export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser(request);
    ensureAdsAvailable(currentPolicy(user.plan));
    const session = await credits.startAdSession({ userId: user.id, ip: clientIp(request), provider: env.adProvider });
    return Response.json(session);
  });
}
