import { newId } from "@/bank/ids";
import type { Bank, Bullet, Entry, SectionKey, SkillCategory } from "@/bank/schema";
import { SECTION_KEYS } from "@/bank/schema";
import { MAX_CHARS } from "@/lib/input-caps";
import type { BankChange } from "./schema";

export type ApplyBankResult = { bank: Bank; applied: string[]; warnings: string[] };
type MakeId = (prefix: string) => string;
type Outcome = { ok: true; bank: Bank; message: string; warnings?: string[] } | { ok: false; message: string };

const norm = (s: string) => s.trim().toLowerCase();
const clean = (s: string | undefined): string | undefined => {
  const t = s?.trim();
  return t ? t : undefined;
};
const ok = (bank: Bank, message: string, warnings: string[] = []): Outcome => ({ ok: true, bank, message, warnings });
const fail = (message: string): Outcome => ({ ok: false, message });

/**
 * Apply Claude's bank changes in order. Unknown targets become warnings; nothing is invented. Text over the caps
 * the bank editor is held to (MAX_CHARS) is skipped with a warning, so the stored bank stays one the editor can save.
 */
export function applyBankChanges(bank: Bank, changes: BankChange[], makeId: MakeId = newId): ApplyBankResult {
  const applied: string[] = [];
  const warnings: string[] = [];
  let next = bank;
  for (const change of changes) {
    const outcome = applyOne(next, change, makeId);
    if (outcome.ok) {
      next = outcome.bank;
      applied.push(outcome.message);
      warnings.push(...(outcome.warnings ?? []));
    } else {
      warnings.push(outcome.message);
    }
  }
  return { bank: next, applied, warnings };
}

function applyOne(bank: Bank, c: BankChange, makeId: MakeId): Outcome {
  switch (c.kind) {
    case "addEntry":
      return addEntry(bank, c, makeId);
    case "updateEntry":
      return withEntry(bank, c, (section, index, entry) => {
        // "" means unchanged; a field cannot be cleared through chat, only edited in the bank editor.
        const f = c.entry;
        const updated: Entry = {
          ...entry,
          title: clean(f.title) ?? entry.title,
          org: clean(f.org) ?? entry.org,
          location: clean(f.location) ?? entry.location,
          start: clean(f.start) ?? entry.start,
          end: clean(f.end) ?? entry.end,
          link: clean(f.link) ?? entry.link,
        };
        return ok(replaceEntry(bank, section, index, updated), `Updated "${updated.title}"`);
      });
    case "removeEntry":
      return withEntry(bank, c, (section, index, entry) =>
        ok({ ...bank, [section]: bank[section].filter((_, i) => i !== index) }, `Removed "${entry.title}" from ${section}`),
      );
    case "addBullets":
      return withEntry(bank, c, (section, index, entry) => {
        const { bullets: fresh, tooLong } = newBullets(c.texts, entry.bullets, makeId);
        const skipped = tooLongWarnings(tooLong, entry.title);
        if (fresh.length === 0) return fail(skipped[0] ?? `No new bullets to add to "${entry.title}"`);
        return ok(
          replaceEntry(bank, section, index, { ...entry, bullets: [...entry.bullets, ...fresh] }),
          `Added ${fresh.length} bullet${fresh.length === 1 ? "" : "s"} to "${entry.title}"`,
          skipped,
        );
      });
    case "editBullet":
      return withEntry(bank, c, (section, index, entry) => {
        const text = clean(c.text);
        if (!c.bulletId || !text) return fail(`editBullet for "${entry.title}" needs bulletId and text`);
        if (!entry.bullets.some((b) => b.id === c.bulletId)) return fail(`Bullet ${c.bulletId} is not in "${entry.title}"`);
        if (text.length > MAX_CHARS.bullet) {
          return fail(`Skipped an edit to a bullet in "${entry.title}": over ${MAX_CHARS.bullet.toLocaleString("en")} characters`);
        }
        const bullets = entry.bullets.map((b) => (b.id === c.bulletId ? { ...b, text } : b));
        return ok(replaceEntry(bank, section, index, { ...entry, bullets }), `Edited a bullet in "${entry.title}"`);
      });
    case "removeBullet":
      return withEntry(bank, c, (section, index, entry) => {
        if (!c.bulletId || !entry.bullets.some((b) => b.id === c.bulletId)) return fail(`Bullet ${c.bulletId ?? "?"} is not in "${entry.title}"`);
        const bullets = entry.bullets.filter((b) => b.id !== c.bulletId);
        return ok(replaceEntry(bank, section, index, { ...entry, bullets }), `Removed a bullet from "${entry.title}"`);
      });
    case "setSummary": {
      const text = clean(c.text);
      if (!text) return fail("setSummary needs text");
      if (text.length > MAX_CHARS.summary) {
        return fail(`Skipped the new summary: over ${MAX_CHARS.summary.toLocaleString("en")} characters`);
      }
      return ok({ ...bank, summary: text }, "Updated the master summary");
    }
    case "setProfileField": {
      if (!c.field) return fail("setProfileField needs a field");
      return ok({ ...bank, profile: { ...bank.profile, [c.field]: c.text.trim() } }, `Set profile ${c.field}`);
    }
    case "addSkills":
      return addSkills(bank, c, makeId);
    case "removeSkills":
      return removeSkills(bank, c);
  }
}

function addEntry(bank: Bank, c: BankChange, makeId: MakeId): Outcome {
  if (!c.section || !c.entry.title.trim()) return fail("addEntry needs a section and an entry with a title");
  const { bullets, tooLong } = newBullets(c.entry.bullets, [], makeId);
  const entry: Entry = {
    id: makeId("e"),
    title: c.entry.title.trim(),
    org: clean(c.entry.org),
    location: clean(c.entry.location),
    start: c.entry.start.trim(),
    end: c.entry.end.trim(),
    link: clean(c.entry.link),
    bullets,
  };
  const existing = bank[c.section];
  const list = c.position === "bottom" ? [...existing, entry] : [entry, ...existing];
  const n = entry.bullets.length;
  const message = `Added ${c.section} entry "${entry.title}" with ${n} bullet${n === 1 ? "" : "s"}`;
  return ok({ ...bank, [c.section]: list }, message, tooLongWarnings(tooLong, entry.title));
}

function addSkills(bank: Bank, c: BankChange, makeId: MakeId): Outcome {
  const name = clean(c.category);
  const items = c.texts.map((t) => t.trim()).filter(Boolean);
  if (!name || items.length === 0) return fail("addSkills needs a category and items");
  const index = bank.skills.findIndex((s) => norm(s.name) === norm(name));
  const current: SkillCategory = index === -1 ? { id: makeId("s"), name, items: [] } : bank.skills[index];
  const seen = new Set(current.items.map(norm));
  const fresh = items.filter((i) => (seen.has(norm(i)) ? false : (seen.add(norm(i)), true)));
  if (fresh.length === 0) return fail(`${current.name} already has those skills`);
  const updated = { ...current, items: [...current.items, ...fresh] };
  const skills = index === -1 ? [...bank.skills, updated] : bank.skills.map((s, i) => (i === index ? updated : s));
  return ok({ ...bank, skills }, `Added ${fresh.join(", ")} to ${current.name}`);
}

function removeSkills(bank: Bank, c: BankChange): Outcome {
  const name = clean(c.category);
  if (!name) return fail("removeSkills needs a category");
  const index = bank.skills.findIndex((s) => norm(s.name) === norm(name));
  if (index === -1) return fail(`No skills category called "${name}"`);
  const current = bank.skills[index];
  const drop = new Set(c.texts.map(norm));
  if (drop.size === 0) {
    return ok({ ...bank, skills: bank.skills.filter((_, i) => i !== index) }, `Removed the ${current.name} category`);
  }
  const items = current.items.filter((i) => !drop.has(norm(i)));
  if (items.length === current.items.length) return fail(`None of those skills are in ${current.name}`);
  return ok({ ...bank, skills: bank.skills.map((s, i) => (i === index ? { ...s, items } : s)) }, `Removed ${current.items.length - items.length} skill(s) from ${current.name}`);
}

function withEntry(bank: Bank, c: BankChange, fn: (section: SectionKey, index: number, entry: Entry) => Outcome): Outcome {
  if (!c.entryId) return fail(`${c.kind} needs an entryId`);
  const sections: SectionKey[] = c.section ? [c.section] : [...SECTION_KEYS];
  for (const section of sections) {
    const index = bank[section].findIndex((e) => e.id === c.entryId);
    if (index !== -1) return fn(section, index, bank[section][index]);
  }
  return fail(`No entry with id ${c.entryId}`);
}

function replaceEntry(bank: Bank, section: SectionKey, index: number, entry: Entry): Bank {
  return { ...bank, [section]: bank[section].map((e, i) => (i === index ? entry : e)) };
}

/** New bullet objects for texts that are non-blank, within the cap and not already in `existing`. */
function newBullets(texts: string[], existing: Bullet[], makeId: MakeId): { bullets: Bullet[]; tooLong: number } {
  const seen = new Set(existing.map((b) => norm(b.text)));
  const bullets: Bullet[] = [];
  let tooLong = 0;
  for (const raw of texts) {
    const text = raw.trim();
    if (!text || seen.has(norm(text))) continue;
    if (text.length > MAX_CHARS.bullet) {
      tooLong++;
      continue;
    }
    seen.add(norm(text));
    bullets.push({ id: makeId("b"), text });
  }
  return { bullets, tooLong };
}

function tooLongWarnings(count: number, title: string): string[] {
  if (count === 0) return [];
  const bullets = `${count} bullet${count === 1 ? "" : "s"}`;
  return [`Skipped ${bullets} over ${MAX_CHARS.bullet.toLocaleString("en")} characters in "${title}"`];
}
