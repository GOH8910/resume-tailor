import { beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.hoisted(() => vi.fn());
const plans = vi.hoisted(() => ({ get: vi.fn() }));
const runTailor = vi.hoisted(() => vi.fn());
const usage = vi.hoisted(() => ({ isFreeUsagePaused: vi.fn(), record: vi.fn() }));
const credits = vi.hoisted(() => ({ charge: vi.fn(), refund: vi.fn() }));
const env = vi.hoisted(() => ({}) as Record<string, unknown>);
vi.mock("@/lib/auth", () => ({ getAuth: () => ({ api: { getSession } }) }));
vi.mock("@/lib/deps", () => ({ plans, usage, credits, banks: {}, applications: {} }));
vi.mock("@/lib/env", async (importOriginal) => ({ ...(await importOriginal<object>()), env }));
vi.mock("@/lib/anthropic", async (importOriginal) => ({ ...(await importOriginal<object>()), hasApiKey: () => true }));
vi.mock("@/tailor/tailor", async (importOriginal) => ({ ...(await importOriginal<object>()), runTailor }));
// The real class builds an Anthropic client, which needs an API key.
vi.mock("@/tailor/anthropic-model", () => ({
  AnthropicTailorModel: class {
    constructor(readonly id: string) {}
  },
}));

import { attachUsage } from "@/billing/usage-error";
import { ModelCallError } from "@/lib/anthropic";
import { parseEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { POST } from "./route";

const ADA = { user: { id: "u1", email: "ada@example.com", name: "Ada" }, session: { id: "s1" } };
const job = { company: "Acme", jobDescription: "We need Go engineers." };
const USED = { model: "claude-haiku-5-5", inputTokens: 10_000, outputTokens: 2_500 };

function useEnv(source: Record<string, string>) {
  for (const key of Object.keys(env)) delete env[key];
  Object.assign(env, parseEnv(source));
}

/** Posts a tailor request as a user on `plan` and returns the response and the model id the tailor ran on. */
async function tailorAs(plan: "free" | "unlimited", body: Record<string, unknown>) {
  getSession.mockResolvedValueOnce(ADA);
  plans.get.mockResolvedValue({ plan, credits: 0 });
  const res = await POST(new Request("http://localhost/api/tailor", { method: "POST", body: JSON.stringify(body) }));
  const model = runTailor.mock.lastCall?.[1].model as { id: string } | undefined;
  return { res, modelId: model?.id };
}

beforeEach(() => {
  vi.resetAllMocks();
  runTailor.mockResolvedValue({ application: { id: "a1" }, usage: USED });
  usage.isFreeUsagePaused.mockResolvedValue({ paused: false });
  usage.record.mockResolvedValue(undefined);
  credits.charge.mockResolvedValue({ credits: 0, eventId: "charge-1" });
  credits.refund.mockResolvedValue({ credits: 2 });
  useEnv({ APP_MODE: "hosted" });
});

describe("POST /api/tailor model policy", () => {
  it("runs a free account on the free model, whatever it asks for", async () => {
    const { res, modelId } = await tailorAs("free", { ...job, model: "claude-opus-5-5" });
    expect(res.status).toBe(201);
    expect(modelId).toBe("claude-haiku-5-5");
  });

  it("lets an unlimited account pick a model, and defaults it to the unlimited model", async () => {
    expect((await tailorAs("unlimited", { ...job, model: "claude-opus-5-5" })).modelId).toBe("claude-opus-5-5");
    expect((await tailorAs("unlimited", job)).modelId).toBe("claude-sonnet-5-5");
  });

  it("lets a self-hosted account pick a model", async () => {
    useEnv({ APP_MODE: "selfhost" });
    expect((await tailorAs("free", { ...job, model: "claude-haiku-5-5" })).modelId).toBe("claude-haiku-5-5");
  });

  it("refuses a model outside the list", async () => {
    const { res } = await tailorAs("unlimited", { ...job, model: "claude-unknown" });
    expect(res.status).toBe(400);
    expect(runTailor).not.toHaveBeenCalled();
  });
});

describe("POST /api/tailor daily budget and usage", () => {
  it("answers with the application and the balance after the charge, without the usage", async () => {
    const { res } = await tailorAs("free", job);
    expect(await res.json()).toEqual({ application: { id: "a1" }, credits: 0 });
  });

  it("leaves the balance out for an account that does not pay in credits", async () => {
    const { res } = await tailorAs("unlimited", job);
    expect(await res.json()).toEqual({ application: { id: "a1" } });
  });

  it("refuses a free account with a 402 until the next UTC day once the budget is spent, without calling Claude", async () => {
    const resumesAt = "2026-10-30T00:00:00.000Z";
    usage.isFreeUsagePaused.mockResolvedValue({ paused: true, reason: "budget", resumesAt });
    const { res } = await tailorAs("free", job);
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({
      error: `Free AI features are paused until ${resumesAt} (daily budget reached)`,
      details: { paused: true, reason: "budget", resumesAt },
    });
    expect(runTailor).not.toHaveBeenCalled();
    expect(usage.record).not.toHaveBeenCalled();
  });

  it("refuses a free account while the operator has paused free usage", async () => {
    usage.isFreeUsagePaused.mockResolvedValue({ paused: true, reason: "manual" });
    const { res } = await tailorAs("free", job);
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ error: "Free AI features are paused by the operator", details: { paused: true, reason: "manual" } });
    expect(runTailor).not.toHaveBeenCalled();
  });

  it("does not hold an unlimited or self-hosted account to the free budget", async () => {
    usage.isFreeUsagePaused.mockResolvedValue({ paused: true, reason: "manual" });
    expect((await tailorAs("unlimited", job)).res.status).toBe(201);
    useEnv({ APP_MODE: "selfhost" });
    expect((await tailorAs("free", job)).res.status).toBe(201);
    expect(usage.isFreeUsagePaused).not.toHaveBeenCalled();
  });

  it("records the call once, as free usage for a free account", async () => {
    await tailorAs("free", job);
    expect(usage.record).toHaveBeenCalledOnce();
    expect(usage.record).toHaveBeenCalledWith({ userId: "u1", kind: "tailor", usage: USED, free: true });
  });

  it("records an unlimited account's call as not free", async () => {
    await tailorAs("unlimited", job);
    expect(usage.record).toHaveBeenCalledExactlyOnceWith({ userId: "u1", kind: "tailor", usage: USED, free: false });
  });

  it("still answers when the call cannot be recorded, and logs it", async () => {
    const failure = new Error("db down");
    usage.record.mockRejectedValue(failure);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { res } = await tailorAs("free", job);
    expect(res.status).toBe(201);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("[usage]"), failure);
  });

  it("records nothing when the tailor fails before reaching Claude", async () => {
    runTailor.mockRejectedValue(new AppError("Could not reach the Anthropic API", 502));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await tailorAs("free", job)).res.status).toBe(502);
    expect(usage.record).not.toHaveBeenCalled();
  });
});

describe("POST /api/tailor credits", () => {
  it("charges a free account the tailor's cost before tailoring", async () => {
    useEnv({ APP_MODE: "hosted", CREDITS_PER_TAILOR: "3" });
    const { res } = await tailorAs("free", job);
    expect(res.status).toBe(201);
    expect(credits.charge).toHaveBeenCalledExactlyOnceWith({ userId: "u1", amount: 3, kind: "tailor", ref: undefined });
    expect(credits.charge.mock.invocationCallOrder[0]).toBeLessThan(runTailor.mock.invocationCallOrder[0]);
    expect(credits.refund).not.toHaveBeenCalled();
  });

  it.each([
    [{ ...job, jobDescription: "  " }, "Job description is required"],
    [{ ...job, company: "" }, "Company is required"],
  ])("refuses an invalid request with a 400 before charging or calling Claude", async (body, error) => {
    const { res } = await tailorAs("free", body);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(error);
    expect(credits.charge).not.toHaveBeenCalled();
    expect(credits.refund).not.toHaveBeenCalled();
    expect(runTailor).not.toHaveBeenCalled();
  });

  it("answers a short balance with a 402 naming the balance and the cost, without calling Claude", async () => {
    credits.charge.mockRejectedValue(new AppError("Not enough credits", 402, { credits: 1, needed: 2 }));
    const { res } = await tailorAs("free", job);
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ error: "Not enough credits", details: { credits: 1, needed: 2 } });
    expect(runTailor).not.toHaveBeenCalled();
    expect(usage.record).not.toHaveBeenCalled();
  });

  it("refuses while free usage is paused before charging anything", async () => {
    usage.isFreeUsagePaused.mockResolvedValue({ paused: true, reason: "manual" });
    expect((await tailorAs("free", job)).res.status).toBe(402);
    expect(credits.charge).not.toHaveBeenCalled();
  });

  it("charges neither an unlimited nor a self-hosted account", async () => {
    await tailorAs("unlimited", job);
    useEnv({ APP_MODE: "selfhost" });
    await tailorAs("free", job);
    expect(credits.charge).not.toHaveBeenCalled();
  });

  it("books a refused reply, refunds the charge and answers 502 without the usage", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    runTailor.mockRejectedValue(new ModelCallError("Claude declined this request: no", 502, USED));
    const { res } = await tailorAs("free", job);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Claude declined this request: no", details: null });
    expect(usage.record).toHaveBeenCalledExactlyOnceWith({ userId: "u1", kind: "tailor", usage: USED, free: true });
    expect(credits.refund).toHaveBeenCalledExactlyOnceWith({ userId: "u1", amount: 2, ref: "charge-1" });
  });

  it("books the usage and refunds when saving fails after Claude answered", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    runTailor.mockRejectedValue(attachUsage(new Error("insert into applications failed"), USED));
    const { res } = await tailorAs("free", job);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Something went wrong" });
    expect(usage.record).toHaveBeenCalledExactlyOnceWith({ userId: "u1", kind: "tailor", usage: USED, free: true });
    expect(credits.refund).toHaveBeenCalledOnce();
  });

  it("keeps the 502 when booking the failed call's usage also fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    usage.record.mockRejectedValue(new Error("db down"));
    runTailor.mockRejectedValue(new ModelCallError("Claude declined", 502, USED));
    expect((await tailorAs("free", job)).res.status).toBe(502);
    expect(credits.refund).toHaveBeenCalledOnce();
  });
});
