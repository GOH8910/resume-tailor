import { newId } from "./ids";
import type { Bank, Bullet, Entry, Profile, SkillCategory } from "./schema";

export type ExtractedEntry = {
  title: string;
  org?: string;
  location?: string;
  start: string;
  end: string;
  link?: string;
  bullets: string[];
};

export type ExtractedBank = {
  profile: Partial<Profile>;
  summary: string;
  education: ExtractedEntry[];
  experience: ExtractedEntry[];
  projects: ExtractedEntry[];
  skills: Array<{ name: string; items: string[] }>;
};

type MakeId = (prefix: string) => string;

const norm = (s: string | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const entryKey = (e: { title: string; org?: string }) => `${norm(e.title)}|${norm(e.org)}`;
const clean = (s: string | undefined) => s?.trim() || undefined;

/** Merge extracted resume content into a bank: existing values win, new entries/bullets/skills are appended. */
export function mergeBank(existing: Bank, extracted: ExtractedBank, makeId: MakeId = newId): Bank {
  return {
    ...existing,
    profile: {
      name: existing.profile.name || extracted.profile.name || "",
      email: existing.profile.email || extracted.profile.email || "",
      phone: existing.profile.phone || extracted.profile.phone || "",
      linkedin: existing.profile.linkedin || clean(extracted.profile.linkedin),
      github: existing.profile.github || clean(extracted.profile.github),
      website: existing.profile.website || clean(extracted.profile.website),
    },
    summary: existing.summary || extracted.summary,
    education: mergeSection(existing.education, extracted.education, makeId),
    experience: mergeSection(existing.experience, extracted.experience, makeId),
    projects: mergeSection(existing.projects, extracted.projects, makeId),
    skills: mergeSkills(existing.skills, extracted.skills, makeId),
  };
}

function mergeSection(existing: Entry[], extracted: ExtractedEntry[], makeId: MakeId): Entry[] {
  return extracted.reduce<Entry[]>((entries, ex) => {
    if (!ex.title.trim()) return entries;
    const index = entries.findIndex((e) => entryKey(e) === entryKey(ex));
    if (index === -1) {
      const entry: Entry = {
        id: makeId("e"),
        title: ex.title.trim(),
        org: clean(ex.org),
        location: clean(ex.location),
        start: ex.start.trim(),
        end: ex.end.trim(),
        link: clean(ex.link),
        bullets: appendBullets([], ex.bullets, makeId),
      };
      return [...entries, entry];
    }
    return entries.map((e, i) => (i === index ? { ...e, bullets: appendBullets(e.bullets, ex.bullets, makeId) } : e));
  }, existing);
}

function appendBullets(current: Bullet[], incoming: string[], makeId: MakeId): Bullet[] {
  const seen = new Set(current.map((b) => norm(b.text)));
  const added: Bullet[] = [];
  for (const raw of incoming) {
    const text = raw.trim();
    const key = norm(text);
    if (!text || seen.has(key)) continue;
    seen.add(key);
    added.push({ id: makeId("b"), text });
  }
  return [...current, ...added];
}

function mergeSkills(existing: SkillCategory[], extracted: ExtractedBank["skills"], makeId: MakeId): SkillCategory[] {
  return extracted.reduce<SkillCategory[]>((categories, ex) => {
    if (!ex.name.trim()) return categories;
    const index = categories.findIndex((c) => norm(c.name) === norm(ex.name));
    if (index === -1) {
      return [...categories, { id: makeId("s"), name: ex.name.trim(), items: appendItems([], ex.items) }];
    }
    return categories.map((c, i) => (i === index ? { ...c, items: appendItems(c.items, ex.items) } : c));
  }, existing);
}

function appendItems(current: string[], incoming: string[]): string[] {
  const seen = new Set(current.map(norm));
  const added: string[] = [];
  for (const raw of incoming) {
    const item = raw.trim();
    if (!item || seen.has(norm(item))) continue;
    seen.add(norm(item));
    added.push(item);
  }
  return [...current, ...added];
}
