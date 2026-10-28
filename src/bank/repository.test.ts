import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { banks, user } from "@/db/schema";
import { createTestDb } from "@/db/test-db";
import type { Db } from "@/db/types";
import { BankRepository } from "./repository";
import { emptyBank } from "./schema";

let close: () => Promise<void>;
let repo: BankRepository;
let db: Db;
const USER = "user_1";

beforeEach(async () => {
  const t = await createTestDb();
  close = t.close;
  db = t.db;
  await t.db.insert(user).values({ id: USER, name: "Ed", email: "ed@example.com" });
  repo = new BankRepository(async () => t.db);
});
afterEach(() => close());

describe("BankRepository", () => {
  it("returns an empty bank for a user without one, and persists it", async () => {
    expect(await repo.read(USER)).toEqual(emptyBank(""));
    expect(await db.select().from(banks).where(eq(banks.userId, USER))).toHaveLength(1);
    expect(await repo.read(USER)).toEqual(emptyBank(""));
  });
  it("creates an empty bank once", async () => {
    await repo.createEmpty(USER, "Ed");
    await repo.createEmpty(USER, "Ed"); // idempotent: the sign-in hook may fire twice
    expect((await repo.read(USER)).profile.name).toBe("Ed");
  });
  it("validates on write and round-trips", async () => {
    await expect(repo.write(USER, { nope: true })).rejects.toMatchObject({ status: 400 });
    const bank = { ...emptyBank("Ed"), summary: "Hello" };
    await repo.write(USER, bank);
    expect(await repo.read(USER)).toEqual(bank);
  });
  it("never overwrites an existing bank when asked to create an empty one", async () => {
    await repo.write(USER, { ...emptyBank("Ed"), summary: "Hello" });
    await repo.createEmpty(USER, "Other");
    expect((await repo.read(USER)).summary).toBe("Hello");
  });
});
