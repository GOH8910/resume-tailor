import { z } from "zod";
import { AppError } from "@/lib/errors";
import { applications, banks } from "@/lib/deps";
import { handle } from "@/lib/http";
import { AnthropicTailorModel, hasApiKey } from "@/tailor/anthropic-model";
import { DEFAULT_MODEL_ID, MODEL_IDS } from "@/tailor/model";
import { runTailor } from "@/tailor/tailor";

const TailorRequestSchema = z.object({
  profile: z.string(),
  jobDescription: z.string(),
  company: z.string(),
  roleTitle: z.string().optional(),
  model: z.enum(MODEL_IDS).default(DEFAULT_MODEL_ID),
});

export async function POST(request: Request) {
  return handle(async () => {
    if (!hasApiKey()) {
      throw new AppError("No Anthropic API key found. Put ANTHROPIC_API_KEY=... in .env.local and restart `npm run dev`.", 400);
    }
    const body = TailorRequestSchema.parse(await request.json());
    const application = await runTailor(body, { banks, applications, model: new AnthropicTailorModel(body.model) });
    return Response.json({ application }, { status: 201 });
  });
}
