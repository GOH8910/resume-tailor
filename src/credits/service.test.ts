import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { creditEvents, user, userPlans } from "@/db/schema";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { CreditsService } from "./service";

let close: () => Promise<void>;
let db: Db;
let credits: CreditsService;
const ADA = "user_ada";
const BOB = "user_bob";

beforeEach(async () => {
  const t = await createTestDb();
  close = t.close;
  db = t.db;
  await db.insert(user).values([
    { id: ADA, name: "Ada", email: "ada@example.com" },
    { id: BOB, name: "Bob", email: "bob@example.com" },
  ]);
  await db.insert(userPlans).values([{ userId: ADA }, { userId: BOB }]);
  credits = new CreditsService(async () => db, { perAccountPerDay: 10, perIpPerDay: 30, minWatchSeconds: 7 });
});
afterEach(() => close());

const ledger = (userId: string) => db.select().from(creditEvents).where(eq(creditEvents.userId, userId));
const ledgerSum = async (userId: string) => (await ledger(userId)).reduce((sum, row) => sum + row.amount, 0);

describe("CreditsService.balance", () => {
  it("is 0 for an account without a plan row", async () => {
    await db.delete(userPlans).where(eq(userPlans.userId, ADA));
    expect(await credits.balance(ADA)).toBe(0);
  });

  it("reads the cached balance", async () => {
    await credits.grantSignup(ADA, 3);
    expect(await credits.balance(ADA)).toBe(3);
  });
});

describe("CreditsService.charge", () => {
  beforeEach(() => credits.grantSignup(ADA, 3));

  it("takes the credits and writes one negative ledger row", async () => {
    const result = await credits.charge({ userId: ADA, amount: 2, kind: "tailor", ref: "app-1" });
    expect(result).toEqual({ credits: 1, eventId: expect.any(String) });
    expect(await credits.balance(ADA)).toBe(1);
    const spent = (await ledger(ADA)).filter((row) => row.kind === "tailor");
    expect(spent).toEqual([expect.objectContaining({ id: result.eventId, amount: -2, ref: "app-1" })]);
  });

  it("refuses more than the balance with a 402 naming both, and changes nothing", async () => {
    await expect(credits.charge({ userId: ADA, amount: 4, kind: "tailor" })).rejects.toMatchObject({
      status: 402,
      message: "Not enough credits",
      details: { credits: 3, needed: 4 },
    });
    expect(await credits.balance(ADA)).toBe(3);
    expect((await ledger(ADA)).map((row) => row.kind)).toEqual(["signup"]);
  });

  it("refuses an account without a plan row as having no credits", async () => {
    await db.delete(creditEvents);
    await db.delete(userPlans).where(eq(userPlans.userId, BOB));
    await expect(credits.charge({ userId: BOB, amount: 1, kind: "chat" })).rejects.toMatchObject({
      status: 402,
      details: { credits: 0, needed: 1 },
    });
  });

  it("charges nothing and writes nothing for a cost of 0", async () => {
    expect(await credits.charge({ userId: ADA, amount: 0, kind: "chat" })).toEqual({ credits: 3, eventId: null });
    expect(await ledger(ADA)).toHaveLength(1);
  });

  it("rejects a negative or fractional amount as a programming error", async () => {
    await expect(credits.charge({ userId: ADA, amount: -1, kind: "chat" })).rejects.toThrow(/amount/);
    await expect(credits.charge({ userId: ADA, amount: 1.5, kind: "chat" })).rejects.toThrow(/amount/);
    expect(await credits.balance(ADA)).toBe(3);
  });

  // PGlite has one connection and runs transactions one after another, so this checks the conditional update's
  // logic (the second charge sees the first's result), not Postgres row locking under real parallelism.
  it("lets exactly one of two parallel charges spend the last credit", async () => {
    await credits.charge({ userId: ADA, amount: 2, kind: "tailor" });
    const results = await Promise.allSettled([
      credits.charge({ userId: ADA, amount: 1, kind: "chat" }),
      credits.charge({ userId: ADA, amount: 1, kind: "chat" }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(await credits.balance(ADA)).toBe(0);
    expect((await ledger(ADA)).filter((row) => row.kind === "chat")).toHaveLength(1);
  });
});

describe("CreditsService.refund", () => {
  it("gives a charge back with a positive refund row, restoring the balance", async () => {
    await credits.grantSignup(ADA, 3);
    const { eventId } = await credits.charge({ userId: ADA, amount: 2, kind: "tailor" });
    expect(await credits.refund({ userId: ADA, amount: 2, ref: eventId ?? undefined })).toEqual({ credits: 3 });
    expect(await credits.balance(ADA)).toBe(3);
    expect(await ledgerSum(ADA)).toBe(3);
    expect((await ledger(ADA)).find((row) => row.kind === "refund")).toMatchObject({ amount: 2, ref: eventId });
  });

  it("does nothing for an amount of 0", async () => {
    expect(await credits.refund({ userId: ADA, amount: 0 })).toEqual({ credits: 0 });
    expect(await ledger(ADA)).toEqual([]);
  });

  it("fails without writing a row for an account that has no plan row", async () => {
    await db.delete(userPlans).where(eq(userPlans.userId, BOB));
    await expect(credits.refund({ userId: BOB, amount: 1 })).rejects.toThrow();
    expect(await ledger(BOB)).toEqual([]);
  });
});

describe("CreditsService.grantSignup", () => {
  // PGlite has one connection and runs transactions one after another, so the parallel pair checks the logic
  // (the second grant sees the first's row), not Postgres row locking under real parallelism.
  it("grants the starting credits once, however often it runs", async () => {
    await credits.grantSignup(ADA, 4);
    await credits.grantSignup(ADA, 4);
    await Promise.all([credits.grantSignup(BOB, 4), credits.grantSignup(BOB, 4)]);
    expect(await credits.balance(ADA)).toBe(4);
    expect(await credits.balance(BOB)).toBe(4);
    expect(await ledger(ADA)).toEqual([expect.objectContaining({ kind: "signup", amount: 4 })]);
    expect(await ledger(BOB)).toHaveLength(1);
  });

  it("writes nothing when the grant is 0", async () => {
    await credits.grantSignup(ADA, 0);
    expect(await ledger(ADA)).toEqual([]);
  });

  it("creates a missing plan row as free", async () => {
    await db.delete(userPlans).where(eq(userPlans.userId, ADA));
    await credits.grantSignup(ADA, 2);
    expect(await db.select().from(userPlans).where(eq(userPlans.userId, ADA))).toEqual([
      expect.objectContaining({ plan: "free", credits: 2 }),
    ]);
  });
});

describe("CreditsService.history", () => {
  it("lists an account's ledger newest first, up to the limit", async () => {
    await credits.grantSignup(ADA, 3, new Date("2026-10-29T10:00:00Z"));
    await credits.charge({ userId: ADA, amount: 2, kind: "tailor" }, new Date("2026-10-29T11:00:00Z"));
    await credits.charge({ userId: ADA, amount: 1, kind: "chat", ref: "app-1" }, new Date("2026-10-29T12:00:00Z"));
    await credits.grantSignup(BOB, 5);

    expect(await credits.history(ADA, 2)).toEqual([
      { id: expect.any(String), kind: "chat", amount: -1, ref: "app-1", createdAt: new Date("2026-10-29T12:00:00Z") },
      { id: expect.any(String), kind: "tailor", amount: -2, ref: null, createdAt: new Date("2026-10-29T11:00:00Z") },
    ]);
  });
});

describe("CreditsService.history ties", () => {
  it("breaks ties between rows written at the same instant by id, descending, so pages are stable", async () => {
    const at = new Date("2026-10-29T12:00:00Z");
    await credits.grantSignup(ADA, 5, at);
    await credits.charge({ userId: ADA, amount: 1, kind: "chat" }, at);
    await credits.charge({ userId: ADA, amount: 1, kind: "chat" }, at);
    const ids = (await credits.history(ADA, 10)).map((row) => row.id);
    expect(ids).toEqual([...ids].sort().reverse());
  });
});

describe("the ledger invariant", () => {
  it("keeps the cached balance equal to the sum of the account's ledger rows through every kind of change", async () => {
    const noon = new Date("2026-10-29T12:00:00Z");
    const watched = new Date("2026-10-29T12:00:07Z");
    const cachedBalance = async () => (await db.select().from(userPlans).where(eq(userPlans.userId, ADA)))[0].credits;
    const steps: Array<() => Promise<unknown>> = [
      () => credits.grantSignup(ADA, 2),
      async () => credits.grantAd({ userId: ADA, ...(await credits.startAdSession({ userId: ADA, ip: "203.0.113.1", provider: "test" }, noon)) }, watched),
      async () => credits.grantAd({ userId: ADA, ...(await credits.startAdSession({ userId: ADA, ip: "203.0.113.1", provider: "test" }, noon)) }, watched),
      () => credits.charge({ userId: ADA, amount: 3, kind: "tailor" }),
      () => credits.charge({ userId: ADA, amount: 5, kind: "chat" }).catch((err: unknown) => expect(err).toMatchObject({ status: 402 })),
      () => credits.refund({ userId: ADA, amount: 3, ref: "charge" }),
    ];
    for (const step of steps) {
      await step();
      expect(await cachedBalance()).toBe(await ledgerSum(ADA));
    }
    expect(await cachedBalance()).toBe(4);
    expect((await ledger(ADA)).map((row) => row.kind).sort()).toEqual(["ad", "ad", "refund", "signup", "tailor"]);
  });
});

describe("credit_events", () => {
  it("keeps an anonymised ledger when the account is deleted", async () => {
    await credits.grantSignup(ADA, 3);
    await db.delete(user).where(eq(user.id, ADA));
    expect(await db.select().from(creditEvents)).toEqual([expect.objectContaining({ userId: null, kind: "signup", amount: 3 })]);
  });

  it("refuses a kind the app does not know", async () => {
    await expect(db.execute(sql`insert into credit_events (user_id, kind, amount) values (${ADA}, 'gift', 1)`)).rejects.toThrow();
  });
});
