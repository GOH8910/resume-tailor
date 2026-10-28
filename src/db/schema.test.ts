import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Application } from "@/applications/schema";
import { applications, user } from "./schema";
import { createTestDb } from "./test-db";

describe("applications table", () => {
  let test: Awaited<ReturnType<typeof createTestDb>>;

  beforeEach(async () => {
    test = await createTestDb();
    await test.db.insert(user).values({ id: "u1", name: "Ada", email: "ada@example.com" });
  });

  afterEach(() => test.close());

  it("round-trips the pdf as a Buffer", async () => {
    const pdf = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff]);
    await test.db.insert(applications).values({ userId: "u1", id: "a1", data: {} as Application, pdf, pdfPages: 1 });

    const [row] = await test.db.select().from(applications).where(eq(applications.id, "a1"));

    expect(Buffer.isBuffer(row.pdf)).toBe(true);
    expect(row.pdf?.equals(pdf)).toBe(true);
  });

  it("bumps updatedAt on update", async () => {
    await test.db.insert(applications).values({ userId: "u1", id: "a1", data: {} as Application });
    const [before] = await test.db.select().from(applications).where(eq(applications.id, "a1"));

    // Postgres now() has microsecond precision, the JS Date set on update only milliseconds.
    await new Promise((resolve) => setTimeout(resolve, 10));
    await test.db.update(applications).set({ pdfPages: 2 }).where(eq(applications.id, "a1"));
    const [after] = await test.db.select().from(applications).where(eq(applications.id, "a1"));

    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
    expect(after.createdAt.getTime()).toBe(before.createdAt.getTime());
  });
});
