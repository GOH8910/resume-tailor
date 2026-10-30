import Anthropic from "@anthropic-ai/sdk";
import type { ModelUsage } from "@/billing/usage-types";
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

  async chat(system: string, messages: ChatMessage[]): Promise<{ result: ChatResult; usage: ModelUsage }> {
    const { value, usage } = await createStructured(this.client, ChatResultSchema, {
      model: this.id,
      system,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      effort: "medium",
      maxTokens: 8000,
    });
    return { result: value, usage };
  }
}
