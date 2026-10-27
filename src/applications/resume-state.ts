import type { Bank, Bullet, Entry, SectionKey } from "@/bank/schema";
import type { DocEntry, ResumeDocument } from "@/latex/document";
import type { SelectedEntry, TailorResult } from "@/tailor/schema";
import type { ResumeBullet, ResumeEntry, ResumeState } from "./schema";

/** Blank draft bullets never reach the prompt or the PDF, so they never enter review state either. */
export function isRealBullet(b: Bullet): boolean {
  return b.text.trim().length > 0;
}

export function toResumeBullet(b: Bullet): ResumeBullet {
  return { bulletId: b.id, original: b.text, text: b.text };
}

/** All of an entry's real bullets, in bank order. */
export function toResumeEntry(entry: Entry, rationale: string): ResumeEntry {
  return { entryId: entry.id, rationale, bullets: entry.bullets.filter(isRealBullet).map(toResumeBullet) };
}

/** Turn a validated Claude result into editable review state, keeping original bullet text. */
export function fromTailorResult(bank: Bank, result: TailorResult): ResumeState {
  const section = (key: SectionKey, selected: SelectedEntry[]): ResumeEntry[] => {
    const byId = new Map(bank[key].map((e) => [e.id, e]));
    return selected.flatMap((sel) => {
      const entry = byId.get(sel.entryId);
      if (!entry) return [];
      const bulletsById = new Map(entry.bullets.map((b) => [b.id, b]));
      const bullets = sel.bullets.flatMap((sb) => {
        const bullet = bulletsById.get(sb.bulletId);
        if (!bullet || !isRealBullet(bullet)) return [];
        return [{ ...toResumeBullet(bullet), text: sb.edited ?? bullet.text }];
      });
      return [{ entryId: entry.id, rationale: sel.rationale, bullets }];
    });
  };
  const skills = result.skills.flatMap((cat) => {
    const bankCat = bank.skills.find((c) => c.name === cat.name);
    return bankCat ? [{ id: bankCat.id, name: bankCat.name, items: [...cat.items] }] : [];
  });
  return {
    summary: result.summary,
    education: section("education", result.education),
    experience: section("experience", result.experience),
    projects: section("projects", result.projects),
    skills,
  };
}

/** Everything in the bank, unchanged. Used for the no-AI path and tests. */
export function fullStateFromBank(bank: Bank): ResumeState {
  const all = (entries: Entry[]): ResumeEntry[] => entries.filter((e) => e.title.trim()).map((e) => toResumeEntry(e, ""));
  return {
    summary: bank.summary,
    education: all(bank.education),
    experience: all(bank.experience),
    projects: all(bank.projects),
    skills: bank.skills.filter((c) => c.name.trim()).map((c) => ({ ...c, items: [...c.items] })),
  };
}

/**
 * Join review state with bank headers into a render-ready document. Entries missing from the bank are skipped.
 * Headers come from the live bank; bullet text is the snapshot taken at tailoring time, so later bank edits do not change a saved resume.
 */
export function resolveResume(bank: Bank, state: ResumeState): ResumeDocument {
  const section = (key: SectionKey): DocEntry[] => {
    const byId = new Map(bank[key].map((e) => [e.id, e]));
    return state[key].flatMap((re) => {
      const entry = byId.get(re.entryId);
      if (!entry) return [];
      return [
        {
          title: entry.title,
          org: entry.org,
          location: entry.location,
          start: entry.start,
          end: entry.end,
          link: entry.link,
          bullets: re.bullets.map((b) => b.text),
        },
      ];
    });
  };
  return {
    profile: bank.profile,
    summary: state.summary,
    education: section("education"),
    experience: section("experience"),
    projects: section("projects"),
    skills: state.skills,
  };
}
