import { z } from "zod";
import { ResumeStateInputSchema } from "@/applications/schema";
import { chooseModel } from "@/billing/plan";
import { currentPolicy } from "@/billing/policy";
import { AnthropicChatModel } from "@/chat/anthropic-chat-model";
import { checkChatMessages, runChat } from "@/chat/chat";
import { ChatMessagesSchema } from "@/chat/schema";
import { runPaidCall } from "@/credits/money-path";
import { hasApiKey } from "@/lib/anthropic";
import { applications, banks, credits, usage } from "@/lib/deps";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { handle, readJson, requireUser } from "@/lib/http";
import { limitUser } from "@/lib/limits";
import { MODEL_IDS } from "@/tailor/model";

const ChatRequestSchema = z.object({
  applicationId: z.string().optional(),
  resume: ResumeStateInputSchema.optional(),
  messages: ChatMessagesSchema,
  // Honoured only for plans that do not pay in credits; see chooseModel.
  model: z.enum(MODEL_IDS).optional(),
});

export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser(request);
    limitUser("chat", user);
    if (!hasApiKey()) {
      throw new AppError("The AI service is not configured on this server", 503);
    }
    const body = ChatRequestSchema.parse(await readJson(request));
    checkChatMessages(body.messages);
    const policy = currentPolicy(user.plan);
    const model = new AnthropicChatModel(chooseModel(policy, body.model));
    const { value: outcome, credits: balance } = await runPaidCall(
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
    // `credits` is the balance after the charge, left out (undefined) when the plan does not pay in credits.
    return Response.json({ ...outcome, credits: balance });
  });
}
