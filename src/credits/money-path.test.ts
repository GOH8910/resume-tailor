import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { policyFor } from "@/billing/plan";
import { UsageService } from "@/billing/usage";
import { attachUsage } from "@/billing/usage-error";
import type { ModelUsage } from "@/billing/usage-types";
import { creditEvents, usageEvents, user, userPlans } from "@/db/schema";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { ModelCallError } from "@/lib/anthropic";
import { AppError } from "@/lib/errors";
import type { CurrentUser } from "@/lib/http";
import { createInFlightCap } from "@/billing/in-flight";
import { runPaidCall } from "./money-path";
import { CreditsService } from "./service";

vi.mock("@/lib/auth", () => ({ getAuth: () => ({}) }));
vi.mock("@/lib/deps", () => ({}));

let close: () => Promise<void>;
let db: Db;
let credits: CreditsService;
let usage: UsageService;
let freeCalls: ReturnType<typeof createInFlightCap>;

const ADA: CurrentUser = { id: "user_ada", email: "ada@example.com", name: "Ada", plan: "free" };
const MODELS = { freeModel: "claude-haiku-5-5", unlimitedModel: "claude-sonnet-5-5" };
const FREE = policyFor("free", "hosted", MODELS);
const UNLIMITED = policyFor("unlimited", "hosted", MODELS);
const USED: ModelUsage = { model: "claude-haiku-5-5", inputTokens: 10_000, outputTokens: 2_500 };

beforeEach(async () => {
  const t = await createTestDb();
  close = t.close;
  db = t.db;
  await db.insert(user).values({ id: ADA.id, name: ADA.name, email: ADA.email });
  await db.insert(userPlans).values({ userId: ADA.id });
  credits = new CreditsService(async () => db, { perAccountPerDay: 10, perIpPerDay: 30, minWatchSeconds: 7 });
  usage = new UsageService(async () => db, { usdToGbp: 1, freeDailyBudgetGbp: 100, freeDailyCostPerAccountGbp: 100 });
  await credits.grantSignup(ADA.id, 3);
  freeCalls = createInFlightCap(2);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await close();
});

const succeeds = vi.fn(async () => ({ value: "tailored", usage: USED }));
const failsWith = (err: unknown) => vi.fn(async (): Promise<{ value: string; usage: ModelUsage }> => Promise.reject(err));

function paid(call: () => Promise<{ value: string; usage: ModelUsage }>, policy = FREE, cost = 2) {
  return runPaidCall({ user: ADA, policy, kind: "tailor", cost, ref: undefined, call }, { credits, usage, freeCalls });
}

const ledger = async () => (await db.select().from(creditEvents).where(eq(creditEvents.userId, ADA.id))).map((r) => [r.kind, r.amount]);
const booked = () => db.select({ kind: usageEvents.kind, free: usageEvents.free, inputTokens: usageEvents.inputTokens }).from(usageEvents);

describe("runPaidCall for a free account", () => {
  it("charges the cost, runs the call, books its usage as free and returns its value", async () => {
    expect(await paid(succeeds)).toEqual({ value: "tailored", credits: 1 });
    expect(await credits.balance(ADA.id)).toBe(1);
    expect(await ledger()).toEqual([["signup", 3], ["tailor", -2]]);
    expect(await booked()).toEqual([{ kind: "tailor", free: true, inputTokens: 10_000 }]);
  });

  it("refuses a short balance with a 402 before calling Claude, writing nothing", async () => {
    const call = vi.fn(succeeds);
    await expect(paid(call, FREE, 4)).rejects.toMatchObject({ status: 402, details: { credits: 3, needed: 4 } });
    expect(call).not.toHaveBeenCalled();
    expect(await ledger()).toEqual([["signup", 3]]);
    expect(await booked()).toEqual([]);
  });

  it("refuses while free usage is paused, before charging", async () => {
    await usage.setFreePaused(true);
    const call = vi.fn(succeeds);
    await expect(paid(call)).rejects.toMatchObject({ status: 402, details: { paused: true, reason: "manual" } });
    expect(call).not.toHaveBeenCalled();
    expect(await credits.balance(ADA.id)).toBe(3);
  });

  it("charges nothing when the cost is 0, but still books the call as free", async () => {
    expect(await paid(succeeds, FREE, 0)).toEqual({ value: "tailored" });
    expect(await ledger()).toEqual([["signup", 3]]);
    expect(await booked()).toEqual([{ kind: "tailor", free: true, inputTokens: 10_000 }]);
  });

  it("books a refused reply's usage, refunds the charge against it and rethrows the original error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const refusal = new ModelCallError("Claude declined this request: no", 502, USED);
    await expect(paid(failsWith(refusal))).rejects.toBe(refusal);
    expect(await credits.balance(ADA.id)).toBe(3);
    const rows = await db.select().from(creditEvents).where(eq(creditEvents.userId, ADA.id));
    const charge = rows.find((r) => r.kind === "tailor");
    expect(rows.find((r) => r.kind === "refund")).toMatchObject({ amount: 2, ref: charge?.id });
    expect(await booked()).toEqual([{ kind: "tailor", free: true, inputTokens: 10_000 }]);
  });

  it("books the usage of a call that failed after the model answered, and refunds", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const saveFailed = attachUsage(new AppError("Could not save", 500), USED);
    await expect(paid(failsWith(saveFailed))).rejects.toBe(saveFailed);
    expect(await credits.balance(ADA.id)).toBe(3);
    expect(await booked()).toHaveLength(1);
  });

  it("refunds without booking anything when the call never reached Claude", async () => {
    const unreachable = new AppError("Could not reach the Anthropic API", 502);
    await expect(paid(failsWith(unreachable))).rejects.toBe(unreachable);
    expect(await ledger()).toEqual([["signup", 3], ["tailor", -2], ["refund", 2]]);
    expect(await booked()).toEqual([]);
  });

  it("still rethrows the original error and refunds when booking the usage fails", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(usage, "record").mockRejectedValue(new Error("db down"));
    const refusal = new ModelCallError("Claude declined", 502, USED);
    await expect(paid(failsWith(refusal))).rejects.toBe(refusal);
    expect(await credits.balance(ADA.id)).toBe(3);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("[usage]"), expect.any(Error));
  });

  it("still rethrows the original error when the refund fails, and logs the lost refund", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(credits, "refund").mockRejectedValue(new Error("db down"));
    const refusal = new ModelCallError("Claude declined", 502, USED);
    await expect(paid(failsWith(refusal))).rejects.toBe(refusal);
    expect(logged).toHaveBeenCalledWith(expect.stringMatching(/\[credits\] could not refund 2 credits to user user_ada/), expect.any(Error));
  });
});

describe("runPaidCall: free calls in flight", () => {
  /** A call that runs until `finish` is called. */
  function held() {
    let finish!: () => void;
    const done = new Promise<void>((resolve) => (finish = resolve));
    return { call: vi.fn(async () => (await done, { value: "tailored", usage: USED })), finish };
  }

  it("refuses a free call with a 503 while the cap's calls run, before charging, and admits one once a call ends", async () => {
    const first = held();
    const second = held();
    const running = [paid(first.call, FREE, 0), paid(second.call, FREE, 0)];
    await vi.waitFor(() => expect(second.call).toHaveBeenCalled());

    const third = vi.fn(succeeds);
    await expect(paid(third, FREE, 1)).rejects.toMatchObject({ status: 503, details: { retryAfter: 5 } });
    expect(third).not.toHaveBeenCalled();
    expect(await ledger()).toEqual([["signup", 3]]);

    first.finish();
    await running[0];
    expect(freeCalls.running()).toBe(1);
    await expect(paid(succeeds, FREE, 1)).resolves.toMatchObject({ value: "tailored" });
    second.finish();
    await running[1];
    expect(freeCalls.running()).toBe(0);
  });

  it("releases the slot when the call fails, and when the charge is refused", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(paid(failsWith(new ModelCallError("Claude declined", 502, USED)))).rejects.toMatchObject({ status: 502 });
    await expect(paid(succeeds, FREE, 99)).rejects.toMatchObject({ status: 402 });
    expect(freeCalls.running()).toBe(0);
  });

  it("answers a pause with the 402, not the 503, and takes no slot for it", async () => {
    await usage.setFreePaused(true);
    const claim = vi.spyOn(freeCalls, "claim");
    await expect(paid(succeeds)).rejects.toMatchObject({ status: 402 });
    expect(claim).not.toHaveBeenCalled();
  });

  it("does not count calls from accounts that do not pay in credits", async () => {
    const claim = vi.spyOn(freeCalls, "claim");
    await paid(succeeds, UNLIMITED);
    expect(claim).not.toHaveBeenCalled();
  });
});

describe("runPaidCall: the account's daily free limit", () => {
  it("refuses a free account that reached its own daily cost limit before charging", async () => {
    const capped = new UsageService(async () => db, { usdToGbp: 1, freeDailyBudgetGbp: 100, freeDailyCostPerAccountGbp: 0.001 });
    await capped.record({ userId: ADA.id, kind: "tailor", usage: USED, free: true });
    const call = vi.fn(succeeds);
    const refused = runPaidCall({ user: ADA, policy: FREE, kind: "chat", cost: 1, call }, { credits, usage: capped, freeCalls });
    await expect(refused).rejects.toMatchObject({ status: 402, details: { paused: true, reason: "account" } });
    expect(call).not.toHaveBeenCalled();
    expect(await credits.balance(ADA.id)).toBe(3);
  });
});

describe("runPaidCall for an unlimited account", () => {
  it("never checks the pause or charges, and books the call as not free", async () => {
    await usage.setFreePaused(true);
    expect(await paid(succeeds, UNLIMITED)).toEqual({ value: "tailored" });
    expect(await ledger()).toEqual([["signup", 3]]);
    expect(await booked()).toEqual([{ kind: "tailor", free: false, inputTokens: 10_000 }]);
  });

  it("books a failed call's usage as not free, with nothing to refund", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const refusal = new ModelCallError("Claude declined", 502, USED);
    await expect(paid(failsWith(refusal), UNLIMITED)).rejects.toBe(refusal);
    expect(await ledger()).toEqual([["signup", 3]]);
    expect(await booked()).toEqual([{ kind: "tailor", free: false, inputTokens: 10_000 }]);
  });
});
