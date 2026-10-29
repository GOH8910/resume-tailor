import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@/chat/schema";
import { recentMessages } from "./recent-messages";

const turns = (n: number): ChatMessage[] =>
  Array.from({ length: n }, (_, i) => ({ role: i % 2 === 0 ? "user" : "assistant", content: `m${i}` }));

describe("recentMessages", () => {
  it("sends a short conversation whole", () => {
    expect(recentMessages(turns(5))).toEqual(turns(5));
  });

  it("sends at most the last 20 messages, starting with one of the user's", () => {
    const history = turns(25);
    const sent = recentMessages(history);
    expect(sent.length).toBeLessThanOrEqual(20);
    expect(sent[0].role).toBe("user");
    expect(sent.at(-1)).toEqual(history.at(-1));
    expect(sent).toEqual(history.slice(6));
  });

  it("keeps 20 when the oldest of them is the user's", () => {
    // A failed send leaves two user messages in a row.
    const history: ChatMessage[] = [{ role: "user", content: "a" }, { role: "user", content: "b" }, ...turns(19)];
    expect(recentMessages(history)).toEqual(history.slice(1));
  });

  it("keeps only the role and the text", () => {
    const sent = recentMessages([{ role: "user", content: "hi", applied: ["x"] } as ChatMessage]);
    expect(sent).toEqual([{ role: "user", content: "hi" }]);
  });
});
