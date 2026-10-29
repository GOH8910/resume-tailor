import type { ResumeEntry, ResumeState } from "@/applications/schema";
import type { Bank, Entry } from "@/bank/schema";
import { SECTION_KEYS } from "@/bank/schema";
import { MAX_CHARS } from "@/lib/input-caps";

/**
 * Brings data written outside the API (the seed and import scripts) within the caps the editors are held to, so
 * the API never refuses to save what it stored. `truncated` names each field that was cut by its path; it never
 * echoes résumé text.
 */
export type Fitted<T> = { truncated: string[] } & T;

/** `text` cut to `max` UTF-16 units (what the caps count), never ending on half of a surrogate pair. */
export function truncateText(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
}

export function fitBankToCaps(bank: Bank): Fitted<{ bank: Bank }> {
  const truncated: string[] = [];
  const summary = fit(bank.summary, MAX_CHARS.summary, "summary", truncated);
  const sections = Object.fromEntries(
    SECTION_KEYS.map((section) => [
      section,
      bank[section].map(
        (entry, e): Entry => ({
          ...entry,
          bullets: entry.bullets.map((b, i) => ({ ...b, text: fit(b.text, MAX_CHARS.bullet, `${section}.${e}.bullets.${i}.text`, truncated) })),
        }),
      ),
    ]),
  );
  if (truncated.length === 0) return { bank, truncated };
  return { bank: { ...bank, summary, ...sections }, truncated };
}

export function fitResumeToCaps(resume: ResumeState): Fitted<{ resume: ResumeState }> {
  const truncated: string[] = [];
  const summary = fit(resume.summary, MAX_CHARS.summary, "summary", truncated);
  const sections = Object.fromEntries(
    SECTION_KEYS.map((section) => [
      section,
      resume[section].map(
        (entry, e): ResumeEntry => ({
          ...entry,
          bullets: entry.bullets.map((b, i) => ({ ...b, text: fit(b.text, MAX_CHARS.bullet, `${section}.${e}.bullets.${i}.text`, truncated) })),
        }),
      ),
    ]),
  );
  if (truncated.length === 0) return { resume, truncated };
  return { resume: { ...resume, summary, ...sections }, truncated };
}

function fit(text: string, max: number, field: string, truncated: string[]): string {
  if (text.length <= max) return text;
  truncated.push(field);
  return truncateText(text, max);
}
