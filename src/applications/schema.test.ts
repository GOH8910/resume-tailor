import { describe, expect, it } from "vitest";
import { type ResumeState, ResumeStateInputSchema, ResumeStateSchema } from "./schema";

const resumeWith = (text: string, summary = ""): ResumeState => ({
  summary,
  education: [],
  experience: [{ entryId: "e1", rationale: "", bullets: [{ bulletId: "b1", original: "x".repeat(900), text }] }],
  projects: [],
  skills: [],
});

describe("ResumeStateInputSchema (what the review screen may send)", () => {
  it("accepts a bullet of 600 characters and refuses 601", () => {
    expect(ResumeStateInputSchema.safeParse(resumeWith("x".repeat(600))).success).toBe(true);
    const long = ResumeStateInputSchema.safeParse(resumeWith("x".repeat(601)));
    expect(long.success).toBe(false);
    if (!long.success) expect(long.error.issues[0].path.join(".")).toBe("experience.0.bullets.0.text");
  });

  it("accepts a summary of 2,000 characters and refuses 2,001", () => {
    expect(ResumeStateInputSchema.safeParse(resumeWith("ok", "x".repeat(2_000))).success).toBe(true);
    expect(ResumeStateInputSchema.safeParse(resumeWith("ok", "x".repeat(2_001))).success).toBe(false);
  });

  it("does not cap the bank's original text, which may predate the caps", () => {
    expect(ResumeStateInputSchema.safeParse(resumeWith("short")).success).toBe(true);
  });

  it("leaves stored resumes uncapped", () => {
    expect(ResumeStateSchema.safeParse(resumeWith("x".repeat(601))).success).toBe(true);
  });
});
