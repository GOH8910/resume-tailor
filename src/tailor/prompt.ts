import type { Bank, Entry } from "@/bank/schema";
import type { TailorLimits } from "./limits";

export function buildSystemPrompt(limits: TailorLimits): string {
  return `You are an expert technical resume editor. You receive a candidate's complete experience bank as JSON (every entry and bullet has an id) and a job description (JD). Produce a tailored selection for this specific JD.

Rules:
1. Select bullets ONLY by their id. Never invent a bullet that has no id in the bank.
2. For a selected bullet you may return "edited" text, or null to keep it unchanged. An edit must keep every fact, number, tool and outcome exactly. You may reorder clauses, mirror the JD's vocabulary where the bank already supports it, and tighten length. Never add claims, tools or metrics that are not in the bank.
3. Bullets marked "pinned": true must be included whenever their entry is included.
4. Limits: at most ${limits.experienceBullets} bullets per experience entry, at most ${limits.projectEntries} projects with at most ${limits.projectBullets} bullets each, at most ${limits.educationBullets} bullets per education entry. The resume must fit one page, so prefer fewer, stronger bullets.
5. Include every experience entry unless it is clearly irrelevant. Order experience and projects by relevance to the JD, most relevant first. Education stays in bank order.
6. Rewrite "summary" in 2-3 sentences for this JD using only facts from the bank and the master summary.
7. "skills": return the bank's categories by exact name and items by exact spelling, reordered so the most JD-relevant appear first. You may drop items. Never add items.
8. "rationale": one short sentence per included entry on why it was included.
9. "notes": anything the candidate should know, for example JD requirements the bank cannot support. Use an empty string if there is nothing.`;
}

/** Compact bank for the prompt: keeps ids and pinned flags, drops untitled drafts, blank bullets and unnamed skill categories. */
export function bankForPrompt(bank: Bank) {
  const entries = (list: Entry[]) =>
    list
      .filter((e) => e.title.trim())
      .map((e) => ({
        id: e.id,
        title: e.title,
        org: e.org,
        location: e.location,
        start: e.start,
        end: e.end,
        bullets: e.bullets
          .filter((b) => b.text.trim())
          .map((b) => ({ id: b.id, text: b.text, ...(b.pinned ? { pinned: true } : {}) })),
      }));
  return {
    master_summary: bank.summary,
    education: entries(bank.education),
    experience: entries(bank.experience),
    projects: entries(bank.projects),
    skills: bank.skills.filter((c) => c.name.trim()).map((c) => ({ name: c.name, items: c.items })),
  };
}

export function buildUserMessage(bank: Bank, jobDescription: string, company: string, roleTitle?: string): string {
  const target = roleTitle?.trim() ? `${roleTitle.trim()} at ${company}` : company;
  return [
    `Target role: ${target}`,
    "",
    "<job_description>",
    jobDescription.trim(),
    "</job_description>",
    "",
    "<experience_bank>",
    JSON.stringify(bankForPrompt(bank)),
    "</experience_bank>",
  ].join("\n");
}
