import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { BankRepository } from "./repository";
import { emptyBank } from "./schema";

let root: string;
let repo: BankRepository;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "bank-repo-"));
  repo = new BankRepository(root);
});
afterEach(() => rm(root, { recursive: true, force: true }));

describe("BankRepository", () => {
  it("lists no profiles when the data dir does not exist", async () => {
    expect(await new BankRepository(path.join(root, "missing")).listProfiles()).toEqual([]);
  });

  it("creates a profile, then reads it back and lists it", async () => {
    const created = await repo.createProfile("sam", "Sam Smith");
    expect(created.profile.name).toBe("Sam Smith");
    expect(await repo.listProfiles()).toEqual(["sam"]);
    const read = await repo.read("sam");
    expect(read).toEqual(created);
  });

  it("refuses to create a profile twice", async () => {
    await repo.createProfile("sam", "");
    await expect(repo.createProfile("sam", "")).rejects.toMatchObject({ status: 409 });
  });

  it("rejects invalid slugs", async () => {
    await expect(repo.read("../etc")).rejects.toBeInstanceOf(AppError);
    await expect(repo.read("Bad Slug")).rejects.toMatchObject({ status: 400 });
  });

  it("404s on an unknown profile", async () => {
    await expect(repo.read("nobody")).rejects.toMatchObject({ status: 404 });
  });

  it("writes atomically and validates", async () => {
    await repo.createProfile("sam", "");
    const bank = { ...emptyBank("Sam"), summary: "hello" };
    await repo.write("sam", bank);
    expect((await repo.read("sam")).summary).toBe("hello");
    await expect(repo.write("sam", { nope: true })).rejects.toMatchObject({ status: 400 });
    expect((await readFile(path.join(root, "sam", "bank.json"), "utf8")).endsWith("\n")).toBe(true);
  });

  it("refuses to read a corrupt bank file", async () => {
    await mkdir(path.join(root, "sam"), { recursive: true });
    await writeFile(path.join(root, "sam", "bank.json"), "{ not json", "utf8");
    await expect(repo.read("sam")).rejects.toMatchObject({ status: 500 });
  });
});
