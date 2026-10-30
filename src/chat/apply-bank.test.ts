import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BankInputSchema, BankSchema } from "@/bank/schema";
import { applyBankChanges } from "./apply-bank";
import { type BankChange, EMPTY_BANK_CHANGE } from "./schema";

const bank = BankSchema.parse(JSON.parse(readFileSync("data/example/bank.json", "utf8")));
let n = 0;
const makeId = (p: string) => `${p}_${++n}`;
const blank: BankChange = { kind: "setSummary", ...EMPTY_BANK_CHANGE };

describe("applyBankChanges", () => {
  it("adds an entry at the top with deduped bullets and keeps the bank valid", () => {
    const { bank: next, applied } = applyBankChanges(
      bank,
      [{ ...blank, kind: "addEntry", section: "experience", entry: { title: "Barista", org: "Cafe", location: "", start: "2021", end: "2022", link: "", bullets: ["Served 200 customers a day", " ", "Served 200 customers a day"] } }],
      makeId,
    );
    expect(next.experience[0].title).toBe("Barista");
    expect(next.experience[0].bullets).toHaveLength(1);
    expect(applied[0]).toContain("Barista");
    expect(BankSchema.safeParse(next).success).toBe(true);
    expect(bank.experience).toHaveLength(2);
  });

  it("adds bullets to an existing entry, skipping duplicates", () => {
    const existing = bank.experience[0].bullets[0].text;
    const { bank: next, applied } = applyBankChanges(bank, [{ ...blank, kind: "addBullets", entryId: "e_exp1", texts: [existing, "Mentored two interns"] }], makeId);
    expect(next.experience[0].bullets).toHaveLength(5);
    expect(applied[0]).toContain("1 bullet");
  });

  it("edits, removes and updates by id, and warns on unknown targets", () => {
    const { bank: next, applied, warnings } = applyBankChanges(
      bank,
      [
        { ...blank, kind: "editBullet", entryId: "e_exp1", bulletId: "b_exp1b", text: "Cut latency" },
        { ...blank, kind: "removeBullet", entryId: "e_exp1", bulletId: "b_exp1c" },
        { ...blank, kind: "updateEntry", entryId: "e_exp2", entry: { ...EMPTY_BANK_CHANGE.entry, title: "Lead TA" } },
        { ...blank, kind: "removeEntry", entryId: "e_ghost" },
      ],
      makeId,
    );
    expect(next.experience[0].bullets.map((b) => b.text)).toContain("Cut latency");
    expect(next.experience[0].bullets.some((b) => b.id === "b_exp1c")).toBe(false);
    expect(next.experience[1].title).toBe("Lead TA");
    expect(applied).toHaveLength(3);
    expect(warnings[0]).toContain("e_ghost");
  });

  it("adds and removes skills case-insensitively, creating a category when needed", () => {
    const { bank: next } = applyBankChanges(
      bank,
      [
        { ...blank, kind: "addSkills", category: "programming", texts: ["go", "Rust"] },
        { ...blank, kind: "addSkills", category: "Cloud", texts: ["AWS"] },
        { ...blank, kind: "removeSkills", category: "Frameworks", texts: ["react"] },
      ],
      makeId,
    );
    expect(next.skills[0].items).toEqual([...bank.skills[0].items, "Rust"]);
    expect(next.skills.at(-1)).toMatchObject({ name: "Cloud", items: ["AWS"] });
    expect(next.skills[2].items).not.toContain("React");
  });

  it("sets the summary and profile fields", () => {
    const { bank: next } = applyBankChanges(bank, [
      { ...blank, kind: "setSummary", text: "New summary" },
      { ...blank, kind: "setProfileField", field: "linkedin", text: "https://linkedin.com/in/x" },
    ]);
    expect(next.summary).toBe("New summary");
    expect(next.profile.linkedin).toBe("https://linkedin.com/in/x");
  });
});

describe("applyBankChanges caps (stored banks must stay within what the bank editor may save)", () => {
  const long = "x".repeat(601);

  it("skips an added bullet over 600 characters with a warning, keeping the others", () => {
    const { bank: next, applied, warnings } = applyBankChanges(
      bank,
      [{ ...blank, kind: "addBullets", entryId: "e_exp1", texts: [long, "Mentored two interns"] }],
      makeId,
    );
    expect(next.experience[0].bullets.map((b) => b.text)).toContain("Mentored two interns");
    expect(next.experience[0].bullets.some((b) => b.text === long)).toBe(false);
    expect(applied[0]).toContain("1 bullet");
    expect(warnings).toEqual([`Skipped 1 bullet over 600 characters in "${bank.experience[0].title}"`]);
    expect(BankInputSchema.safeParse(next).success).toBe(true);
  });

  it("warns instead of adding when every new bullet is too long", () => {
    const { bank: next, warnings } = applyBankChanges(bank, [{ ...blank, kind: "addBullets", entryId: "e_exp1", texts: [long, long + "y"] }], makeId);
    expect(next).toBe(bank);
    expect(warnings).toEqual([`Skipped 2 bullets over 600 characters in "${bank.experience[0].title}"`]);
  });

  it("adds an entry without its over-long bullets, with a warning", () => {
    const entry = { ...EMPTY_BANK_CHANGE.entry, title: "Barista", bullets: [long, "Served 200 customers a day"] };
    const { bank: next, warnings } = applyBankChanges(bank, [{ ...blank, kind: "addEntry", section: "experience", entry }], makeId);
    expect(next.experience[0].bullets.map((b) => b.text)).toEqual(["Served 200 customers a day"]);
    expect(warnings).toEqual(['Skipped 1 bullet over 600 characters in "Barista"']);
  });

  it("skips an edit to over 600 characters, keeping the bullet as it was", () => {
    const { bank: next, warnings } = applyBankChanges(bank, [{ ...blank, kind: "editBullet", entryId: "e_exp1", bulletId: "b_exp1b", text: long }], makeId);
    expect(next).toBe(bank);
    expect(warnings).toEqual([`Skipped an edit to a bullet in "${bank.experience[0].title}": over 600 characters`]);
  });

  it("skips a summary over 2,000 characters", () => {
    const { bank: next, warnings } = applyBankChanges(bank, [{ ...blank, kind: "setSummary", text: "y".repeat(2_001) }], makeId);
    expect(next.summary).toBe(bank.summary);
    expect(warnings).toEqual(["Skipped the new summary: over 2,000 characters"]);
  });

  it("accepts text exactly at the caps", () => {
    const { bank: next, warnings } = applyBankChanges(
      bank,
      [
        { ...blank, kind: "setSummary", text: "y".repeat(2_000) },
        { ...blank, kind: "editBullet", entryId: "e_exp1", bulletId: "b_exp1b", text: "z".repeat(600) },
      ],
      makeId,
    );
    expect(warnings).toEqual([]);
    expect(BankInputSchema.safeParse(next).success).toBe(true);
  });
});
