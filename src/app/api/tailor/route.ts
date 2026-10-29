import { z } from "zod";
import { chooseModel } from "@/billing/plan";
import { currentPolicy } from "@/billing/policy";
import { hasApiKey } from "@/lib/anthropic";
import { AppError } from "@/lib/errors";
import { applications, banks } from "@/lib/deps";
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
    const model = new AnthropicTailorModel(chooseModel(currentPolicy(user.plan), body.model));
    const application = await runTailor({ ...body, userId: user.id }, { banks, applications, model });
    return Response.json({ application }, { status: 201 });
  });
}
