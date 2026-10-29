import { signupPlan } from "@/billing/plan";
import { currentPolicy, type Me } from "@/billing/policy";
import { plans } from "@/lib/deps";
import { env } from "@/lib/env";
import { handle, requireUser } from "@/lib/http";

export async function GET(request: Request) {
  return handle(async () => {
    const user = await requireUser(request);
    const { credits } = await plans.get(user.id, signupPlan(user.email, env.adminEmails));
    const me: Me = {
      email: user.email,
      plan: user.plan,
      mode: env.appMode,
      credits,
      policy: currentPolicy(user.plan),
      creditsPerTailor: env.CREDITS_PER_TAILOR,
      creditsPerChatMessage: env.CREDITS_PER_CHAT_MESSAGE,
    };
    return Response.json(me);
  });
}
