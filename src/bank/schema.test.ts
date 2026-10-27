import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { BankSchema, emptyBank } from "./schema";

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
