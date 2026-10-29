import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";

export type QueueOptions = { maxWaiting?: number };

const DEFAULT_MAX_WAITING = 8;
const BUSY_RETRY_AFTER_SECONDS = 10;

/**
 * A tiny concurrency limiter: jobs beyond `limit` wait in FIFO order, and beyond `maxWaiting` waiting jobs a new
 * one is refused with a 503 rather than queued behind minutes of work. Each running job gets a slot index in
 * `0..limit-1` that no other running job has, so it can use per-slot resources (the TeX user of that slot).
 */
export function createQueue(limit: number, { maxWaiting = DEFAULT_MAX_WAITING }: QueueOptions = {}) {
  if (!Number.isInteger(limit) || limit < 1) throw new Error("A queue needs a limit of at least 1");
  const free = Array.from({ length: limit }, (_, slot) => slot);
  const waiting: ((slot: number) => void)[] = [];
  // A finished job hands its slot straight to the next waiter instead of freeing it, so a job arriving
  // before that waiter wakes up cannot take the slot too and push the count past the limit.
  const release = (slot: number) => {
    const next = waiting.shift();
    if (next) next(slot);
    else free.push(slot);
  };
  const acquire = (): number | Promise<number> => {
    const slot = free.shift();
    if (slot !== undefined) return slot;
    if (waiting.length >= maxWaiting) {
      throw new AppError("Server busy, try again in a moment", 503, { retryAfter: BUSY_RETRY_AFTER_SECONDS });
    }
    return new Promise<number>((resolve) => waiting.push(resolve));
  };
  return {
    async run<T>(job: (slot: number) => Promise<T>): Promise<T> {
      const slot = await acquire();
      try {
        return await job(slot);
      } finally {
        release(slot);
      }
    },
  };
}

/** Shared by every compile in the process so a burst of requests cannot starve the container. */
export const compileQueue = createQueue(env.COMPILE_CONCURRENCY);
