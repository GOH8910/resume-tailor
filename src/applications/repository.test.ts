import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { user } from "@/db/schema";
import { createTestDb } from "@/db/test-db";
import { ApplicationRepository } from "./repository";
import type { Application } from "./schema";

let close: () => Promise<void>;
let repo: ApplicationRepository;
const USER = "user_1";
const OTHER = "user_2";
const OLDER = "2026-10-01-acme-aaaaaaaa";
const NEWER = "2026-10-02-acme-bbbbbbbb";

const app = (id: string, createdAt: string, company = "Acme"): Application => ({
  id,
  createdAt,
  company,
  roleTitle: "SWE",
  jobDescription: "Build things",
  model: "manual",
  warnings: [],
  notes: "",
  resume: { summary: "", education: [], experience: [], projects: [], skills: [] },
});

beforeEach(async () => {
  const t = await createTestDb();
  close = t.close;
  await t.db.insert(user).values([
    { id: USER, name: "Ed", email: "ed@example.com" },
    { id: OTHER, name: "Sam", email: "sam@example.com" },
  ]);
  repo = new ApplicationRepository(async () => t.db);
});
afterEach(() => close());

describe("ApplicationRepository", () => {
  it("lists nothing for a user with no applications", async () => {
    expect(await repo.list(USER)).toEqual([]);
  });

  it("lists newest first with the summary fields and pdf flag", async () => {
    await repo.save(USER, app(OLDER, "2026-10-01T00:00:00.000Z"));
    await repo.save(USER, app(NEWER, "2026-10-02T00:00:00.000Z"));
    await repo.savePdf(USER, OLDER, Buffer.from("%PDF-fake"), 1);
    expect(await repo.list(USER)).toEqual([
      { id: NEWER, createdAt: "2026-10-02T00:00:00.000Z", company: "Acme", roleTitle: "SWE", model: "manual", hasPdf: false },
      { id: OLDER, createdAt: "2026-10-01T00:00:00.000Z", company: "Acme", roleTitle: "SWE", model: "manual", hasPdf: true },
    ]);
  });

  it("404s on an unknown id and 400s on a malformed one", async () => {
    await expect(repo.get(USER, OLDER)).rejects.toMatchObject({ status: 404 });
    await expect(repo.get(USER, "../bank")).rejects.toMatchObject({ status: 400 });
  });

  it("validates on save and upserts", async () => {
    await expect(repo.save(USER, { id: "x" })).rejects.toMatchObject({ status: 400 });
    await repo.save(USER, app(OLDER, "2026-10-01T00:00:00.000Z"));
    const updated = { ...app(OLDER, "2026-10-01T00:00:00.000Z"), company: "Globex" };
    await repo.save(USER, updated);
    expect(await repo.get(USER, OLDER)).toEqual(updated);
    expect(await repo.list(USER)).toHaveLength(1);
  });

  it("deletes the application and its pdf, and deleting again is a no-op", async () => {
    await repo.save(USER, app(OLDER, "2026-10-01T00:00:00.000Z"));
    await repo.savePdf(USER, OLDER, Buffer.from("x"), 1);
    await repo.delete(USER, OLDER);
    await repo.delete(USER, OLDER);
    expect(await repo.list(USER)).toEqual([]);
    expect(await repo.readPdf(USER, OLDER)).toBeNull();
  });

  it("stores the compiled pdf with its page count", async () => {
    await repo.save(USER, app(OLDER, "2026-10-01T00:00:00.000Z"));
    expect(await repo.readPdf(USER, OLDER)).toBeNull();
    const pdf = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff]);
    await repo.savePdf(USER, OLDER, pdf, 2);
    const stored = await repo.readPdf(USER, OLDER);
    expect(stored?.pdf.equals(pdf)).toBe(true);
    expect(stored?.pages).toBe(2);
  });

  it("keeps the pdf when the application is saved again", async () => {
    await repo.save(USER, app(OLDER, "2026-10-01T00:00:00.000Z"));
    const pdf = Buffer.from("%PDF-kept");
    await repo.savePdf(USER, OLDER, pdf, 3);
    await repo.save(USER, { ...app(OLDER, "2026-10-01T00:00:00.000Z"), notes: "edited" });
    const stored = await repo.readPdf(USER, OLDER);
    expect(stored?.pdf.equals(pdf)).toBe(true);
    expect(stored?.pages).toBe(3);
    expect((await repo.list(USER))[0].hasPdf).toBe(true);
    expect((await repo.get(USER, OLDER)).notes).toBe("edited");
  });

  it("404s when saving a pdf for a missing application", async () => {
    await expect(repo.savePdf(USER, OLDER, Buffer.from("x"), 1)).rejects.toMatchObject({ status: 404 });
  });

  it("keeps each user's applications private", async () => {
    await repo.save(USER, app(OLDER, "2026-10-01T00:00:00.000Z"));
    await repo.savePdf(USER, OLDER, Buffer.from("x"), 1);
    await expect(repo.get(OTHER, OLDER)).rejects.toMatchObject({ status: 404 });
    expect(await repo.list(OTHER)).toEqual([]);
    expect(await repo.readPdf(OTHER, OLDER)).toBeNull();
    await expect(repo.savePdf(OTHER, OLDER, Buffer.from("y"), 1)).rejects.toMatchObject({ status: 404 });
    await repo.delete(OTHER, OLDER);
    expect((await repo.get(USER, OLDER)).id).toBe(OLDER);
  });

  it("lets two users use the same application id", async () => {
    await repo.save(USER, app(OLDER, "2026-10-01T00:00:00.000Z", "Acme"));
    await repo.save(OTHER, app(OLDER, "2026-10-01T00:00:00.000Z", "Globex"));
    expect((await repo.get(USER, OLDER)).company).toBe("Acme");
    expect((await repo.get(OTHER, OLDER)).company).toBe("Globex");
  });
});
