import { ApiError, retryAfterOf } from "@/ui/api";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Runs `attempt`; when the server is busy (a 503 that carries details.retryAfter: the compile queue was full),
 * reports the wait through `onWait`, waits it out and tries once more. Any other error, or a second busy answer,
 * goes to the caller.
 */
export async function retryOnceWhenBusy<T>(
  attempt: () => Promise<T>,
  onWait: (seconds: number) => void,
  wait: (ms: number) => Promise<void> = sleep,
): Promise<T> {
  try {
    return await attempt();
  } catch (err) {
    const seconds = err instanceof ApiError && err.status === 503 ? retryAfterOf(err) : null;
    if (seconds === null) throw err;
    onWait(seconds);
    await wait(seconds * 1000);
    return attempt();
  }
}
