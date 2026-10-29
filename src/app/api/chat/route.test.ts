import { beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.hoisted(() => vi.fn());
const plans = vi.hoisted(() => ({ get: vi.fn() }));
const runChat = vi.hoisted(() => vi.fn());
const usage = vi.hoisted(() => ({ isFreeUsagePaused: vi.fn(), record: vi.fn() }));
const credits = vi.hoisted(() => ({ charge: vi.fn(), refund: vi.fn() }));
const env = vi.hoisted(() => ({}) as Record<string, unknown>);
vi.mock("@/lib/auth", () => ({ getAuth: () => ({ api: { getSession } }) }));
vi.mock("@/lib/deps", () => ({ plans, usage, credits, banks: {}, applications: {} }));
vi.mock("@/lib/env", async (importOriginal) => ({ ...(await importOriginal<object>()), env }));
vi.mock("@/lib/anthropic", async (importOriginal) => ({ ...(await importOriginal<object>()), hasApiKey: () => true }));
vi.mock("@/chat/chat", async (importOriginal) => ({ ...(await importOriginal<object>()), runChat }));
// The real class builds an Anthropic client, which needs an API key.
vi.mock("@/chat/anthropic-chat-model", () => ({
  AnthropicChatModel: class {
    constructor(readonly id: string) {}
  },
}));

import { attachUsage } from "@/billing/usage-error";
import { ModelCallError } from "@/lib/anthropic";
import { parseEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { clearLimits } from "@/lib/limits";
import { POST } from "./route";

const ADA = { user: { id: "u1", email: "ada@example.com", name: "Ada" }, session: { id: "s1" } };
const messages = [{ role: "user", content: "Shorten the summary" }];
const USED = { model: "claude-haiku-5-5", inputTokens: 4_000, outputTokens: 300 };
const OUTCOME = { reply: "Done", applied: [], warnings: [], bank: {}, bankChanged: false, resumeChanges: [] };

function useEnv(source: Record<string, string>) {
  for (const key of Object.keys(env)) delete env[key];
  Object.assign(env, parseEnv(source));
}

async function chatAs(plan: "free" | "unlimited", body: Record<string, unknown>) {
  getSession.mockResolvedValueOnce(ADA);
  plans.get.mockResolvedValue({ plan, credits: 0 });
  const res = await POST(new Request("http://localhost/api/chat", { method: "POST", body: JSON.stringify(body) }));
  const model = runChat.mock.lastCall?.[1].model as { id: string } | undefined;
  return { res, modelId: model?.id };
}

beforeEach(() => {
  vi.resetAllMocks();
  runChat.mockResolvedValue({ outcome: OUTCOME, usage: USED });
  usage.isFreeUsagePaused.mockResolvedValue({ paused: false });
  usage.record.mockResolvedValue(undefined);
  credits.charge.mockResolvedValue({ credits: 0, eventId: "charge-1" });
  credits.refund.mockResolvedValue({ credits: 1 });
  useEnv({ APP_MODE: "hosted" });
  clearLimits();
});

describe("POST /api/chat limits", () => {
  it("answers the 31st message in 10 minutes with a 429 before charging", async () => {
    for (let i = 0; i < 30; i++) expect((await chatAs("free", { messages })).res.status).toBe(200);
    vi.clearAllMocks();
    const { res } = await chatAs("free", { messages });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "Too many chat requests, try again in 20 s", details: { retryAfter: 20 } });
    expect(credits.charge).not.toHaveBeenCalled();
    expect(runChat).not.toHaveBeenCalled();
  });

  it("refuses a resume over 200 KB as JSON with a 413 before charging", async () => {
    const bullets = Array.from({ length: 400 }, (_, i) => ({ bulletId: `b${i}`, original: "", text: "x".repeat(600) }));
    const resume = { summary: "", education: [], experience: [{ entryId: "e1", rationale: "", bullets }], projects: [], skills: [] };
    const { res } = await chatAs("free", { messages, resume });
    expect(res.status).toBe(413);
    expect((await res.json()).error).toBe("The resume is too large: keep it under 200 KB");
    expect(credits.charge).not.toHaveBeenCalled();
    expect(runChat).not.toHaveBeenCalled();
  });

  it("refuses a message over 4,000 characters and a conversation over 20 messages before charging", async () => {
    const long = [{ role: "user", content: "x".repeat(4_001) }];
    expect((await chatAs("free", { messages: long })).res.status).toBe(400);
    const many = Array.from({ length: 21 }, () => ({ role: "user", content: "hi" }));
    expect((await chatAs("free", { messages: many })).res.status).toBe(400);
    const total = [...Array.from({ length: 3 }, () => ({ role: "assistant", content: "x".repeat(13_000) })), { role: "user", content: "x".repeat(1_001) }];
    const { res } = await chatAs("free", { messages: total });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("messages: The conversation can be at most 40,000 characters in total");
    expect(credits.charge).not.toHaveBeenCalled();
  });
});

describe("POST /api/chat model policy", () => {
  it("runs a free account on the free model, whatever it asks for", async () => {
    const { res, modelId } = await chatAs("free", { messages, model: "claude-opus-5-5" });
    expect(res.status).toBe(200);
    expect(modelId).toBe("claude-haiku-5-5");
  });

  it("lets an unlimited account pick a model, and defaults it to the unlimited model", async () => {
    expect((await chatAs("unlimited", { messages, model: "claude-opus-5-5" })).modelId).toBe("claude-opus-5-5");
    expect((await chatAs("unlimited", { messages })).modelId).toBe("claude-sonnet-5-5");
  });

  it("lets a self-hosted account pick a model, and defaults it to the unlimited model", async () => {
    useEnv({ APP_MODE: "selfhost" });
    expect((await chatAs("free", { messages, model: "claude-haiku-5-5" })).modelId).toBe("claude-haiku-5-5");
    expect((await chatAs("free", { messages })).modelId).toBe("claude-sonnet-5-5");
  });

  it("refuses a model outside the list", async () => {
    const { res } = await chatAs("unlimited", { messages, model: "claude-unknown" });
    expect(res.status).toBe(400);
    expect(runChat).not.toHaveBeenCalled();
  });
});

describe("POST /api/chat daily budget and usage", () => {
  it("answers with the chat outcome and the balance after the charge, without the usage", async () => {
    const { res } = await chatAs("free", { messages });
    expect(await res.json()).toEqual({ ...OUTCOME, credits: 0 });
  });

  it("leaves the balance out for an account that does not pay in credits", async () => {
    const { res } = await chatAs("unlimited", { messages });
    expect(await res.json()).toEqual(OUTCOME);
  });

  it("refuses a free account with a 402 until the next UTC day once the budget is spent, without calling Claude", async () => {
    const resumesAt = "2026-10-30T00:00:00.000Z";
    usage.isFreeUsagePaused.mockResolvedValue({ paused: true, reason: "budget", resumesAt });
    const { res } = await chatAs("free", { messages });
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({
      error: `Free AI features are paused until ${resumesAt} (daily budget reached)`,
      details: { paused: true, reason: "budget", resumesAt },
    });
    expect(runChat).not.toHaveBeenCalled();
    expect(usage.record).not.toHaveBeenCalled();
  });

  it("does not hold an unlimited account to the free budget", async () => {
    usage.isFreeUsagePaused.mockResolvedValue({ paused: true, reason: "manual" });
    expect((await chatAs("unlimited", { messages })).res.status).toBe(200);
    expect(usage.isFreeUsagePaused).not.toHaveBeenCalled();
  });

  it("records the call once, free only for a free account", async () => {
    await chatAs("free", { messages });
    expect(usage.record).toHaveBeenCalledExactlyOnceWith({ userId: "u1", kind: "chat", usage: USED, free: true });
    usage.record.mockClear();
    await chatAs("unlimited", { messages });
    expect(usage.record).toHaveBeenCalledExactlyOnceWith({ userId: "u1", kind: "chat", usage: USED, free: false });
  });

  it("still answers when the call cannot be recorded, and logs it", async () => {
    usage.record.mockRejectedValue(new Error("db down"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await chatAs("free", { messages })).res.status).toBe(200);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("[usage]"), expect.any(Error));
  });
});

describe("POST /api/chat credits", () => {
  it("charges a free account the message's cost before calling Claude, naming the open application", async () => {
    useEnv({ APP_MODE: "hosted", CREDITS_PER_CHAT_MESSAGE: "2" });
    const { res } = await chatAs("free", { messages, applicationId: "app-1" });
    expect(res.status).toBe(200);
    expect(credits.charge).toHaveBeenCalledExactlyOnceWith({ userId: "u1", amount: 2, kind: "chat", ref: "app-1" });
    expect(credits.charge.mock.invocationCallOrder[0]).toBeLessThan(runChat.mock.invocationCallOrder[0]);
  });

  it("refuses a conversation that does not end with a user message with a 400 before charging or calling Claude", async () => {
    const { res } = await chatAs("free", { messages: [...messages, { role: "assistant", content: "Done" }] });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("The last message must be from the user");
    expect(credits.charge).not.toHaveBeenCalled();
    expect(credits.refund).not.toHaveBeenCalled();
    expect(runChat).not.toHaveBeenCalled();
  });

  it("answers a short balance with a 402 naming the balance and the cost, without calling Claude", async () => {
    credits.charge.mockRejectedValue(new AppError("Not enough credits", 402, { credits: 0, needed: 1 }));
    const { res } = await chatAs("free", { messages });
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ error: "Not enough credits", details: { credits: 0, needed: 1 } });
    expect(runChat).not.toHaveBeenCalled();
  });

  it("refuses while free usage is paused before charging anything", async () => {
    usage.isFreeUsagePaused.mockResolvedValue({ paused: true, reason: "manual" });
    expect((await chatAs("free", { messages })).res.status).toBe(402);
    expect(credits.charge).not.toHaveBeenCalled();
  });

  it("charges neither an unlimited nor a self-hosted account", async () => {
    await chatAs("unlimited", { messages });
    useEnv({ APP_MODE: "selfhost" });
    await chatAs("free", { messages });
    expect(credits.charge).not.toHaveBeenCalled();
  });

  it("books a refused reply, refunds the charge and answers 502 without the usage", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    runChat.mockRejectedValue(new ModelCallError("Claude declined this request: no", 502, USED));
    const { res } = await chatAs("free", { messages });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Claude declined this request: no", details: null });
    expect(usage.record).toHaveBeenCalledExactlyOnceWith({ userId: "u1", kind: "chat", usage: USED, free: true });
    expect(credits.refund).toHaveBeenCalledExactlyOnceWith({ userId: "u1", amount: 1, ref: "charge-1" });
  });

  it("books the usage and refunds when saving the bank fails after Claude answered", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    runChat.mockRejectedValue(attachUsage(new Error("update banks failed"), USED));
    expect((await chatAs("free", { messages })).res.status).toBe(500);
    expect(usage.record).toHaveBeenCalledOnce();
    expect(credits.refund).toHaveBeenCalledOnce();
  });

  it("keeps the 502 when booking the failed call's usage also fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    usage.record.mockRejectedValue(new Error("db down"));
    runChat.mockRejectedValue(new ModelCallError("Claude declined", 502, USED));
    expect((await chatAs("free", { messages })).res.status).toBe(502);
    expect(credits.refund).toHaveBeenCalledOnce();
  });
});
