import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { AnthropicChatModel } from "./anthropic-chat-model";
import type { ChatResult } from "./schema";

const result: ChatResult = { reply: "Done.", bankChanges: [], resumeChanges: [] };

/** Anthropic client whose fetch returns a canned reply, so no request leaves the process. */
function stubbedClient(usage: Record<string, unknown>) {
  const body = {
    id: "msg_1",
    type: "message",
    role: "assistant",
    // A dated snapshot id: usage must be booked under the id that was asked for, which is what the price table knows.
    model: "claude-haiku-5-5-20261001",
    stop_sequence: null,
    stop_reason: "end_turn",
    content: [{ type: "text", text: JSON.stringify(result) }],
    usage,
  };
  const fetchStub = async () => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  return new Anthropic({ apiKey: "test", fetch: fetchStub, maxRetries: 0 });
}

describe("AnthropicChatModel", () => {
  it("returns the reply with the tokens it used, under the model it was asked for", async () => {
    const model = new AnthropicChatModel("claude-haiku-5-5", stubbedClient({ input_tokens: 4000, output_tokens: 250 }));
    await expect(model.chat("sys", [{ role: "user", content: "hi" }])).resolves.toEqual({
      result,
      usage: { model: "claude-haiku-5-5", inputTokens: 4000, outputTokens: 250 },
    });
  });
});
