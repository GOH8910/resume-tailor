import { z } from "zod";
import { AppError } from "@/lib/errors";
import { jsonBytes, MAX_APPLICATIONS, MAX_CHARS, MAX_RESUME_JSON_BYTES } from "@/lib/input-caps";
import type { ResumeState } from "./schema";

/** The job a new resume is for, as the tailor form sends it (AI and manual). */
export const JobInputSchema = z.object({
  jobDescription: z.string().max(MAX_CHARS.jobDescription, `The job description can be at most ${MAX_CHARS.jobDescription} characters`),
  company: z.string().max(MAX_CHARS.company, `The company can be at most ${MAX_CHARS.company} characters`),
  roleTitle: z.string().max(MAX_CHARS.roleTitle, `The role title can be at most ${MAX_CHARS.roleTitle} characters`).optional(),
});

/** Refuses (409) a new resume for an account that already has the most it may keep. Checked before any charge. */
export async function requireRoomForApplication(applications: { count(userId: string): Promise<number> }, userId: string): Promise<void> {
  if ((await applications.count(userId)) >= MAX_APPLICATIONS) {
    throw new AppError(`You have ${MAX_APPLICATIONS} saved resumes; delete some first`, 409);
  }
}

/** Refuses (413) a resume over 700 KB as JSON. Saves, compiles and chat requests all carry one. */
export function requireResumeWithinSize(resume: ResumeState | undefined): void {
  if (resume && jsonBytes(resume) > MAX_RESUME_JSON_BYTES) {
    throw new AppError(`The resume is too large: keep it under ${MAX_RESUME_JSON_BYTES / 1000} KB`, 413);
  }
}
