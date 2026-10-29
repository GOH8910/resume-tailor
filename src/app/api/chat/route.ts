import { z } from "zod";
import { ResumeStateSchema } from "@/applications/schema";
import { chooseModel } from "@/billing/plan";
import { currentPolicy } from "@/billing/policy";
import { ensureFreeUsageOpen, recordUsageOrLog } from "@/billing/usage";
import { AnthropicChatModel } from "@/chat/anthropic-chat-model";
import { runChat } from "@/chat/chat";
import { ChatMessageSchema } from "@/chat/schema";
import { hasApiKey } from "@/lib/anthropic";
import { applications, banks, usage } from "@/lib/deps";
import { AppError } from "@/lib/errors";
import { handle, readJson, requireUser } from "@/lib/http";
import { MODEL_IDS } from "@/tailor/model";

const ChatRequestSchema = z.object({
  applicationId: z.string().optional(),
  resume: ResumeStateSchema.optional(),
  messages: z.array(ChatMessageSchema).min(1),
  // Honoured only for plans that do not pay in credits; see chooseModel.
  model: z.enum(MODEL_IDS).optional(),
});

export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser(request);
    if (!hasApiKey()) {
      throw new AppError("The AI service is not configured on this server", 503);
    }
    const body = ChatRequestSchema.parse(await readJson(request));
    const policy = currentPolicy(user.plan);
    await ensureFreeUsageOpen(usage, policy);
    const model = new AnthropicChatModel(chooseModel(policy, body.model));
    const result = await runChat({ ...body, userId: user.id }, { banks, applications, model });
    await recordUsageOrLog(usage, { userId: user.id, kind: "chat", usage: result.usage, free: policy.chargesCredits });
    return Response.json(result.outcome);
  });
}
