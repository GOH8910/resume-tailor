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

  it("rejects a bank without a version", () => {
    const result = BankSchema.safeParse({ profile: {}, summary: "" });
    expect(result.success).toBe(false);
  });

  it("accepts an empty draft bullet and entry (the editor creates these while typing)", () => {
    const bank = emptyBank("A");
    const draft = { ...bank, experience: [{ id: "e1", title: "", start: "", end: "", bullets: [{ id: "b1", text: "" }] }] };
    expect(BankSchema.safeParse(draft).success).toBe(true);
  });

  it("emptyBank is valid and carries the name", () => {
    const bank = emptyBank("Sam");
    expect(BankSchema.parse(bank).profile.name).toBe("Sam");
  });
});
