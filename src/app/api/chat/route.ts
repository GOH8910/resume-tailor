import { z } from "zod";
import { ResumeStateSchema } from "@/applications/schema";
import { AnthropicChatModel } from "@/chat/anthropic-chat-model";
import { runChat } from "@/chat/chat";
import { ChatMessageSchema } from "@/chat/schema";
import { hasApiKey } from "@/lib/anthropic";
import { applications, banks } from "@/lib/deps";
import { AppError } from "@/lib/errors";
import { handle, readJson } from "@/lib/http";
import { DEFAULT_MODEL_ID, MODEL_IDS } from "@/tailor/model";

const ChatRequestSchema = z.object({
  profile: z.string(),
  applicationId: z.string().optional(),
  resume: ResumeStateSchema.optional(),
  messages: z.array(ChatMessageSchema).min(1),
  model: z.enum(MODEL_IDS).default(DEFAULT_MODEL_ID),
});

export async function POST(request: Request) {
  return handle(async () => {
    if (!hasApiKey()) {
      throw new AppError("No Anthropic API key found. Put ANTHROPIC_API_KEY=... in .env.local and restart npm run dev.", 400);
    }
    const body = ChatRequestSchema.parse(await readJson(request));
    const outcome = await runChat({ ...body, userId: body.profile }, { banks, applications, model: new AnthropicChatModel(body.model) });
    return Response.json(outcome);
  });
}
