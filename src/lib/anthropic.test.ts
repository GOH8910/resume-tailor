import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { usageFromError } from "@/billing/usage-error";
import { createStructured, ModelCallError } from "./anthropic";
import { AppError } from "./errors";
import { handle } from "./http";

vi.mock("./auth", () => ({ getAuth: () => ({}) }));
vi.mock("./deps", () => ({}));

const Schema = z.object({ answer: z.string() });
const REQUEST = { model: "claude-haiku-5-5", system: "s", messages: [{ role: "user" as const, content: "q" }] };
const TOKENS = { input_tokens: 1_200, output_tokens: 300, cache_read_input_tokens: 50, cache_creation_input_tokens: null };
const USED = { model: "claude-haiku-5-5", inputTokens: 1_200, outputTokens: 300, cacheReadTokens: 50 };

function clientAnswering(response: Record<string, unknown> | Error) {
  const create = vi.fn(async () => {
    if (response instanceof Error) throw response;
    return { content: [], stop_reason: "end_turn", usage: TOKENS, ...response };
  });
  return { messages: { create } } as unknown as Anthropic;
}

const text = (value: string) => ({ content: [{ type: "text", text: value }] });

async function failure(response: Record<string, unknown> | Error): Promise<unknown> {
  vi.spyOn(console, "error").mockImplementation(() => {});
  return createStructured(clientAnswering(response), Schema, REQUEST).then(
    () => expect.unreachable("createStructured should have thrown"),
    (err: unknown) => err,
  );
}

describe("createStructured", () => {
  it("returns the parsed reply and the tokens it used", async () => {
    const result = await createStructured(clientAnswering(text('{"answer":"yes"}')), Schema, REQUEST);
    expect(result).toEqual({ value: { answer: "yes" }, usage: USED });
  });

  it.each([
    ["a refusal", { stop_reason: "refusal", stop_details: { explanation: "unsafe" } }, "Claude declined this request: unsafe"],
    ["running out of tokens", { stop_reason: "max_tokens" }, "Claude ran out of output tokens"],
    ["a reply without text", { content: [] }, "did not match the expected schema"],
    ["a reply that does not parse", text('{"answer":'), "did not match the expected schema"],
    ["a reply that fails the schema", text('{"answer":1}'), "did not match the expected schema"],
  ])("throws a 502 that keeps the billed usage on %s", async (_case, response, message) => {
    const err = await failure(response);
    expect(err).toBeInstanceOf(ModelCallError);
    expect(err).toMatchObject({ status: 502, message: expect.stringContaining(message) });
    expect(usageFromError(err)).toEqual(USED);
  });

  it("keeps the usage out of anything serialised from the error", async () => {
    const err = await failure({ stop_reason: "max_tokens" });
    expect(Object.keys(err as object)).not.toContain("usage");
    expect(JSON.stringify(err)).not.toContain("inputTokens");
    expect(usageFromError(err)).toEqual(USED);
  });

  it("carries no usage when the call itself failed", async () => {
    const err = await failure(new Error("socket hang up"));
    expect(err).toBeInstanceOf(AppError);
    expect(usageFromError(err)).toBeUndefined();
  });

  it("never sends the usage to the client", async () => {
    const err = await failure({ stop_reason: "refusal" });
    const res = await handle(async () => {
      throw err;
    });
    expect(res.status).toBe(502);
    const body = await res.text();
    expect(body).not.toMatch(/token|usage|1200|claude-haiku/i);
    expect(JSON.parse(body).details).toBeNull();
  });
});
