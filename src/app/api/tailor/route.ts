import { z } from "zod";
import { chooseModel } from "@/billing/plan";
import { currentPolicy } from "@/billing/policy";
import { ensureFreeUsageOpen, recordUsageOrLog } from "@/billing/usage";
import { hasApiKey } from "@/lib/anthropic";
import { AppError } from "@/lib/errors";
import { applications, banks, usage } from "@/lib/deps";
import { handle, readJson, requireUser } from "@/lib/http";
import { AnthropicTailorModel } from "@/tailor/anthropic-model";
import { MODEL_IDS } from "@/tailor/model";
import { runTailor } from "@/tailor/tailor";

const TailorRequestSchema = z.object({
  jobDescription: z.string(),
  company: z.string(),
  roleTitle: z.string().optional(),
  // Honoured only for plans that do not pay in credits; see chooseModel.
  model: z.enum(MODEL_IDS).optional(),
});

export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser(request);
    if (!hasApiKey()) {
      throw new AppError("The AI service is not configured on this server", 503);
    }
    const body = TailorRequestSchema.parse(await readJson(request));
    const policy = currentPolicy(user.plan);
    await ensureFreeUsageOpen(usage, policy);
    const model = new AnthropicTailorModel(chooseModel(policy, body.model));
    const result = await runTailor({ ...body, userId: user.id }, { banks, applications, model });
    await recordUsageOrLog(usage, { userId: user.id, kind: "tailor", usage: result.usage, free: policy.chargesCredits });
    return Response.json({ application: result.application }, { status: 201 });
  });
}
