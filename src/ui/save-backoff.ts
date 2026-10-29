import { ApiError, retryAfterOf } from "./api";

/** The wait, in seconds, that a 429 answering an autosave asks for; null for any other failure. */
export function saveRateLimitWait(err: unknown): number | null {
  return err instanceof ApiError && err.status === 429 ? retryAfterOf(err) : null;
}

/** When the next autosave may run: after the usual debounce, and not before a pending rate limit's wait is over. */
export function nextSaveDelay(now: number, retryAt: number | null, debounceMs: number): number {
  return Math.max(debounceMs, (retryAt ?? 0) - now);
}
