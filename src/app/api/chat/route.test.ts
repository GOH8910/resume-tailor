import { beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.hoisted(() => vi.fn());
const plans = vi.hoisted(() => ({ get: vi.fn() }));
const runChat = vi.hoisted(() => vi.fn());
const env = vi.hoisted(() => ({}) as Record<string, unknown>);
vi.mock("@/lib/auth", () => ({ getAuth: () => ({ api: { getSession } }) }));
vi.mock("@/lib/deps", () => ({ plans, banks: {}, applications: {} }));
vi.mock("@/lib/env", async (importOriginal) => ({ ...(await importOriginal<object>()), env }));
vi.mock("@/lib/anthropic", () => ({ hasApiKey: () => true }));
vi.mock("@/chat/chat", () => ({ runChat }));
// The real class builds an Anthropic client, which needs an API key.
vi.mock("@/chat/anthropic-chat-model", () => ({
  AnthropicChatModel: class {
    constructor(readonly id: string) {}
  },
}));

import { parseEnv } from "@/lib/env";
import { POST } from "./route";

const ADA = { user: { id: "u1", email: "ada@example.com", name: "Ada" }, session: { id: "s1" } };
const messages = [{ role: "user", content: "Shorten the summary" }];

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
  runChat.mockResolvedValue({ reply: "Done" });
  useEnv({ APP_MODE: "hosted" });
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
