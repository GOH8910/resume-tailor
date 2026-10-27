import type { Bank, Entry, SectionKey } from "@/bank/schema";
import { DEFAULT_LIMITS, type TailorLimits } from "./limits";
import type { SelectedBullet, SelectedEntry, TailorResult, TailorSkillCategory } from "./schema";

export type ValidatedTailor = { result: TailorResult; warnings: string[] };

const norm = (s: string) => s.trim().toLowerCase();

/** Reconcile Claude's answer with the bank: unknown ids are dropped, pinned bullets enforced, limits applied. */
export function validateTailorResult(bank: Bank, result: TailorResult, limits: TailorLimits = DEFAULT_LIMITS): ValidatedTailor {
  const warnings: string[] = [];

  const education = sortByBankOrder(bank.education, validateSection(bank, "education", result.education, limits.educationBullets, warnings));
  const experience = validateSection(bank, "experience", result.experience, limits.experienceBullets, warnings);
  const allProjects = validateSection(bank, "projects", result.projects, limits.projectBullets, warnings);
  const projects = allProjects.length > limits.projectEntries ? allProjects.slice(0, limits.projectEntries) : allProjects;
  if (projects.length !== allProjects.length) {
    warnings.push(`Trimmed projects from ${allProjects.length} to ${limits.projectEntries}`);
  }

  const summary = result.summary.trim() || bank.summary;
  if (!result.summary.trim()) warnings.push("Claude returned an empty summary; using the master summary instead");

  const skills = validateSkills(bank, result.skills, warnings);

  return { result: { summary, education, experience, projects, skills, notes: result.notes }, warnings };
}

function validateSection(bank: Bank, section: SectionKey, selected: SelectedEntry[], maxBullets: number, warnings: string[]): SelectedEntry[] {
  const byId = new Map(bank[section].map((e) => [e.id, e]));
  const seen = new Set<string>();
  const out: SelectedEntry[] = [];
  for (const sel of selected) {
    const entry = byId.get(sel.entryId);
    if (!entry) {
      warnings.push(`Dropped unknown ${section} entry "${sel.entryId}"`);
      continue;
    }
    if (seen.has(sel.entryId)) {
      warnings.push(`Dropped duplicate ${section} entry "${entry.title}"`);
      continue;
    }
    seen.add(sel.entryId);
    out.push({ entryId: sel.entryId, rationale: sel.rationale, bullets: validateBullets(entry, sel.bullets, maxBullets, warnings) });
  }
  return out;
}

function validateBullets(entry: Entry, selected: SelectedBullet[], max: number, warnings: string[]): SelectedBullet[] {
  const byId = new Map(entry.bullets.map((b) => [b.id, b]));
  const seen = new Set<string>();
  const kept: SelectedBullet[] = [];
  for (const sel of selected) {
    const bullet = byId.get(sel.bulletId);
    if (!bullet) {
      warnings.push(`Dropped unknown bullet "${sel.bulletId}" in "${entry.title}"`);
      continue;
    }
    if (seen.has(sel.bulletId)) continue;
    seen.add(sel.bulletId);
    const edited = sel.edited?.trim() ?? "";
    kept.push({ bulletId: sel.bulletId, edited: edited && edited !== bullet.text.trim() ? edited : null });
  }
  for (const bullet of entry.bullets) {
    if (bullet.pinned && !seen.has(bullet.id)) {
      seen.add(bullet.id);
      kept.push({ bulletId: bullet.id, edited: null });
    }
  }
  if (kept.length <= max) return kept;

  const pinnedIds = new Set(entry.bullets.filter((b) => b.pinned).map((b) => b.id));
  const pinned = kept.filter((k) => pinnedIds.has(k.bulletId));
  const rest = kept.filter((k) => !pinnedIds.has(k.bulletId));
  const keepIds = new Set([...pinned, ...rest].slice(0, Math.max(max, pinned.length)).map((k) => k.bulletId));
  warnings.push(`Trimmed "${entry.title}" from ${kept.length} to ${keepIds.size} bullets`);
  return kept.filter((k) => keepIds.has(k.bulletId));
}

function sortByBankOrder(bankEntries: Entry[], selected: SelectedEntry[]): SelectedEntry[] {
  const index = new Map(bankEntries.map((e, i) => [e.id, i]));
  return [...selected].sort((a, b) => (index.get(a.entryId) ?? 0) - (index.get(b.entryId) ?? 0));
}

function validateSkills(bank: Bank, skills: TailorSkillCategory[], warnings: string[]): TailorSkillCategory[] {
  const out: TailorSkillCategory[] = [];
  const used = new Set<string>();
  for (const cat of skills) {
    const bankCat = bank.skills.find((c) => norm(c.name) === norm(cat.name));
    if (!bankCat) {
      warnings.push(`Dropped unknown skills category "${cat.name}"`);
      continue;
    }
    if (used.has(bankCat.id)) continue;
    used.add(bankCat.id);
    const items: string[] = [];
    for (const item of cat.items) {
      const match = bankCat.items.find((i) => norm(i) === norm(item));
      if (!match) {
        warnings.push(`Dropped unknown skill "${item}" in ${bankCat.name}`);
        continue;
      }
      if (!items.includes(match)) items.push(match);
    }
    if (items.length > 0) out.push({ name: bankCat.name, items });
  }
  return out;
}
