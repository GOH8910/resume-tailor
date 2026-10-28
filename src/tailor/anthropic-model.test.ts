import Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnthropicTailorModel } from "./anthropic-model";
import type { TailorResult } from "./schema";

const validResult: TailorResult = {
  summary: "Go-focused summary.",
  education: [],
  experience: [{ entryId: "e_exp1", rationale: "Go service", bullets: [{ bulletId: "b_exp1b", edited: null }] }],
  projects: [],
  skills: [{ name: "Programming", items: ["Go"] }],
  notes: "",
};

const messageBase = {
  id: "msg_1",
  type: "message",
  role: "assistant",
  model: "claude-opus-5-5",
  stop_sequence: null,
  usage: { input_tokens: 1, output_tokens: 1 },
};

function textMessage(text: string, stop_reason: string, extra: Record<string, unknown> = {}) {
  return { ...messageBase, content: [{ type: "text", text }], stop_reason, ...extra };
}

/** Anthropic client whose fetch returns a canned response, so no request leaves the process. */
function stubbedModel(status: number, body: unknown) {
  const requests: unknown[] = [];
  const fetchStub = async (_url: unknown, init?: { body?: unknown }) => {
    requests.push(JSON.parse(String(init?.body ?? "null")));
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "request-id": "req_test" } });
  };
  const client = new Anthropic({ apiKey: "test", fetch: fetchStub, maxRetries: 0 });
  return { model: new AnthropicTailorModel("claude-opus-5-5", client), requests };
}

const request = { system: "sys", user: "usr" };

afterEach(() => vi.restoreAllMocks());

describe("AnthropicTailorModel", () => {
  it("returns the parsed result and sends effort high with no thinking parameter", async () => {
    const { model, requests } = stubbedModel(200, textMessage(JSON.stringify(validResult), "end_turn"));
    await expect(model.tailor(request)).resolves.toEqual(validResult);
    const sent = requests[0] as Record<string, unknown> & { output_config: { effort: string } };
    expect(sent.model).toBe("claude-opus-5-5");
    expect(sent.max_tokens).toBe(16000);
    expect(sent.output_config.effort).toBe("high");
    expect(sent).not.toHaveProperty("thinking");
  });

  it("reports truncation as an output-token problem, not a parse failure", async () => {
    const { model } = stubbedModel(200, textMessage('{"summary":"abc', "max_tokens"));
    await expect(model.tailor(request)).rejects.toMatchObject({ status: 502, message: expect.stringMatching(/output tokens/) });
  });

  it("reports a refusal with its explanation", async () => {
    const refusal = textMessage("I can't help with that.", "refusal", {
      stop_details: { type: "refusal", category: "cyber", explanation: "policy" },
    });
    const { model } = stubbedModel(200, refusal);
    await expect(model.tailor(request)).rejects.toMatchObject({ status: 502, message: expect.stringMatching(/declined.*policy/) });
  });

  it("rejects valid JSON of the wrong shape as a schema mismatch", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { model } = stubbedModel(200, textMessage('{"summary":"x"}', "end_turn"));
    await expect(model.tailor(request)).rejects.toMatchObject({ status: 502, message: expect.stringMatching(/schema/) });
  });

  // A 401 would tell the browser its own session had expired and send the user to sign in.
  it("maps a rejected API key to a 502 that names no secret", async () => {
    const { model } = stubbedModel(401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } });
    await expect(model.tailor(request)).rejects.toMatchObject({
      status: 502,
      message: "The AI service rejected the request; check the server's API key",
    });
  });
});
