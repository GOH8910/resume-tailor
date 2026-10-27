import type { Profile, SkillCategory } from "@/bank/schema";

/** One entry with its header fields and the final bullet texts, ready to render. */
export type DocEntry = {
  title: string;
  org?: string;
  location?: string;
  start: string;
  end: string;
  link?: string;
  bullets: string[];
};

/** A fully resolved resume: no ids, no lookups needed. */
export type ResumeDocument = {
  profile: Profile;
  summary: string;
  education: DocEntry[];
  experience: DocEntry[];
  projects: DocEntry[];
  skills: SkillCategory[];
};
