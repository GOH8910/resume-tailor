import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { user, userPlans } from "@/db/schema";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { PlansRepository } from "./plans-repo";

let close: () => Promise<void>;
let db: Db;
let repo: PlansRepository;
const USER = "user_1";

beforeEach(async () => {
  const t = await createTestDb();
  close = t.close;
  db = t.db;
  await t.db.insert(user).values({ id: USER, name: "Ada", email: "ada@example.com" });
  repo = new PlansRepository(async () => t.db);
});
afterEach(() => close());

const rows = () => db.select().from(userPlans).where(eq(userPlans.userId, USER));

describe("PlansRepository", () => {
  it("creates a free plan with no credits for an account without one, once, and says when it did", async () => {
    expect(await repo.get(USER, "free")).toEqual({ plan: "free", credits: 0, created: true });
    expect(await repo.get(USER, "free")).toEqual({ plan: "free", credits: 0, created: false });
    expect(await rows()).toHaveLength(1);
  });

  it("creates a missing row with the given plan", async () => {
    expect(await repo.get(USER, "unlimited")).toEqual({ plan: "unlimited", credits: 0, created: true });
  });

  it("never changes an existing plan through get", async () => {
    await repo.ensure(USER, "free");
    expect(await repo.get(USER, "unlimited")).toEqual({ plan: "free", credits: 0, created: false });
  });

  it("ensures a plan only when the account has none", async () => {
    await repo.ensure(USER, "unlimited");
    await repo.ensure(USER, "free"); // the sign-up hook may fire twice
    expect(await repo.get(USER, "free")).toEqual({ plan: "unlimited", credits: 0, created: false });
  });

  it("sets the plan of an existing account, keeping its credits", async () => {
    await repo.ensure(USER, "free");
    await db.update(userPlans).set({ credits: 3 }).where(eq(userPlans.userId, USER));
    await repo.setPlan(USER, "unlimited");
    expect(await repo.get(USER, "free")).toEqual({ plan: "unlimited", credits: 3, created: false });
  });

  it("sets the plan of an account without a row", async () => {
    await repo.setPlan(USER, "unlimited");
    expect(await repo.get(USER, "free")).toEqual({ plan: "unlimited", credits: 0, created: false });
  });

  it("refuses a plan the app does not know", async () => {
    await expect(db.execute(sql`insert into user_plans (user_id, plan) values (${USER}, 'pro')`)).rejects.toThrow();
  });

  it("refuses a negative credit balance", async () => {
    await repo.ensure(USER, "free");
    await expect(db.update(userPlans).set({ credits: -1 }).where(eq(userPlans.userId, USER))).rejects.toThrow();
    expect(await repo.get(USER, "free")).toEqual({ plan: "free", credits: 0, created: false });
  });

  it("is deleted with the account", async () => {
    await repo.ensure(USER, "free");
    await db.delete(user).where(eq(user.id, USER));
    expect(await rows()).toEqual([]);
  });
});
