import { z } from "zod";

// Structured output schema for Claude. Optional values are modelled as nullable so every
// property is required in the JSON schema, which structured outputs expect.
export const SelectedBulletSchema = z.object({
  bulletId: z.string(),
  edited: z.string().nullable(),
});

export const SelectedEntrySchema = z.object({
  entryId: z.string(),
  rationale: z.string(),
  bullets: z.array(SelectedBulletSchema),
});

export const TailorSkillCategorySchema = z.object({
  name: z.string(),
  items: z.array(z.string()),
});

export const TailorResultSchema = z.object({
  summary: z.string(),
  education: z.array(SelectedEntrySchema),
  experience: z.array(SelectedEntrySchema),
  projects: z.array(SelectedEntrySchema),
  skills: z.array(TailorSkillCategorySchema),
  notes: z.string(),
});

export type SelectedBullet = z.infer<typeof SelectedBulletSchema>;
export type SelectedEntry = z.infer<typeof SelectedEntrySchema>;
export type TailorSkillCategory = z.infer<typeof TailorSkillCategorySchema>;
export type TailorResult = z.infer<typeof TailorResultSchema>;
