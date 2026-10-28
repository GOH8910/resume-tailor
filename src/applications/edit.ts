import type { Bank, Bullet, SectionKey, SkillCategory } from "@/bank/schema";
import { type Layout, sameLayout } from "@/latex/layout";
import { isRealBullet, toResumeBullet, toResumeEntry } from "./resume-state";
import type { ResumeBullet, ResumeEntry, ResumeState } from "./schema";

export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const copy = [...items];
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return copy;
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}

function sameItems<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((item, i) => item === b[i]);
}

/** Insert `item` before the first existing item whose bank position is greater than `position`. */
function insertByBankOrder<T>(items: readonly T[], item: T, position: number, positionOf: (t: T) => number): T[] {
  const at = items.findIndex((t) => positionOf(t) > position);
  return at === -1 ? [...items, item] : [...items.slice(0, at), item, ...items.slice(at)];
}

// Edits return the same state object when nothing changes, so callers can skip re-renders and saves.
function mapEntry(state: ResumeState, section: SectionKey, entryId: string, fn: (e: ResumeEntry) => ResumeEntry): ResumeState {
  const entries = state[section].map((e) => (e.entryId === entryId ? fn(e) : e));
  return sameItems(entries, state[section]) ? state : { ...state, [section]: entries };
}

function mapBullet(entry: ResumeEntry, bulletId: string, fn: (b: ResumeBullet) => ResumeBullet): ResumeEntry {
  const bullets = entry.bullets.map((b) => (b.bulletId === bulletId ? fn(b) : b));
  return sameItems(bullets, entry.bullets) ? entry : { ...entry, bullets };
}

export function setBulletText(state: ResumeState, section: SectionKey, entryId: string, bulletId: string, text: string): ResumeState {
  return mapEntry(state, section, entryId, (e) => mapBullet(e, bulletId, (b) => (b.text === text ? b : { ...b, text })));
}

export function revertBullet(state: ResumeState, section: SectionKey, entryId: string, bulletId: string): ResumeState {
  return mapEntry(state, section, entryId, (e) => mapBullet(e, bulletId, (b) => (b.text === b.original ? b : { ...b, text: b.original })));
}

export function removeBullet(state: ResumeState, section: SectionKey, entryId: string, bulletId: string): ResumeState {
  return mapEntry(state, section, entryId, (e) => {
    const bullets = e.bullets.filter((b) => b.bulletId !== bulletId);
    return sameItems(bullets, e.bullets) ? e : { ...e, bullets };
  });
}

export function addBullet(state: ResumeState, section: SectionKey, entryId: string, bullet: Bullet, bank: Bank): ResumeState {
  const entry = state[section].find((e) => e.entryId === entryId);
  const bankEntry = bank[section].find((e) => e.id === entryId);
  if (!entry || !bankEntry || !isRealBullet(bullet)) return state;
  const bankIndex = (bulletId: string) => bankEntry.bullets.findIndex((b) => b.id === bulletId);
  const position = bankIndex(bullet.id);
  if (position === -1 || entry.bullets.some((b) => b.bulletId === bullet.id)) return state;
  return mapEntry(state, section, entryId, (e) => ({
    ...e,
    bullets: insertByBankOrder(e.bullets, toResumeBullet(bullet), position, (b) => bankIndex(b.bulletId)),
  }));
}

export function moveBullet(state: ResumeState, section: SectionKey, entryId: string, bulletId: string, direction: -1 | 1): ResumeState {
  return mapEntry(state, section, entryId, (e) => {
    const index = e.bullets.findIndex((b) => b.bulletId === bulletId);
    const bullets = moveItem(e.bullets, index, index + direction);
    return sameItems(bullets, e.bullets) ? e : { ...e, bullets };
  });
}

export function includeEntry(state: ResumeState, bank: Bank, section: SectionKey, entryId: string): ResumeState {
  if (state[section].some((e) => e.entryId === entryId)) return state;
  const position = bank[section].findIndex((e) => e.id === entryId);
  if (position === -1) return state;
  const entry = bank[section][position];
  if (!entry.title.trim()) return state;
  const bankIndex = (id: string) => bank[section].findIndex((e) => e.id === id);
  const added = toResumeEntry(entry, "Added manually");
  return { ...state, [section]: insertByBankOrder(state[section], added, position, (e) => bankIndex(e.entryId)) };
}

export function excludeEntry(state: ResumeState, section: SectionKey, entryId: string): ResumeState {
  const entries = state[section].filter((e) => e.entryId !== entryId);
  return sameItems(entries, state[section]) ? state : { ...state, [section]: entries };
}

export function moveEntry(state: ResumeState, section: SectionKey, entryId: string, direction: -1 | 1): ResumeState {
  const index = state[section].findIndex((e) => e.entryId === entryId);
  const entries = moveItem(state[section], index, index + direction);
  return sameItems(entries, state[section]) ? state : { ...state, [section]: entries };
}

export function setSummary(state: ResumeState, summary: string): ResumeState {
  return summary === state.summary ? state : { ...state, summary };
}

/** `undefined` drops the resume's own layout so it follows the bank default again. */
export function setLayout(state: ResumeState, layout: Layout | undefined): ResumeState {
  if (sameLayout(state.layout, layout)) return state;
  if (layout === undefined) {
    const rest = { ...state };
    delete rest.layout;
    return rest;
  }
  return { ...state, layout };
}

export function setSkills(state: ResumeState, skills: SkillCategory[]): ResumeState {
  return { ...state, skills: skills.map((c) => ({ ...c, items: [...c.items] })) };
}

/** Drop entries whose bank entry was deleted since this resume was saved. */
export function pruneMissing(state: ResumeState, bank: Bank): ResumeState {
  const prune = (section: SectionKey): ResumeEntry[] => {
    const known = new Set(bank[section].map((e) => e.id));
    const kept = state[section].filter((e) => known.has(e.entryId));
    return sameItems(kept, state[section]) ? state[section] : kept;
  };
  const education = prune("education");
  const experience = prune("experience");
  const projects = prune("projects");
  if (education === state.education && experience === state.experience && projects === state.projects) return state;
  return { ...state, education, experience, projects };
}
