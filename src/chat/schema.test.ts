import { describe, expect, it } from "vitest";
import { ChatMessageSchema, ChatMessagesSchema } from "./schema";

const user = (content: string) => ({ role: "user" as const, content });
const assistant = (content: string) => ({ role: "assistant" as const, content });

describe("ChatMessageSchema", () => {
  it("accepts a user message of 4,000 characters and refuses 4,001", () => {
    expect(ChatMessageSchema.safeParse(user("x".repeat(4_000))).success).toBe(true);
    const long = ChatMessageSchema.safeParse(user("x".repeat(4_001)));
    expect(long.success).toBe(false);
    if (!long.success) expect(long.error.issues[0]).toMatchObject({ path: ["content"], message: "A message can be at most 4,000 characters" });
  });

  it("allows Claude's own longer replies in the history, up to 16,000 characters", () => {
    expect(ChatMessageSchema.safeParse(assistant("x".repeat(16_000))).success).toBe(true);
    const long = ChatMessageSchema.safeParse(assistant("x".repeat(16_001)));
    expect(long.success).toBe(false);
    if (!long.success) expect(long.error.issues[0]).toMatchObject({ path: ["content"], message: "A message can be at most 16,000 characters" });
  });
});

describe("ChatMessagesSchema", () => {
  it("accepts 1 to 20 messages", () => {
    expect(ChatMessagesSchema.safeParse([]).success).toBe(false);
    expect(ChatMessagesSchema.safeParse([user("hi")]).success).toBe(true);
    expect(ChatMessagesSchema.safeParse(Array.from({ length: 20 }, () => user("hi"))).success).toBe(true);
    expect(ChatMessagesSchema.safeParse(Array.from({ length: 21 }, () => user("hi"))).success).toBe(false);
  });

  it("caps the conversation at 40,000 characters in total", () => {
    const at = [assistant("x".repeat(16_000)), assistant("x".repeat(16_000)), user("x".repeat(4_000)), user("x".repeat(4_000))];
    expect(ChatMessagesSchema.safeParse(at).success).toBe(true);
    const over = ChatMessagesSchema.safeParse([...at.slice(0, 3), user("x".repeat(4_000)), user("x")]);
    expect(over.success).toBe(false);
    if (!over.success) expect(over.error.issues[0].message).toBe("The conversation can be at most 40,000 characters in total");
  });
});
