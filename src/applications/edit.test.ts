import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BankSchema } from "@/bank/schema";
import {
  addBullet,
  excludeEntry,
  includeEntry,
  moveBullet,
  moveEntry,
  moveItem,
  pruneMissing,
  removeBullet,
  revertBullet,
  setBulletText,
  setLayout,
  setSkills,
  setSummary,
} from "./edit";
import { fullStateFromBank } from "./resume-state";

// Frozen fixtures make any accidental mutation throw.
function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

const bank = deepFreeze(BankSchema.parse(JSON.parse(readFileSync("data/example/bank.json", "utf8"))));
const state = deepFreeze(fullStateFromBank(bank));
const ids = (s: typeof state) => s.experience[0].bullets.map((b) => b.bulletId);

describe("moveItem", () => {
  it("moves within bounds and copies", () => {
    const arr = [1, 2, 3];
    expect(moveItem(arr, 0, 2)).toEqual([2, 3, 1]);
    expect(moveItem(arr, 2, 0)).toEqual([3, 1, 2]);
    expect(arr).toEqual([1, 2, 3]);
  });
  it("ignores out-of-range moves", () => {
    expect(moveItem([1, 2], 1, 2)).toEqual([1, 2]);
    expect(moveItem([1, 2], 0, -1)).toEqual([1, 2]);
  });
});

describe("bullet edits", () => {
  it("sets and reverts text without mutating", () => {
    const edited = setBulletText(state, "experience", "e_exp1", "b_exp1a", "New text");
    expect(edited.experience[0].bullets[0].text).toBe("New text");
    expect(state.experience[0].bullets[0].text).not.toBe("New text");
    const reverted = revertBullet(edited, "experience", "e_exp1", "b_exp1a");
    expect(reverted.experience[0].bullets[0].text).toBe(state.experience[0].bullets[0].original);
  });

  it("removes, re-adds (once) and moves bullets", () => {
    const removed = removeBullet(state, "experience", "e_exp1", "b_exp1a");
    expect(ids(removed)).toEqual(["b_exp1b", "b_exp1c", "b_exp1d"]);
    const bullet = bank.experience[0].bullets[0];
    const added = addBullet(removed, "experience", "e_exp1", bullet, bank);
    expect(ids(added)).toEqual(["b_exp1a", "b_exp1b", "b_exp1c", "b_exp1d"]);
    expect(addBullet(added, "experience", "e_exp1", bullet, bank)).toBe(added);
    expect(ids(moveBullet(added, "experience", "e_exp1", "b_exp1a", 1))).toEqual(["b_exp1b", "b_exp1a", "b_exp1c", "b_exp1d"]);
    expect(moveBullet(added, "experience", "e_exp1", "b_exp1a", -1)).toBe(added);
  });

  it("re-adds bullets and entries at their bank position", () => {
    const removed = removeBullet(state, "experience", "e_exp1", "b_exp1b");
    expect(ids(addBullet(removed, "experience", "e_exp1", bank.experience[0].bullets[1], bank))).toEqual(["b_exp1a", "b_exp1b", "b_exp1c", "b_exp1d"]);
    const without = excludeEntry(state, "experience", "e_exp1");
    expect(includeEntry(without, bank, "experience", "e_exp1").experience.map((e) => e.entryId)).toEqual(["e_exp1", "e_exp2"]);
  });

  it("returns the same state for no-op edits", () => {
    expect(setBulletText(state, "experience", "e_exp1", "b_exp1a", state.experience[0].bullets[0].text)).toBe(state);
    expect(revertBullet(state, "experience", "e_exp1", "b_exp1a")).toBe(state);
    expect(removeBullet(state, "experience", "e_exp1", "b_ghost")).toBe(state);
    expect(moveBullet(state, "experience", "e_exp1", "b_exp1a", -1)).toBe(state);
    expect(moveEntry(state, "experience", "e_ghost", 1)).toBe(state);
    expect(excludeEntry(state, "projects", "e_ghost")).toBe(state);
    expect(setSummary(state, state.summary)).toBe(state);
    expect(addBullet(state, "experience", "e_exp1", bank.projects[0].bullets[0], bank)).toBe(state);
  });
});

describe("entry edits", () => {
  it("excludes, includes with all bullets, and moves entries", () => {
    const without = excludeEntry(state, "experience", "e_exp1");
    expect(without.experience.map((e) => e.entryId)).toEqual(["e_exp2"]);
    const back = includeEntry(without, bank, "experience", "e_exp1");
    expect(back.experience.map((e) => e.entryId)).toEqual(["e_exp1", "e_exp2"]);
    expect(back.experience[0].bullets).toHaveLength(4);
    expect(includeEntry(back, bank, "experience", "e_exp1")).toBe(back);
    expect(includeEntry(back, bank, "experience", "e_ghost")).toBe(back);
    expect(moveEntry(back, "experience", "e_exp2", -1).experience.map((e) => e.entryId)).toEqual(["e_exp2", "e_exp1"]);
  });

  it("skips bank drafts in the full state and when including an entry", () => {
    const draftBank = {
      ...bank,
      experience: [
        { ...bank.experience[0], bullets: [...bank.experience[0].bullets, { id: "b_blank", text: "  " }] },
        { id: "e_untitled", title: "", start: "", end: "", bullets: [{ id: "b_x", text: "x" }] },
      ],
      skills: [...bank.skills, { id: "s_blank", name: " ", items: ["x"] }],
    };
    const full = fullStateFromBank(draftBank);
    expect(full.experience.map((e) => e.entryId)).toEqual(["e_exp1"]);
    expect(full.experience[0].bullets.map((b) => b.bulletId)).not.toContain("b_blank");
    expect(full.skills.map((s) => s.id)).not.toContain("s_blank");
    const without = excludeEntry(full, "experience", "e_exp1");
    expect(includeEntry(without, draftBank, "experience", "e_untitled")).toBe(without);
    expect(includeEntry(without, draftBank, "experience", "e_exp1").experience[0].bullets.map((b) => b.bulletId)).not.toContain("b_blank");
  });

  it("prunes entries that no longer exist in the bank", () => {
    const smaller = { ...bank, experience: [bank.experience[1]] };
    const pruned = pruneMissing(state, smaller);
    expect(pruned.experience.map((e) => e.entryId)).toEqual(["e_exp2"]);
    expect(pruneMissing(state, bank)).toBe(state);
  });
});

describe("summary and skills", () => {
  it("replace values immutably", () => {
    expect(setSummary(state, "S").summary).toBe("S");
    const skills = setSkills(state, [{ id: "s_lang", name: "Programming", items: ["Go"] }]).skills;
    expect(skills).toEqual([{ id: "s_lang", name: "Programming", items: ["Go"] }]);
    expect(state.skills).toHaveLength(3);
  });
});

describe("setLayout", () => {
  const layout = { fontSize: 10, margins: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 } };
  it("stores a layout and returns the same state for an equal one", () => {
    const next = setLayout(state, layout);
    expect(next.layout).toEqual(layout);
    expect(setLayout(next, { ...layout, margins: { ...layout.margins } })).toBe(next);
    expect(setLayout(state, undefined)).toBe(state);
  });
  it("drops the key entirely when reset, so the bank default applies again", () => {
    const reset = setLayout(setLayout(state, layout), undefined);
    expect("layout" in reset).toBe(false);
  });
});
