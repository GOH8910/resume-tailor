import type { Pool } from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "./client";
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

describe("getDb", () => {
  const cache = globalThis as unknown as { __resumeDb?: { connection: { db: { $client: Pool } } } };
  const originalUrl = process.env.DATABASE_URL;

  afterEach(async () => {
    await cache.__resumeDb?.connection.db.$client.end();
    cache.__resumeDb = undefined;
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
  });

  it("retries the migration after a failure instead of caching the rejection", async () => {
    cache.__resumeDb = undefined;
    process.env.DATABASE_URL = "postgres://localhost:1/unreachable"; // nothing listens on port 1

    const first = await getDb().catch((err: unknown) => err);
    const second = await getDb().catch((err: unknown) => err);

    expect(first).toBeInstanceOf(Error);
    expect(second).toBeInstanceOf(Error);
    // A cached rejection would hand back the very same error object.
    expect(second).not.toBe(first);
  });
});
