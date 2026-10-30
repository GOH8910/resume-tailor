import * as edit from "@/applications/edit";
import { toResumeBullet } from "@/applications/resume-state";
import type { ResumeState } from "@/applications/schema";
import type { Bank, Bullet, Entry, SectionKey } from "@/bank/schema";
import { SECTION_KEYS } from "@/bank/schema";
import { MAX_CHARS } from "@/lib/input-caps";
import type { ResumeChange } from "./schema";

export type ApplyResumeResult = { state: ResumeState; applied: string[]; warnings: string[] };
type Located = { section: SectionKey; entry: Entry };

const norm = (s: string) => s.trim().toLowerCase();

/** Apply Claude's resume changes to the review state. Pure, so the review screen can run it client-side. */
export function applyResumeChanges(state: ResumeState, bank: Bank, changes: ResumeChange[]): ApplyResumeResult {
  const applied: string[] = [];
  const warnings: string[] = [];
  let next = state;
  for (const c of changes) {
    const result = applyOne(next, bank, c);
    if (typeof result === "string") {
      warnings.push(result);
      continue;
    }
    if (result.state === next) {
      warnings.push(`${c.kind}: nothing changed`);
      continue;
    }
    next = result.state;
    applied.push(result.message);
  }
  return { state: next, applied, warnings };
}

type Step = { state: ResumeState; message: string } | string;

function applyOne(state: ResumeState, bank: Bank, c: ResumeChange): Step {
  switch (c.kind) {
    case "setSummary": {
      const text = c.text.trim();
      if (!text) return "setSummary needs text";
      // Over the cap, the review screen could not save the result.
      if (text.length > MAX_CHARS.summary) return `Skipped the new summary: over ${MAX_CHARS.summary.toLocaleString("en")} characters`;
      return { state: edit.setSummary(state, text), message: "Rewrote the summary" };
    }
    case "setSkills": {
      if (c.skills.length === 0) return "setSkills needs skills";
      const skills = c.skills.flatMap((cat) => {
        const bankCat = bank.skills.find((s) => norm(s.name) === norm(cat.name));
        return bankCat ? [{ id: bankCat.id, name: bankCat.name, items: cat.items.map((i) => i.trim()).filter(Boolean) }] : [];
      });
      return { state: edit.setSkills(state, skills), message: "Updated the skills section" };
    }
    default:
      break;
  }
  const located = locateEntry(bank, c);
  if (!located) return `Could not find the entry for ${c.kind} (${c.entryId || c.entryTitle || "no id or title"})`;
  const { section, entry } = located;
  const dir = c.direction === "up" ? -1 : 1;
  switch (c.kind) {
    case "includeEntry":
      return { state: edit.includeEntry(state, bank, section, entry.id), message: `Added "${entry.title}" to the resume` };
    case "excludeEntry":
      return { state: edit.excludeEntry(state, section, entry.id), message: `Removed "${entry.title}" from the resume` };
    case "moveEntry":
      return { state: edit.moveEntry(state, section, entry.id, dir), message: `Moved "${entry.title}" ${c.direction || "down"}` };
    case "addBullet": {
      const bullet = locateBullet(entry, c);
      if (!bullet) return `Could not find that bullet in "${entry.title}"`;
      if (!state[section].some((e) => e.entryId === entry.id)) {
        // The entry is not on the resume yet: bring it in with just this bullet.
        const added = { entryId: entry.id, rationale: "Added via chat", bullets: [toResumeBullet(bullet)] };
        return { state: { ...state, [section]: [...state[section], added] }, message: `Added "${entry.title}" with one bullet` };
      }
      return { state: edit.addBullet(state, section, entry.id, bullet, bank), message: `Added a bullet to "${entry.title}"` };
    }
    case "removeBullet": {
      const bullet = locateBullet(entry, c);
      if (!bullet) return `Could not find that bullet in "${entry.title}"`;
      return { state: edit.removeBullet(state, section, entry.id, bullet.id), message: `Removed a bullet from "${entry.title}"` };
    }
    case "editBullet": {
      const bullet = locateBullet(entry, c);
      const text = c.text.trim();
      if (!bullet || !text) return `editBullet for "${entry.title}" needs a bullet and text`;
      if (text.length > MAX_CHARS.bullet) {
        return `Skipped a reworded bullet in "${entry.title}": over ${MAX_CHARS.bullet.toLocaleString("en")} characters`;
      }
      return { state: edit.setBulletText(state, section, entry.id, bullet.id, text), message: `Reworded a bullet in "${entry.title}"` };
    }
    case "moveBullet": {
      const bullet = locateBullet(entry, c);
      if (!bullet) return `Could not find that bullet in "${entry.title}"`;
      return { state: edit.moveBullet(state, section, entry.id, bullet.id, dir), message: `Moved a bullet ${c.direction || "down"} in "${entry.title}"` };
    }
    default:
      return `Unsupported change ${c.kind}`;
  }
}

/** Find a bank entry by id, or by title when Claude has no id (e.g. an entry it just added to the bank). */
function locateEntry(bank: Bank, c: ResumeChange): Located | null {
  const sections: SectionKey[] = c.section ? [c.section] : [...SECTION_KEYS];
  if (c.entryId) {
    for (const section of sections) {
      const entry = bank[section].find((e) => e.id === c.entryId);
      if (entry) return { section, entry };
    }
  }
  const title = norm(c.entryTitle);
  if (title) {
    for (const section of sections) {
      const entry = bank[section].find((e) => norm(e.title) === title) ?? bank[section].find((e) => norm(e.title).includes(title));
      if (entry) return { section, entry };
    }
  }
  return null;
}

function locateBullet(entry: Entry, c: ResumeChange): Bullet | null {
  if (c.bulletId) return entry.bullets.find((b) => b.id === c.bulletId) ?? null;
  const text = norm(c.bulletText);
  if (!text) return null;
  return entry.bullets.find((b) => norm(b.text) === text) ?? entry.bullets.find((b) => norm(b.text).includes(text)) ?? null;
}
