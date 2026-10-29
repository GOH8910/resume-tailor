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

const limits2 = { experienceBullets: 2, projectEntries: 3, projectBullets: 5, educationBullets: 2 };

describe("validateTailorResult", () => {
  it("keeps valid selections and normalises edits", () => {
    const { result, warnings } = validateTailorResult(bank, base);
    const exp = result.experience[0];
    const edits = Object.fromEntries(exp.bullets.map((b) => [b.bulletId, b.edited]));
    expect(edits.b_exp1b).toBe("Cut p95 API latency from 800ms to 120ms with Redis caching.");
    // edit identical to the original is normalised to null
    expect(edits.b_exp1c).toBeNull();
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

  it("puts a forgotten pinned bullet back at its bank position", () => {
    const { result } = validateTailorResult(bank, base);
    expect(result.experience[0].bullets.map((b) => b.bulletId)).toEqual(["b_exp1a", "b_exp1b", "b_exp1c"]);
  });

  it("ignores blank draft bullets even when pinned or selected", () => {
    const withDraft = {
      ...bank,
      experience: [{ ...bank.experience[0], bullets: [...bank.experience[0].bullets, { id: "b_blank", text: "  ", pinned: true }] }],
    };
    const sel: TailorResult = {
      ...base,
      experience: [{ entryId: "e_exp1", rationale: "", bullets: [{ bulletId: "b_exp1b", edited: null }, { bulletId: "b_blank", edited: "Invented" }] }],
    };
    const { result, warnings } = validateTailorResult(withDraft, sel, limits2);
    expect(result.experience[0].bullets.map((b) => b.bulletId)).toEqual(["b_exp1a", "b_exp1b"]);
    expect(warnings.some((w) => w.includes("b_blank"))).toBe(true);
  });

  it("keeps all pinned bullets over the limit and does not claim to have trimmed", () => {
    const allPinned = {
      ...bank,
      experience: [{ ...bank.experience[0], bullets: bank.experience[0].bullets.map((b) => ({ ...b, pinned: true })) }],
    };
    const sel: TailorResult = { ...base, experience: [{ entryId: "e_exp1", rationale: "", bullets: [] }] };
    const { result, warnings } = validateTailorResult(allPinned, sel, limits2);
    expect(result.experience[0].bullets).toHaveLength(4);
    expect(warnings.some((w) => w.startsWith("Trimmed"))).toBe(false);
    expect(warnings.some((w) => w.includes("over the limit"))).toBe(true);
  });

  it("applies the project limit before validating bullets and names what it dropped", () => {
    const twoProjects = { ...bank, projects: [bank.projects[0], { ...bank.projects[0], id: "e_prj2", title: "Second" }] };
    const sel: TailorResult = {
      ...base,
      projects: [
        { entryId: "e_prj1", rationale: "", bullets: [{ bulletId: "b_prj1a", edited: null }] },
        { entryId: "e_prj2", rationale: "", bullets: [{ bulletId: "b_ghost", edited: null }] },
      ],
    };
    const { result, warnings } = validateTailorResult(twoProjects, sel, { ...limits2, projectEntries: 1 });
    expect(result.projects.map((p) => p.entryId)).toEqual(["e_prj1"]);
    expect(warnings.some((w) => w.includes("Second"))).toBe(true);
    expect(warnings.some((w) => w.includes("b_ghost"))).toBe(false);
  });

  it("warns when an entry ends up with no bullets", () => {
    const sel: TailorResult = { ...base, projects: [{ entryId: "e_prj1", rationale: "", bullets: [{ bulletId: "b_ghost", edited: null }] }] };
    const { warnings } = validateTailorResult(bank, sel);
    expect(warnings.some((w) => w.includes("Trail Planner") && w.includes("no bullets"))).toBe(true);
  });

  it("warns on duplicate skill categories and trims notes", () => {
    const sel: TailorResult = { ...base, skills: [{ name: "Programming", items: ["Go"] }, { name: "programming", items: ["Python"] }], notes: "  hi  " };
    const { result, warnings } = validateTailorResult(bank, sel);
    expect(result.skills).toEqual([{ name: "Programming", items: ["Go"] }]);
    expect(warnings.some((w) => w.includes("twice"))).toBe(true);
    expect(result.notes).toBe("hi");
  });

  it("does not mutate the bank", () => {
    const snapshot = JSON.stringify(bank);
    validateTailorResult(bank, base);
    expect(JSON.stringify(bank)).toBe(snapshot);
  });
});

describe("validateTailorResult caps (a saved resume must stay one the review screen can save)", () => {
  it("drops a rewrite over 600 characters and keeps the original bullet, with a warning", () => {
    const long = "x".repeat(601);
    const raw: TailorResult = {
      ...base,
      experience: [{ entryId: "e_exp1", rationale: "r", bullets: [{ bulletId: "b_exp1b", edited: long }] }],
    };
    const { result, warnings } = validateTailorResult(bank, raw);
    expect(result.experience[0].bullets.find((b) => b.bulletId === "b_exp1b")?.edited).toBeNull();
    expect(warnings).toContain(`Claude's rewrite of a bullet in "${bank.experience[0].title}" was over 600 characters; kept your original`);
  });

  it("keeps a rewrite of exactly 600 characters", () => {
    const raw: TailorResult = {
      ...base,
      experience: [{ entryId: "e_exp1", rationale: "r", bullets: [{ bulletId: "b_exp1b", edited: "x".repeat(600) }] }],
    };
    const bullets = validateTailorResult(bank, raw).result.experience[0].bullets;
    expect(bullets.find((b) => b.bulletId === "b_exp1b")?.edited).toBe("x".repeat(600));
  });

  it("uses the master summary when Claude's is over 2,000 characters", () => {
    const { result, warnings } = validateTailorResult(bank, { ...base, summary: "y".repeat(2_001) });
    expect(result.summary).toBe(bank.summary);
    expect(warnings).toContain("Claude's summary was over 2,000 characters; using the master summary instead");
  });
});
