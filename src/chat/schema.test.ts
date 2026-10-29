import { describe, expect, it } from "vitest";
import { ChatMessageSchema, ChatMessagesSchema } from "./schema";

const user = (content: string) => ({ role: "user" as const, content });
const assistant = (content: string) => ({ role: "assistant" as const, content });

describe("ChatMessageSchema", () => {
  it("accepts a user message of 4,000 characters and refuses 4,001", () => {
    expect(ChatMessageSchema.safeParse(user("x".repeat(4_000))).success).toBe(true);
    const long = ChatMessageSchema.safeParse(user("x".repeat(4_001)));
    expect(long.success).toBe(false);
    if (!long.success) expect(long.error.issues[0]).toMatchObject({ path: ["content"], message: "A message can be at most 4000 characters" });
  });

  it("allows Claude's own longer replies in the history, up to 16,000 characters", () => {
    expect(ChatMessageSchema.safeParse(assistant("x".repeat(16_000))).success).toBe(true);
    expect(ChatMessageSchema.safeParse(assistant("x".repeat(16_001))).success).toBe(false);
  });
});

describe("ChatMessagesSchema", () => {
  it("accepts 1 to 20 messages", () => {
    expect(ChatMessagesSchema.safeParse([]).success).toBe(false);
    expect(ChatMessagesSchema.safeParse([user("hi")]).success).toBe(true);
    expect(ChatMessagesSchema.safeParse(Array.from({ length: 20 }, () => user("hi"))).success).toBe(true);
    expect(ChatMessagesSchema.safeParse(Array.from({ length: 21 }, () => user("hi"))).success).toBe(false);
  });
});
