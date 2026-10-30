import { adClientConfig } from "@/ads/client-config";
import { currentPolicy, type Me } from "@/billing/policy";
import { credits } from "@/lib/deps";
import { env } from "@/lib/env";
import { handle, isAdminEmail, requireUser } from "@/lib/http";

export async function GET(request: Request) {
  return handle(async () => {
    const user = await requireUser(request);
    const me: Me = {
      email: user.email,
      plan: user.plan,
      mode: env.appMode,
      credits: await credits.balance(user.id),
      policy: currentPolicy(user.plan),
      creditsPerTailor: env.CREDITS_PER_TAILOR,
      creditsPerChatMessage: env.CREDITS_PER_CHAT_MESSAGE,
      adsAvailable: env.adProvider !== "none",
      ads: adClientConfig(),
      isAdmin: isAdminEmail(user.email),
    };
    return Response.json(me);
  });
}
