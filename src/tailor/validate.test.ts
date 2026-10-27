import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BankSchema } from "@/bank/schema";
import type { TailorResult } from "./schema";
import { validateTailorResult } from "./validate";

const bank = BankSchema.parse(JSON.parse(readFileSync("data/example/bank.json", "utf8")));

const base: TailorResult = {
  summary: "Tailored summary.",
  education: [{ entryId: "e_edu1", rationale: "r", bullets: [{ bulletId: "b_edu1a", edited: null }] }],
  experience: [
    {
      entryId: "e_exp1",
      rationale: "Backend match",
      bullets: [
        { bulletId: "b_exp1b", edited: "Cut p95 API latency from 800ms to 120ms with Redis caching." },
        { bulletId: "b_exp1c", edited: "Wrote Playwright end-to-end tests covering the checkout flow, catching 3 regressions before release." },
      ],
    },
  ],
  projects: [{ entryId: "e_prj1", rationale: "r", bullets: [{ bulletId: "b_prj1a", edited: null }] }],
  skills: [{ name: "programming", items: ["go", "TypeScript", "Rust"] }],
  notes: "",
};

describe("validateTailorResult", () => {
  it("keeps valid selections and normalises edits", () => {
    const { result, warnings } = validateTailorResult(bank, base);
    const exp = result.experience[0];
    expect(exp.bullets[0].edited).toBe("Cut p95 API latency from 800ms to 120ms with Redis caching.");
    // edit identical to the original is normalised to null
    expect(exp.bullets[1].edited).toBeNull();
    expect(warnings.filter((w) => w.includes("Rust"))).toHaveLength(1);
  });

  it("adds pinned bullets that were left out", () => {
    const { result } = validateTailorResult(bank, base);
    expect(result.experience[0].bullets.map((b) => b.bulletId)).toContain("b_exp1a");
  });

  it("drops unknown entry and bullet ids with warnings", () => {
    const bad: TailorResult = {
      ...base,
      experience: [
        { entryId: "e_ghost", rationale: "", bullets: [] },
        { entryId: "e_exp1", rationale: "", bullets: [{ bulletId: "b_ghost", edited: null }] },
      ],
    };
    const { result, warnings } = validateTailorResult(bank, bad);
    expect(result.experience.map((e) => e.entryId)).toEqual(["e_exp1"]);
    expect(warnings.some((w) => w.includes("e_ghost"))).toBe(true);
    expect(warnings.some((w) => w.includes("b_ghost"))).toBe(true);
  });

  it("drops duplicate entries", () => {
    const dup: TailorResult = { ...base, experience: [base.experience[0], base.experience[0]] };
    expect(validateTailorResult(bank, dup).result.experience).toHaveLength(1);
  });

  it("enforces bullet limits while keeping pinned bullets", () => {
    const many: TailorResult = {
      ...base,
      experience: [
        {
          entryId: "e_exp1",
          rationale: "",
          bullets: ["b_exp1b", "b_exp1c", "b_exp1d", "b_exp1a"].map((bulletId) => ({ bulletId, edited: null })),
        },
      ],
    };
    const { result, warnings } = validateTailorResult(bank, many, {
      experienceBullets: 2,
      projectEntries: 3,
      projectBullets: 5,
      educationBullets: 2,
    });
    const ids = result.experience[0].bullets.map((b) => b.bulletId);
    expect(ids).toHaveLength(2);
    expect(ids).toContain("b_exp1a");
    expect(ids).toContain("b_exp1b");
    expect(warnings.some((w) => w.startsWith("Trimmed"))).toBe(true);
  });

  it("limits the number of projects", () => {
    const { result, warnings } = validateTailorResult(bank, base, {
      experienceBullets: 5,
      projectEntries: 0,
      projectBullets: 5,
      educationBullets: 2,
    });
    expect(result.projects).toEqual([]);
    expect(warnings.some((w) => w.includes("projects"))).toBe(true);
  });

  it("keeps education in bank order", () => {
    const twoEdu = {
      ...bank,
      education: [bank.education[0], { ...bank.education[0], id: "e_edu2", title: "Second School" }],
    };
    const reversed: TailorResult = {
      ...base,
      education: [
        { entryId: "e_edu2", rationale: "", bullets: [] },
        { entryId: "e_edu1", rationale: "", bullets: [] },
      ],
    };
    expect(validateTailorResult(twoEdu, reversed).result.education.map((e) => e.entryId)).toEqual(["e_edu1", "e_edu2"]);
  });

  it("matches skills case-insensitively and uses the bank spelling", () => {
    const { result } = validateTailorResult(bank, base);
    expect(result.skills).toEqual([{ name: "Programming", items: ["Go", "TypeScript"] }]);
  });

  it("falls back to the master summary when Claude returns none", () => {
    const { result, warnings } = validateTailorResult(bank, { ...base, summary: "  " });
    expect(result.summary).toBe(bank.summary);
    expect(warnings.some((w) => w.includes("summary"))).toBe(true);
  });

  it("does not mutate its inputs", () => {
    const snapshot = JSON.stringify(base);
    validateTailorResult(bank, base);
    expect(JSON.stringify(base)).toBe(snapshot);
  });
});
