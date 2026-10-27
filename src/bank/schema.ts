import { z } from "zod";

// Empty text/title/category names are allowed: the editor creates drafts while the user types.
// The LaTeX builder and the prompt skip blank bullets and untitled entries.
export const BulletSchema = z.object({
  id: z.string().min(1),
  text: z.string(),
  pinned: z.boolean().optional(),
});

export const EntrySchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  org: z.string().optional(),
  location: z.string().optional(),
  start: z.string().default(""),
  end: z.string().default(""),
  link: z.string().optional(),
  bullets: z.array(BulletSchema),
});

export const SkillCategorySchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  items: z.array(z.string()),
});

export const ProfileSchema = z.object({
  name: z.string(),
  email: z.string(),
  phone: z.string(),
  linkedin: z.string().optional(),
  github: z.string().optional(),
  website: z.string().optional(),
});

export const BankSchema = z.object({
  version: z.literal(1),
  profile: ProfileSchema,
  summary: z.string(),
  education: z.array(EntrySchema),
  experience: z.array(EntrySchema),
  projects: z.array(EntrySchema),
  skills: z.array(SkillCategorySchema),
});

export type Bullet = z.infer<typeof BulletSchema>;
export type Entry = z.infer<typeof EntrySchema>;
export type SkillCategory = z.infer<typeof SkillCategorySchema>;
export type Profile = z.infer<typeof ProfileSchema>;
export type Bank = z.infer<typeof BankSchema>;

export const SECTION_KEYS = ["education", "experience", "projects"] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

export const SECTION_LABELS: Record<SectionKey, string> = {
  education: "Education",
  experience: "Experience",
  projects: "Projects",
};

export function emptyBank(name = ""): Bank {
  return {
    version: 1,
    profile: { name, email: "", phone: "" },
    summary: "",
    education: [],
    experience: [],
    projects: [],
    skills: [],
  };
}
