import type { ChatMessage, ChatResult } from "./schema";

export interface ChatModel {
  readonly id: string;
  chat(system: string, messages: ChatMessage[]): Promise<ChatResult>;
}
