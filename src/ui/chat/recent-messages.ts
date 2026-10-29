import type { ChatMessage } from "@/chat/schema";
import { MAX_CHAT_MESSAGES } from "@/lib/input-caps";

/**
 * The part of the conversation a chat request carries: the last MAX_CHAT_MESSAGES messages (Claude sees the bank
 * every time, so old turns matter less), starting with one of the user's, as Claude expects.
 */
export function recentMessages(history: ChatMessage[]): ChatMessage[] {
  const recent = history.slice(-MAX_CHAT_MESSAGES);
  const firstUser = recent.findIndex((message) => message.role === "user");
  return recent.slice(Math.max(0, firstUser)).map(({ role, content }) => ({ role, content }));
}
