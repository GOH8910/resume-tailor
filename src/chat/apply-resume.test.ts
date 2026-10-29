import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fullStateFromBank } from "@/applications/resume-state";
import { ResumeStateInputSchema } from "@/applications/schema";
import { BankSchema } from "@/bank/schema";
import { applyResumeChanges } from "./apply-resume";
import { EMPTY_RESUME_CHANGE, type ResumeChange } from "./schema";

const bank = BankSchema.parse(JSON.parse(readFileSync("data/example/bank.json", "utf8")));
const state = fullStateFromBank(bank);
const blank: ResumeChange = { kind: "setSummary", ...EMPTY_RESUME_CHANGE };

describe("applyResumeChanges", () => {
  it("excludes, re-includes by title, and adds a bullet matched by text", () => {
    const r1 = applyResumeChanges(state, bank, [{ ...blank, kind: "excludeEntry", entryTitle: "teaching assistant" }]);
    expect(r1.state.experience.map((e) => e.entryId)).toEqual(["e_exp1"]);
    const r2 = applyResumeChanges(r1.state, bank, [{ ...blank, kind: "removeBullet", entryId: "e_exp1", bulletText: "Playwright end-to-end tests" }]);
    expect(r2.state.experience[0].bullets.some((b) => b.bulletId === "b_exp1c")).toBe(false);
    const r3 = applyResumeChanges(r2.state, bank, [{ ...blank, kind: "addBullet", entryTitle: "Software Engineer Intern", bulletText: "playwright end-to-end tests" }]);
    expect(r3.state.experience[0].bullets.map((b) => b.bulletId)).toContain("b_exp1c");
    expect(r3.applied[0]).toContain("Added a bullet");
  });

  it("adds an entry with a single bullet when it was not on the resume", () => {
    const without = applyResumeChanges(state, bank, [{ ...blank, kind: "excludeEntry", entryId: "e_prj1" }]).state;
    const { state: next } = applyResumeChanges(without, bank, [{ ...blank, kind: "addBullet", entryId: "e_prj1", bulletId: "b_prj1b" }]);
    expect(next.projects).toHaveLength(1);
    expect(next.projects[0].bullets.map((b) => b.bulletId)).toEqual(["b_prj1b"]);
  });

  it("rewords, moves, sets the summary and skills, and reports no-ops and unknowns", () => {
    const { state: next, applied, warnings } = applyResumeChanges(state, bank, [
      { ...blank, kind: "editBullet", entryId: "e_exp1", bulletId: "b_exp1a", text: "Reworded" },
      { ...blank, kind: "moveEntry", entryId: "e_exp2", direction: "up" },
      { ...blank, kind: "setSummary", text: "Short summary" },
      { ...blank, kind: "setSkills", skills: [{ name: "programming", items: ["Go"] }, { name: "Nope", items: ["x"] }] },
      { ...blank, kind: "moveEntry", entryId: "e_edu1", direction: "up" },
      { ...blank, kind: "includeEntry", entryTitle: "does not exist" },
    ]);
    expect(next.experience[1].bullets[0].text).toBe("Reworded");
    expect(next.experience.map((e) => e.entryId)).toEqual(["e_exp2", "e_exp1"]);
    expect(next.summary).toBe("Short summary");
    expect(next.skills).toEqual([{ id: "s_lang", name: "Programming", items: ["Go"] }]);
    expect(applied).toHaveLength(4);
    expect(warnings).toHaveLength(2);
    expect(state.experience[0].bullets[0].text).not.toBe("Reworded");
  });
});

describe("applyResumeChanges caps (the resume must stay one the review screen can save)", () => {
  it("skips a reworded bullet over 600 characters and a summary over 2,000, with warnings", () => {
    const { state: next, warnings } = applyResumeChanges(state, bank, [
      { ...blank, kind: "editBullet", entryId: "e_exp1", bulletId: "b_exp1a", text: "x".repeat(601) },
      { ...blank, kind: "setSummary", text: "y".repeat(2_001) },
    ]);
    expect(next).toBe(state);
    expect(warnings).toEqual([
      'Skipped a reworded bullet in "Software Engineer Intern": over 600 characters',
      "Skipped the new summary: over 2,000 characters",
    ]);
    expect(ResumeStateInputSchema.safeParse(next).success).toBe(true);
  });
});
