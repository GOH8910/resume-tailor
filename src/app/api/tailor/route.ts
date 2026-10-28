import { z } from "zod";
import { hasApiKey } from "@/lib/anthropic";
import { AppError } from "@/lib/errors";
import { applications, banks } from "@/lib/deps";
import { handle, readJson, requireUser } from "@/lib/http";
import { AnthropicTailorModel } from "@/tailor/anthropic-model";
import { DEFAULT_MODEL_ID, MODEL_IDS } from "@/tailor/model";
import { runTailor } from "@/tailor/tailor";

const TailorRequestSchema = z.object({
  jobDescription: z.string(),
  company: z.string(),
  roleTitle: z.string().optional(),
  model: z.enum(MODEL_IDS).default(DEFAULT_MODEL_ID),
});

export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser(request);
    if (!hasApiKey()) {
      throw new AppError("The AI service is not configured on this server", 503);
    }
    const body = TailorRequestSchema.parse(await readJson(request));
    const application = await runTailor({ ...body, userId: user.id }, { banks, applications, model: new AnthropicTailorModel(body.model) });
    return Response.json({ application }, { status: 201 });
  });
}
