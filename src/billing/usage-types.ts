// Plain types only: the model layer imports these, and must not pull in the database.

export const USAGE_KINDS = ["tailor", "chat", "seed"] as const;
export type UsageKind = (typeof USAGE_KINDS)[number];

/** The tokens one Claude call used, as Anthropic bills them. */
export type ModelUsage = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
};
