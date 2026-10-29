import { z } from "zod";
import { MAX_CHARS, MAX_CHAT_MESSAGES } from "@/lib/input-caps";

// Claude's structured reply for the chat box. The API limits schemas to 16 union-typed
// fields, so nothing here is nullable: an unused string is "", an unused array is [].
const SectionOrNone = z.enum(["education", "experience", "projects", ""]);

/** A new entry for addEntry, or a patch for updateEntry where "" means "unchanged". */
export const EntryPatchSchema = z.object({
  title: z.string(),
  org: z.string(),
  location: z.string(),
  start: z.string(),
  end: z.string(),
  link: z.string(),
  bullets: z.array(z.string()),
});

export const BANK_CHANGE_KINDS = [
  "addEntry",
  "updateEntry",
  "removeEntry",
  "addBullets",
  "editBullet",
  "removeBullet",
  "setSummary",
  "setProfileField",
  "addSkills",
  "removeSkills",
] as const;

export const BankChangeSchema = z.object({
  kind: z.enum(BANK_CHANGE_KINDS),
  section: SectionOrNone,
  entryId: z.string(),
  bulletId: z.string(),
  entry: EntryPatchSchema,
  position: z.enum(["top", "bottom", ""]),
  texts: z.array(z.string()),
  text: z.string(),
  field: z.enum(["name", "email", "phone", "linkedin", "github", "website", ""]),
  category: z.string(),
});

export const RESUME_CHANGE_KINDS = [
  "includeEntry",
  "excludeEntry",
  "addBullet",
  "removeBullet",
  "editBullet",
  "moveEntry",
  "moveBullet",
  "setSummary",
  "setSkills",
] as const;

export const ResumeChangeSchema = z.object({
  kind: z.enum(RESUME_CHANGE_KINDS),
  section: SectionOrNone,
  entryId: z.string(),
  entryTitle: z.string(),
  bulletId: z.string(),
  bulletText: z.string(),
  text: z.string(),
  direction: z.enum(["up", "down", ""]),
  skills: z.array(z.object({ name: z.string(), items: z.array(z.string()) })),
});

export const ChatResultSchema = z.object({
  reply: z.string(),
  bankChanges: z.array(BankChangeSchema),
  resumeChanges: z.array(ResumeChangeSchema),
});

export const ChatMessageSchema = z
  .object({
    role: z.enum(["user", "assistant"]),
    content: z.string(),
  })
  .superRefine(({ role, content }, ctx) => {
    const max = role === "user" ? MAX_CHARS.chatMessage : MAX_CHARS.chatReply;
    if (content.length <= max) return;
    ctx.addIssue({ code: "custom", path: ["content"], message: `A message can be at most ${max.toLocaleString("en")} characters` });
  });

/** The conversation a chat request carries: the client sends only the most recent messages. */
export const ChatMessagesSchema = z.array(ChatMessageSchema).min(1).max(MAX_CHAT_MESSAGES);

export type BankChange = z.infer<typeof BankChangeSchema>;
export type ResumeChange = z.infer<typeof ResumeChangeSchema>;
export type ChatResult = z.infer<typeof ChatResultSchema>;
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

/** Templates with every field unset, for callers that build changes by hand (tests, fixtures). */
export const EMPTY_BANK_CHANGE: Omit<BankChange, "kind"> = {
  section: "",
  entryId: "",
  bulletId: "",
  entry: { title: "", org: "", location: "", start: "", end: "", link: "", bullets: [] },
  position: "",
  texts: [],
  text: "",
  field: "",
  category: "",
};

export const EMPTY_RESUME_CHANGE: Omit<ResumeChange, "kind"> = {
  section: "",
  entryId: "",
  entryTitle: "",
  bulletId: "",
  bulletText: "",
  text: "",
  direction: "",
  skills: [],
};
