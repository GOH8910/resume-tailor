import { z } from "zod";
import { ResumeStateSchema } from "@/applications/schema";
import { chooseModel } from "@/billing/plan";
import { currentPolicy } from "@/billing/policy";
import { AnthropicChatModel } from "@/chat/anthropic-chat-model";
import { runChat } from "@/chat/chat";
import { ChatMessageSchema } from "@/chat/schema";
import { hasApiKey } from "@/lib/anthropic";
import { applications, banks } from "@/lib/deps";
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
    const model = new AnthropicChatModel(chooseModel(currentPolicy(user.plan), body.model));
    const outcome = await runChat({ ...body, userId: user.id }, { banks, applications, model });
    return Response.json(outcome);
  });
}
