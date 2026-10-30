import type { ChatMessage } from "@/chat/schema";
import { MAX_CHAT_MESSAGES, MAX_CHAT_TOTAL_CHARS } from "@/lib/input-caps";

/**
 * The part of the conversation a chat request carries: the most recent messages that fit the server's caps
 * (MAX_CHAT_MESSAGES, MAX_CHAT_TOTAL_CHARS; Claude sees the bank every time, so old turns matter less), starting
 * with one of the user's, as Claude expects.
 */
export function recentMessages(history: ChatMessage[]): ChatMessage[] {
  const recent = history.slice(-MAX_CHAT_MESSAGES);
  let start = recent.length;
  let total = 0;
  while (start > 0 && total + recent[start - 1].content.length <= MAX_CHAT_TOTAL_CHARS) {
    start--;
    total += recent[start].content.length;
  }
  const fitting = recent.slice(start);
  const firstUser = fitting.findIndex((message) => message.role === "user");
  return fitting.slice(Math.max(0, firstUser)).map(({ role, content }) => ({ role, content }));
}
