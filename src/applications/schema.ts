import { z } from "zod";
import { CappedBulletTextSchema, CappedSummarySchema, SkillCategorySchema } from "@/bank/schema";
import { LayoutSchema } from "@/latex/layout";
import { APPLICATION_ID } from "./ids";

export const ResumeBulletSchema = z.object({
  bulletId: z.string(),
  original: z.string(),
  text: z.string(),
});

export const ResumeEntrySchema = z.object({
  entryId: z.string(),
  rationale: z.string().default(""),
  bullets: z.array(ResumeBulletSchema),
});

/** The editable review state: only included entries, in order, with their chosen bullets. */
export const ResumeStateSchema = z.object({
  summary: z.string(),
  education: z.array(ResumeEntrySchema),
  experience: z.array(ResumeEntrySchema),
  projects: z.array(ResumeEntrySchema),
  skills: z.array(SkillCategorySchema),
  /** Page margins and font size for this resume; absent means the bank default. */
  layout: LayoutSchema.optional(),
});

const CappedResumeEntrySchema = ResumeEntrySchema.extend({
  bullets: z.array(ResumeBulletSchema.extend({ text: CappedBulletTextSchema })),
});

/**
 * A resume as a client may send it (review edits, preview compiles, chat context): ResumeStateSchema with caps on
 * the text the user edits. `original` is the bank's text, which may predate the caps. Stored resumes are uncapped.
 */
export const ResumeStateInputSchema = ResumeStateSchema.extend({
  summary: CappedSummarySchema,
  education: z.array(CappedResumeEntrySchema),
  experience: z.array(CappedResumeEntrySchema),
  projects: z.array(CappedResumeEntrySchema),
});

export const ApplicationSchema = z.object({
  id: z.string().regex(APPLICATION_ID),
  createdAt: z.iso.datetime(),
  company: z.string(),
  roleTitle: z.string().default(""),
  jobDescription: z.string(),
  model: z.string(),
  warnings: z.array(z.string()).default([]),
  notes: z.string().default(""),
  resume: ResumeStateSchema,
});

export type ResumeBullet = z.infer<typeof ResumeBulletSchema>;
export type ResumeEntry = z.infer<typeof ResumeEntrySchema>;
export type ResumeState = z.infer<typeof ResumeStateSchema>;
export type Application = z.infer<typeof ApplicationSchema>;

export type ApplicationSummary = Pick<Application, "id" | "createdAt" | "company" | "roleTitle" | "model"> & {
  hasPdf: boolean;
};
