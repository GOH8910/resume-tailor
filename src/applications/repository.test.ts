import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
    await repo.save("sam", app("2026-10-01-acme-aaaaaaaa", "2026-10-01T00:00:00Z"));
    await repo.save("sam", app("2026-10-02-acme-bbbbbbbb", "2026-10-02T00:00:00Z"));
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
    await repo.save("sam", app("2026-10-01-acme-aaaaaaaa", "2026-10-01T00:00:00Z"));
    await repo.savePdf("sam", "2026-10-01-acme-aaaaaaaa", Buffer.from("x"));
    await repo.delete("sam", "2026-10-01-acme-aaaaaaaa");
    expect(await repo.list("sam")).toEqual([]);
    expect(await repo.readPdf("sam", "2026-10-01-acme-aaaaaaaa")).toBeNull();
  });

  it("rejects an application that fails validation", async () => {
    await expect(repo.save("sam", { id: "x" })).rejects.toMatchObject({ status: 400 });
  });
});
