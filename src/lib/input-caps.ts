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

/** Messages per chat request: the client sends the most recent ones. */
export const MAX_CHAT_MESSAGES = 20;

/** The bank serialised as JSON, in UTF-8 bytes (300 KB). */
export const MAX_BANK_JSON_BYTES = 300_000;

/** Saved resumes (applications) per account. */
export const MAX_APPLICATIONS = 200;
