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
  const projects = validateSection(bank, "projects", result.projects, limits.projectBullets, warnings, limits.projectEntries);

  const summary = result.summary.trim() || bank.summary;
  if (!result.summary.trim()) warnings.push("Claude returned an empty summary; using the master summary instead");

  const skills = validateSkills(bank, result.skills, warnings);

  return { result: { summary, education, experience, projects, skills, notes: result.notes.trim() }, warnings };
}

/** Resolve entries against the bank, drop unknown/duplicate ones, apply the entry limit, then validate bullets. */
function validateSection(
  bank: Bank,
  section: SectionKey,
  selected: SelectedEntry[],
  maxBullets: number,
  warnings: string[],
  maxEntries = Number.POSITIVE_INFINITY,
): SelectedEntry[] {
  const byId = new Map(bank[section].map((e) => [e.id, e]));
  const seen = new Set<string>();
  const resolved: Array<{ entry: Entry; sel: SelectedEntry }> = [];
  for (const sel of selected) {
    const entry = byId.get(sel.entryId);
    if (!entry) {
      warnings.push(`Claude referenced a ${section} entry that is not in your bank (${sel.entryId}); dropped it`);
      continue;
    }
    if (seen.has(sel.entryId)) {
      warnings.push(`Claude listed "${entry.title}" twice; kept the first`);
      continue;
    }
    seen.add(sel.entryId);
    resolved.push({ entry, sel });
  }
  const kept = resolved.length > maxEntries ? resolved.slice(0, maxEntries) : resolved;
  if (kept.length < resolved.length) {
    const dropped = resolved.slice(kept.length).map((r) => r.entry.title);
    warnings.push(`Kept the first ${kept.length} ${section}; dropped ${dropped.join(", ")}`);
  }
  return kept.map(({ entry, sel }) => ({
    entryId: sel.entryId,
    rationale: sel.rationale.trim(),
    bullets: validateBullets(entry, sel.bullets, maxBullets, warnings),
  }));
}

function validateBullets(entry: Entry, selected: SelectedBullet[], max: number, warnings: string[]): SelectedBullet[] {
  // Blank draft bullets are invisible to Claude and to the PDF, so they are invisible here too.
  const real = entry.bullets.filter((b) => b.text.trim());
  const byId = new Map(real.map((b) => [b.id, b]));
  const bankIndex = new Map(real.map((b, i) => [b.id, i]));
  const seen = new Set<string>();
  const picked: SelectedBullet[] = [];
  for (const sel of selected) {
    const bullet = byId.get(sel.bulletId);
    if (!bullet) {
      warnings.push(`Claude referenced a bullet that is not in "${entry.title}" (${sel.bulletId}); dropped it`);
      continue;
    }
    if (seen.has(sel.bulletId)) {
      warnings.push(`Claude listed a bullet in "${entry.title}" twice; kept the first`);
      continue;
    }
    seen.add(sel.bulletId);
    const edited = sel.edited?.trim() ?? "";
    picked.push({ bulletId: sel.bulletId, edited: edited && edited !== bullet.text.trim() ? edited : null });
  }

  // Pinned bullets Claude left out go back in at their bank position.
  let kept = picked;
  for (const bullet of real) {
    if (!bullet.pinned || seen.has(bullet.id)) continue;
    seen.add(bullet.id);
    const position = bankIndex.get(bullet.id) ?? 0;
    const at = kept.findIndex((k) => (bankIndex.get(k.bulletId) ?? 0) > position);
    const item: SelectedBullet = { bulletId: bullet.id, edited: null };
    kept = at === -1 ? [...kept, item] : [...kept.slice(0, at), item, ...kept.slice(at)];
  }

  if (kept.length === 0) {
    warnings.push(`"${entry.title}" ended up with no bullets; add some back in the review screen`);
    return kept;
  }
  if (kept.length <= max) return kept;

  const pinnedIds = new Set(real.filter((b) => b.pinned).map((b) => b.id));
  const pinnedKept = kept.filter((k) => pinnedIds.has(k.bulletId));
  if (pinnedKept.length >= max) {
    if (pinnedKept.length < kept.length) {
      warnings.push(`"${entry.title}": kept only its ${pinnedKept.length} pinned bullets (limit ${max})`);
    }
    if (pinnedKept.length > max) {
      warnings.push(`"${entry.title}" has ${pinnedKept.length} pinned bullets, over the limit of ${max}; kept them all`);
    }
    return pinnedKept;
  }
  const keepIds = new Set(pinnedKept.map((k) => k.bulletId));
  for (const k of kept) {
    if (keepIds.size >= max) break;
    keepIds.add(k.bulletId);
  }
  warnings.push(`Trimmed "${entry.title}" from ${kept.length} to ${max} bullets`);
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
      warnings.push(`Claude returned a skills category that is not in your bank ("${cat.name}"); dropped it`);
      continue;
    }
    if (used.has(bankCat.id)) {
      warnings.push(`Claude listed the skills category "${bankCat.name}" twice; kept the first`);
      continue;
    }
    used.add(bankCat.id);
    const items: string[] = [];
    for (const item of cat.items) {
      const match = bankCat.items.find((i) => norm(i) === norm(item));
      if (!match) {
        warnings.push(`Claude listed a skill that is not in your bank ("${item}" under ${bankCat.name}); dropped it`);
        continue;
      }
      if (!items.includes(match)) items.push(match);
    }
    if (items.length > 0) out.push({ name: bankCat.name, items });
  }
  if (out.length === 0 && bank.skills.some((c) => c.items.length > 0)) {
    warnings.push("Claude returned no usable skills; add categories back in the review screen");
  }
  return out;
}
