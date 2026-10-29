import Anthropic from "@anthropic-ai/sdk";
import { createStructured } from "@/lib/anthropic";
import type { ChatModel } from "./model";
import { type ChatMessage, type ChatResult, ChatResultSchema } from "./schema";

export class AnthropicChatModel implements ChatModel {
  private readonly client: Anthropic;

  constructor(
    readonly id: string,
    client?: Anthropic,
  ) {
    this.client = client ?? new Anthropic();
  }

  chat(system: string, messages: ChatMessage[]): Promise<ChatResult> {
    return createStructured(this.client, ChatResultSchema, {
      model: this.id,
      system,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      effort: "medium",
      maxTokens: 8000,
    });
  }
}
