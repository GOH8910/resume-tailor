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
  removeBullet,
  revertBullet,
  setBulletText,
  setSkills,
  setSummary,
} from "./edit";
import { fullStateFromBank } from "./resume-state";

const bank = BankSchema.parse(JSON.parse(readFileSync("data/example/bank.json", "utf8")));
const state = fullStateFromBank(bank);
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
    const added = addBullet(removed, "experience", "e_exp1", bullet);
    expect(ids(added)).toEqual(["b_exp1b", "b_exp1c", "b_exp1d", "b_exp1a"]);
    expect(addBullet(added, "experience", "e_exp1", bullet)).toBe(added);
    expect(ids(moveBullet(added, "experience", "e_exp1", "b_exp1a", -1))).toEqual(["b_exp1b", "b_exp1c", "b_exp1a", "b_exp1d"]);
    expect(ids(moveBullet(added, "experience", "e_exp1", "b_exp1b", -1))).toEqual(ids(added));
  });
});

describe("entry edits", () => {
  it("excludes, includes with all bullets, and moves entries", () => {
    const without = excludeEntry(state, "experience", "e_exp1");
    expect(without.experience.map((e) => e.entryId)).toEqual(["e_exp2"]);
    const back = includeEntry(without, bank, "experience", "e_exp1");
    expect(back.experience.map((e) => e.entryId)).toEqual(["e_exp2", "e_exp1"]);
    expect(back.experience[1].bullets).toHaveLength(4);
    expect(includeEntry(back, bank, "experience", "e_exp1")).toBe(back);
    expect(includeEntry(back, bank, "experience", "e_ghost")).toBe(back);
    expect(moveEntry(back, "experience", "e_exp1", -1).experience.map((e) => e.entryId)).toEqual(["e_exp1", "e_exp2"]);
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
