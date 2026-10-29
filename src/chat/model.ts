import type { ModelUsage } from "@/billing/usage-types";
import type { ChatMessage, ChatResult } from "./schema";

export interface ChatModel {
  readonly id: string;
  chat(system: string, messages: ChatMessage[]): Promise<{ result: ChatResult; usage: ModelUsage }>;
}
