import { z } from "zod";
import { JobInputSchema, requireRoomForApplication } from "@/applications/input";
import { chooseModel } from "@/billing/plan";
import { currentPolicy } from "@/billing/policy";
import { runPaidCall } from "@/credits/money-path";
import { hasApiKey } from "@/lib/anthropic";
import { applications, banks, credits, usage } from "@/lib/deps";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { handle, readJson, requireUser } from "@/lib/http";
import { limitUser } from "@/lib/limits";
import { AnthropicTailorModel } from "@/tailor/anthropic-model";
import { MODEL_IDS } from "@/tailor/model";
import { cleanTailorInput, runTailor } from "@/tailor/tailor";

const TailorRequestSchema = JobInputSchema.extend({
  // Honoured only for plans that do not pay in credits; see chooseModel.
  model: z.enum(MODEL_IDS).optional(),
});

export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser(request);
    limitUser("tailor", user);
    if (!hasApiKey()) {
      throw new AppError("The AI service is not configured on this server", 503);
    }
    const body = TailorRequestSchema.parse(await readJson(request));
    cleanTailorInput(body);
    await requireRoomForApplication(applications, user.id);
    const policy = currentPolicy(user.plan);
    const model = new AnthropicTailorModel(chooseModel(policy, body.model));
    const { value: application, credits: balance } = await runPaidCall(
      {
        user,
        policy,
        kind: "tailor",
        cost: env.CREDITS_PER_TAILOR,
        call: async () => {
          const result = await runTailor({ ...body, userId: user.id }, { banks, applications, model });
          return { value: result.application, usage: result.usage };
        },
      },
      { credits, usage },
    );
    // `credits` is the balance after the charge, left out (undefined) when the plan does not pay in credits.
    return Response.json({ application, credits: balance }, { status: 201 });
  });
}
