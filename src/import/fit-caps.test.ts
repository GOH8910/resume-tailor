import { describe, expect, it } from "vitest";
import { type ResumeState, ResumeStateInputSchema } from "@/applications/schema";
import { type Bank, BankInputSchema, emptyBank } from "@/bank/schema";
import { fitBankToCaps, fitResumeToCaps, truncateText } from "./fit-caps";

describe("truncateText", () => {
  it("leaves text within the cap alone", () => {
    expect(truncateText("abc", 3)).toBe("abc");
  });

  it("cuts text to the cap", () => {
    expect(truncateText("abcdef", 3)).toBe("abc");
  });

  it("never leaves half of a surrogate pair at the end", () => {
    // "🚀" is two UTF-16 units; cutting after the first would leave a lone high surrogate.
    expect(truncateText("ab🚀", 3)).toBe("ab");
  });
});

describe("fitBankToCaps", () => {
  const bank = (summary: string, bullet: string): Bank => ({
    ...emptyBank("Ada"),
    summary,
    projects: [{ id: "e1", title: "P", start: "", end: "", bullets: [{ id: "b1", text: "ok" }, { id: "b2", text: bullet }] }],
  });

  it("returns a bank within the caps unchanged, with nothing truncated", () => {
    const within = bank("Short.", "x".repeat(600));
    expect(fitBankToCaps(within)).toEqual({ bank: within, truncated: [] });
  });

  it("cuts long bullets and the summary to the caps and names each field, not its text", () => {
    const { bank: fitted, truncated } = fitBankToCaps(bank("s".repeat(2_500), "x".repeat(700)));
    expect(fitted.summary).toHaveLength(2_000);
    expect(fitted.projects[0].bullets[1].text).toHaveLength(600);
    expect(fitted.projects[0].bullets[0].text).toBe("ok");
    expect(truncated).toEqual(["summary", "projects.0.bullets.1.text"]);
    expect(BankInputSchema.safeParse(fitted).success).toBe(true);
  });
});

describe("fitResumeToCaps", () => {
  it("cuts long bullet text and the summary, leaving the bank's original text alone", () => {
    const resume: ResumeState = {
      summary: "s".repeat(2_001),
      education: [],
      experience: [{ entryId: "e1", rationale: "", bullets: [{ bulletId: "b1", original: "o".repeat(900), text: "x".repeat(601) }] }],
      projects: [],
      skills: [],
    };
    const { resume: fitted, truncated } = fitResumeToCaps(resume);
    expect(truncated).toEqual(["summary", "experience.0.bullets.0.text"]);
    expect(fitted.experience[0].bullets[0].original).toHaveLength(900);
    expect(ResumeStateInputSchema.safeParse(fitted).success).toBe(true);
  });
});
