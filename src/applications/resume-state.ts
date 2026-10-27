import type { Bank, Entry, SectionKey } from "@/bank/schema";
import type { DocEntry, ResumeDocument } from "@/latex/document";
import type { SelectedEntry, TailorResult } from "@/tailor/schema";
import type { ResumeEntry, ResumeState } from "./schema";

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
        if (!bullet) return [];
        return [{ bulletId: bullet.id, original: bullet.text, text: sb.edited ?? bullet.text }];
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
  const all = (entries: Entry[]): ResumeEntry[] =>
    entries.map((e) => ({
      entryId: e.id,
      rationale: "",
      bullets: e.bullets.map((b) => ({ bulletId: b.id, original: b.text, text: b.text })),
    }));
  return {
    summary: bank.summary,
    education: all(bank.education),
    experience: all(bank.experience),
    projects: all(bank.projects),
    skills: bank.skills.map((c) => ({ ...c, items: [...c.items] })),
  };
}

/** Join review state with bank headers into a render-ready document. Entries missing from the bank are skipped. */
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
