import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApplicationRepository } from "./repository";
import type { Application } from "./schema";

let root: string;
let repo: ApplicationRepository;

const app = (id: string, createdAt: string): Application => ({
  id,
  createdAt,
  company: "Acme",
  roleTitle: "SWE",
  jobDescription: "Build things",
  model: "manual",
  warnings: [],
  notes: "",
  resume: { summary: "", education: [], experience: [], projects: [], skills: [] },
});

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "apps-repo-"));
  repo = new ApplicationRepository(root);
});
afterEach(() => rm(root, { recursive: true, force: true }));

describe("ApplicationRepository", () => {
  it("lists nothing for a profile with no applications", async () => {
    expect(await repo.list("sam")).toEqual([]);
  });

  it("saves, gets, and lists newest first with pdf flag", async () => {
    await repo.save("sam", app("2026-10-01-acme-aaaaaaaa", "2026-10-01T00:00:00.000Z"));
    await repo.save("sam", app("2026-10-02-acme-bbbbbbbb", "2026-10-02T00:00:00.000Z"));
    await repo.savePdf("sam", "2026-10-01-acme-aaaaaaaa", Buffer.from("%PDF-fake"));
    const list = await repo.list("sam");
    expect(list.map((a) => a.id)).toEqual(["2026-10-02-acme-bbbbbbbb", "2026-10-01-acme-aaaaaaaa"]);
    expect(list[1].hasPdf).toBe(true);
    expect(list[0].hasPdf).toBe(false);
    expect((await repo.get("sam", "2026-10-02-acme-bbbbbbbb")).company).toBe("Acme");
    expect((await repo.readPdf("sam", "2026-10-01-acme-aaaaaaaa"))?.toString()).toBe("%PDF-fake");
    expect(await repo.readPdf("sam", "2026-10-02-acme-bbbbbbbb")).toBeNull();
  });

  it("404s on unknown ids and deletes json + pdf", async () => {
    await expect(repo.get("sam", "nope")).rejects.toMatchObject({ status: 404 });
    await repo.save("sam", app("2026-10-01-acme-aaaaaaaa", "2026-10-01T00:00:00.000Z"));
    await repo.savePdf("sam", "2026-10-01-acme-aaaaaaaa", Buffer.from("x"));
    await repo.delete("sam", "2026-10-01-acme-aaaaaaaa");
    expect(await repo.list("sam")).toEqual([]);
    expect(await repo.readPdf("sam", "2026-10-01-acme-aaaaaaaa")).toBeNull();
  });

  it("rejects an application that fails validation", async () => {
    await expect(repo.save("sam", { id: "x" })).rejects.toMatchObject({ status: 400 });
  });

  it("get reports invalid JSON, schema mismatch and id mismatch as 500", async () => {
    const dir = path.join(root, "sam", "applications");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "2026-10-01-bad-aaaaaaaa.json"), "{ nope", "utf8");
    await expect(repo.get("sam", "2026-10-01-bad-aaaaaaaa")).rejects.toMatchObject({ status: 500 });
    await writeFile(path.join(dir, "2026-10-01-old-aaaaaaaa.json"), JSON.stringify({ id: "2026-10-01-old-aaaaaaaa" }), "utf8");
    await expect(repo.get("sam", "2026-10-01-old-aaaaaaaa")).rejects.toMatchObject({ status: 500, details: expect.anything() });
    await repo.save("sam", app("2026-10-01-acme-aaaaaaaa", "2026-10-01T00:00:00.000Z"));
    await writeFile(path.join(dir, "2026-10-01-acme-bbbbbbbb.json"), await readFile(path.join(dir, "2026-10-01-acme-aaaaaaaa.json")));
    await expect(repo.get("sam", "2026-10-01-acme-bbbbbbbb")).rejects.toMatchObject({ status: 500 });
  });

  it("list skips unreadable and stray files but returns the good ones", async () => {
    const dir = path.join(root, "sam", "applications");
    await repo.save("sam", app("2026-10-01-acme-aaaaaaaa", "2026-10-01T00:00:00.000Z"));
    await writeFile(path.join(dir, "2026-10-01-bad-aaaaaaaa.json"), "{ nope", "utf8");
    await writeFile(path.join(dir, "2026-10-01-acme-aaaaaaaa copy.json"), "{}", "utf8");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const list = await repo.list("sam");
    warn.mockRestore();
    expect(list.map((a) => a.id)).toEqual(["2026-10-01-acme-aaaaaaaa"]);
  });

  it("validates ids and slugs before touching the disk", async () => {
    await expect(repo.get("sam", "../bank")).rejects.toMatchObject({ status: 400 });
    await expect(repo.list("../x")).rejects.toMatchObject({ status: 400 });
    await expect(repo.savePdf("sam", "2026-10-01-none-aaaaaaaa", Buffer.from("x"))).rejects.toMatchObject({ status: 404 });
  });
});
