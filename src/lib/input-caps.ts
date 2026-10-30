/**
 * Caps on what people send, shared by the request schemas and the form fields. They are generous for a resume and
 * apply in every mode; they bound what one request can cost (tokens, compile time, storage), not normal use.
 * Stored data is read without them, so a bank saved before the caps still loads.
 */
export const MAX_CHARS = {
  jobDescription: 20_000,
  company: 200,
  roleTitle: 200,
  bullet: 600,
  summary: 2_000,
  chatMessage: 4_000,
  // Claude's own replies come back in the chat history; they are bounded by its output limit, not by typing.
  chatReply: 16_000,
} as const;

/** Messages per chat request, and their characters in total: the client sends the most recent ones that fit. */
export const MAX_CHAT_MESSAGES = 20;
export const MAX_CHAT_TOTAL_CHARS = 40_000;

/** The bank serialised as JSON, in UTF-8 bytes (300 KB). */
export const MAX_BANK_JSON_BYTES = 300_000;

/**
 * One resume (an application's review state) serialised as JSON, in UTF-8 bytes (700 KB). "Start from full bank"
 * stores each bullet twice (original and text), so a resume from a bank at its cap can be about twice its size.
 */
export const MAX_RESUME_JSON_BYTES = 2 * MAX_BANK_JSON_BYTES + 100_000;

/** The size of `value` as JSON in UTF-8 bytes, which is what the byte caps count. */
export function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

/** Saved resumes (applications) per account. */
export const MAX_APPLICATIONS = 200;

/** `text` cut to `max` UTF-16 units (what the caps count), never ending on half of a surrogate pair. */
export function truncateText(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
}
