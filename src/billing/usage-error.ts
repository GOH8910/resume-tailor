import type { ModelUsage } from "./usage-types";

/**
 * Tags an error thrown after a Claude call returned with that call's usage, so the caller can still book the
 * tokens Anthropic billed. The error keeps its identity, message and status, so the response is unchanged, and
 * the usage is not enumerable, so it never ends up in anything serialised from the error.
 */
export function attachUsage(err: unknown, usage: ModelUsage): Error {
  const error = err instanceof Error ? err : new Error(String(err), { cause: err });
  Object.defineProperty(error, "usage", { value: usage, enumerable: false, configurable: true });
  return error;
}

/** The usage a failed call was billed for, if the error carries one (see attachUsage and ModelCallError). */
export function usageFromError(err: unknown): ModelUsage | undefined {
  if (typeof err !== "object" || err === null || !("usage" in err)) return undefined;
  return isModelUsage(err.usage) ? err.usage : undefined;
}

function isModelUsage(value: unknown): value is ModelUsage {
  if (typeof value !== "object" || value === null) return false;
  const usage = value as Record<string, unknown>;
  return typeof usage.model === "string" && Number.isFinite(usage.inputTokens) && Number.isFinite(usage.outputTokens);
}
