import { z } from "zod";
import { ResumeStateSchema } from "@/applications/schema";
import { chooseModel } from "@/billing/plan";
import { currentPolicy } from "@/billing/policy";
import { AnthropicChatModel } from "@/chat/anthropic-chat-model";
import { runChat } from "@/chat/chat";
import { ChatMessageSchema } from "@/chat/schema";
import { runPaidCall } from "@/credits/money-path";
import { hasApiKey } from "@/lib/anthropic";
import { applications, banks, credits, usage } from "@/lib/deps";
import { env } from "@/lib/env";
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
    const model = new AnthropicChatModel(chooseModel(policy, body.model));
    const outcome = await runPaidCall(
      {
        user,
        policy,
        kind: "chat",
        cost: env.CREDITS_PER_CHAT_MESSAGE,
        ref: body.applicationId,
        call: async () => {
          const result = await runChat({ ...body, userId: user.id }, { banks, applications, model });
          return { value: result.outcome, usage: result.usage };
        },
      },
      { credits, usage },
    );
    return Response.json(outcome);
  });
}
