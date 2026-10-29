import type { ModelUsage } from "@/billing/usage-types";
import type { TailorResult } from "./schema";

export const MODEL_IDS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"] as const;
export type ModelId = (typeof MODEL_IDS)[number];

export const MODEL_LABELS: Record<ModelId, string> = {
  "claude-opus-5-5": "Claude Opus 5.5",
  "claude-sonnet-5-5": "Claude Sonnet 5.5 (faster, cheaper)",
  "claude-haiku-5-5": "Claude Haiku 5.5 (fastest, cheapest)",
};

const MODEL_NAMES: Record<ModelId, string> = {
  "claude-opus-5-5": "Claude Opus 5.5",
  "claude-sonnet-5-5": "Claude Sonnet 5.5",
  "claude-haiku-5-5": "Claude Haiku 5.5",
};

export function isModelId(id: string): id is ModelId {
  return (MODEL_IDS as readonly string[]).includes(id);
}

/** A model's display name; an id configured outside MODEL_IDS is shown as is. */
export function modelName(id: string): string {
  return isModelId(id) ? MODEL_NAMES[id] : id;
}

export type TailorRequest = { system: string; user: string };

export interface TailorModel {
  readonly id: string;
  tailor(request: TailorRequest): Promise<{ result: TailorResult; usage: ModelUsage }>;
}
