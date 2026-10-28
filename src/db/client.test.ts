import { describe, expect, it } from "vitest";
import { user } from "./schema";
import { createTestDb } from "./test-db";

describe("database", () => {
  it("applies the migrations to an empty PGlite", async () => {
    const { db, close } = await createTestDb();
    try {
      expect(await db.select().from(user)).toEqual([]);
    } finally {
      await close();
    }
  });
});
