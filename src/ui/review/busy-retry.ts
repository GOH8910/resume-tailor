import { ApiError, retryAfterOf } from "@/ui/api";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Why the server asked to wait: its compile queue is full (503), or this account hit its compile limit (429). */
export type WaitReason = "busy" | "limited";

export type RetryOptions = {
  onWait: (seconds: number, reason: WaitReason) => void;
  /** Checked after the wait: false (the preview unmounted) skips the retry and passes the first error on. */
  stillWanted: () => boolean;
  wait?: (ms: number) => Promise<void>;
};

/**
 * Runs `attempt`; when the server asks to wait (a 503 or 429 carrying details.retryAfter), reports the wait, waits
 * it out and tries once more. Any other error, or a second refusal, goes to the caller.
 */
export async function retryOnceAfterWait<T>(attempt: () => Promise<T>, { onWait, stillWanted, wait = sleep }: RetryOptions): Promise<T> {
  try {
    return await attempt();
  } catch (err) {
    const seconds = retryAfterOf(err);
    if (seconds === null || !(err instanceof ApiError)) throw err;
    onWait(seconds, err.status === 503 ? "busy" : "limited");
    await wait(seconds * 1000);
    if (!stillWanted()) throw err;
    return attempt();
  }
}
