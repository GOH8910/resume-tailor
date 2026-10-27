import type { Bank, Bullet, SectionKey, SkillCategory } from "@/bank/schema";
import type { ResumeEntry, ResumeState } from "./schema";

export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const copy = [...items];
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return copy;
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}

function mapEntry(state: ResumeState, section: SectionKey, entryId: string, fn: (e: ResumeEntry) => ResumeEntry): ResumeState {
  return { ...state, [section]: state[section].map((e) => (e.entryId === entryId ? fn(e) : e)) };
}

export function setBulletText(state: ResumeState, section: SectionKey, entryId: string, bulletId: string, text: string): ResumeState {
  return mapEntry(state, section, entryId, (e) => ({
    ...e,
    bullets: e.bullets.map((b) => (b.bulletId === bulletId ? { ...b, text } : b)),
  }));
}

export function revertBullet(state: ResumeState, section: SectionKey, entryId: string, bulletId: string): ResumeState {
  return mapEntry(state, section, entryId, (e) => ({
    ...e,
    bullets: e.bullets.map((b) => (b.bulletId === bulletId ? { ...b, text: b.original } : b)),
  }));
}

export function removeBullet(state: ResumeState, section: SectionKey, entryId: string, bulletId: string): ResumeState {
  return mapEntry(state, section, entryId, (e) => ({ ...e, bullets: e.bullets.filter((b) => b.bulletId !== bulletId) }));
}

export function addBullet(state: ResumeState, section: SectionKey, entryId: string, bullet: Bullet): ResumeState {
  const entry = state[section].find((e) => e.entryId === entryId);
  if (!entry || entry.bullets.some((b) => b.bulletId === bullet.id)) return state;
  return mapEntry(state, section, entryId, (e) => ({
    ...e,
    bullets: [...e.bullets, { bulletId: bullet.id, original: bullet.text, text: bullet.text }],
  }));
}

export function moveBullet(state: ResumeState, section: SectionKey, entryId: string, bulletId: string, direction: -1 | 1): ResumeState {
  return mapEntry(state, section, entryId, (e) => {
    const index = e.bullets.findIndex((b) => b.bulletId === bulletId);
    return { ...e, bullets: moveItem(e.bullets, index, index + direction) };
  });
}

export function includeEntry(state: ResumeState, bank: Bank, section: SectionKey, entryId: string): ResumeState {
  if (state[section].some((e) => e.entryId === entryId)) return state;
  const entry = bank[section].find((e) => e.id === entryId);
  if (!entry) return state;
  const added: ResumeEntry = {
    entryId,
    rationale: "Added manually",
    bullets: entry.bullets.map((b) => ({ bulletId: b.id, original: b.text, text: b.text })),
  };
  return { ...state, [section]: [...state[section], added] };
}

export function excludeEntry(state: ResumeState, section: SectionKey, entryId: string): ResumeState {
  return { ...state, [section]: state[section].filter((e) => e.entryId !== entryId) };
}

export function moveEntry(state: ResumeState, section: SectionKey, entryId: string, direction: -1 | 1): ResumeState {
  const index = state[section].findIndex((e) => e.entryId === entryId);
  return { ...state, [section]: moveItem(state[section], index, index + direction) };
}

export function setSummary(state: ResumeState, summary: string): ResumeState {
  return { ...state, summary };
}

export function setSkills(state: ResumeState, skills: SkillCategory[]): ResumeState {
  return { ...state, skills: skills.map((c) => ({ ...c, items: [...c.items] })) };
}
