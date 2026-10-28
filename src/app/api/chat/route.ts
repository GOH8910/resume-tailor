import { z } from "zod";
import { ResumeStateSchema } from "@/applications/schema";
import { AnthropicChatModel } from "@/chat/anthropic-chat-model";
import { runChat } from "@/chat/chat";
import { ChatMessageSchema } from "@/chat/schema";
import { hasApiKey } from "@/lib/anthropic";
import { applications, banks } from "@/lib/deps";
import { AppError } from "@/lib/errors";
import { handle, readJson, requireUser } from "@/lib/http";
import { DEFAULT_MODEL_ID, MODEL_IDS } from "@/tailor/model";

const ChatRequestSchema = z.object({
  applicationId: z.string().optional(),
  resume: ResumeStateSchema.optional(),
  messages: z.array(ChatMessageSchema).min(1),
  model: z.enum(MODEL_IDS).default(DEFAULT_MODEL_ID),
});

export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser(request);
    if (!hasApiKey()) {
      throw new AppError("The AI service is not configured on this server", 503);
    }
    const body = ChatRequestSchema.parse(await readJson(request));
    const outcome = await runChat({ ...body, userId: user.id }, { banks, applications, model: new AnthropicChatModel(body.model) });
    return Response.json(outcome);
  });
}
