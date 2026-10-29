import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { BankInputSchema, BankSchema, emptyBank } from "./schema";

describe("BankSchema", () => {
  it("parses the example bank", async () => {
    const raw = JSON.parse(await readFile("data/example/bank.json", "utf8"));
    const bank = BankSchema.parse(raw);
    expect(bank.experience[0].bullets[0].pinned).toBe(true);
    expect(bank.projects[0].org).toBeUndefined();
  });

  it("requires version 1", () => {
    const missing = BankSchema.safeParse({ ...emptyBank("A"), version: undefined });
    expect(missing.success).toBe(false);
    if (!missing.success) expect(missing.error.issues.map((i) => i.path.join("."))).toEqual(["version"]);
    expect(BankSchema.safeParse({ ...emptyBank("A"), version: 2 }).success).toBe(false);
  });

  it("accepts an empty draft bullet and entry (the editor creates these while typing)", () => {
    const bank = emptyBank("A");
    const draft = {
      ...bank,
      experience: [{ id: "e1", title: "", start: "", end: "", bullets: [{ id: "b1", text: "" }] }],
      skills: [{ id: "s1", name: "", items: [] }],
    };
    expect(BankSchema.safeParse(draft).success).toBe(true);
  });

  it("defaults start and end to empty strings when omitted", () => {
    const bank = BankSchema.parse({ ...emptyBank("A"), projects: [{ id: "e1", title: "P", bullets: [] }] });
    expect(bank.projects[0]).toMatchObject({ start: "", end: "" });
  });

  it("emptyBank is valid and carries the name", () => {
    const bank = emptyBank("Sam");
    expect(BankSchema.parse(bank).profile.name).toBe("Sam");
  });
});

describe("BankInputSchema (what the editor may save)", () => {
  const withBullet = (text: string) => ({
    ...emptyBank("A"),
    experience: [{ id: "e1", title: "Engineer", start: "", end: "", bullets: [{ id: "b1", text }] }],
  });

  it("accepts a bullet of 600 characters and refuses 601", () => {
    expect(BankInputSchema.safeParse(withBullet("x".repeat(600))).success).toBe(true);
    const long = BankInputSchema.safeParse(withBullet("x".repeat(601)));
    expect(long.success).toBe(false);
    if (!long.success) {
      expect(long.error.issues[0].path.join(".")).toBe("experience.0.bullets.0.text");
      expect(long.error.issues[0].message).toBe("A bullet can be at most 600 characters");
    }
  });

  it("accepts a summary of 2,000 characters and refuses 2,001", () => {
    expect(BankInputSchema.safeParse({ ...emptyBank("A"), summary: "x".repeat(2_000) }).success).toBe(true);
    expect(BankInputSchema.safeParse({ ...emptyBank("A"), summary: "x".repeat(2_001) }).success).toBe(false);
  });

  it("caps bullets in every section", () => {
    for (const section of ["education", "experience", "projects"] as const) {
      const bank = { ...emptyBank("A"), [section]: withBullet("x".repeat(601)).experience };
      expect(BankInputSchema.safeParse(bank).success).toBe(false);
    }
  });

  it("parses to the same shape as BankSchema", async () => {
    const raw = JSON.parse(await readFile("data/example/bank.json", "utf8"));
    expect(BankInputSchema.parse(raw)).toEqual(BankSchema.parse(raw));
  });

  it("leaves stored banks uncapped, so one saved before the caps still loads", () => {
    expect(BankSchema.safeParse(withBullet("x".repeat(601))).success).toBe(true);
  });
});
