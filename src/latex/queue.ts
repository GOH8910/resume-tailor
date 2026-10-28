const DEFAULT_CONCURRENCY = 2;

/** A tiny concurrency limiter: jobs beyond `limit` wait in FIFO order. */
export function createQueue(limit: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  // A finished job hands its slot straight to the next waiter instead of freeing it, so a job arriving
  // before that waiter wakes up cannot take the slot too and push the count past the limit.
  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else active--;
  };
  return {
    async run<T>(job: () => Promise<T>): Promise<T> {
      if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
      else active++;
      try {
        return await job();
      } finally {
        release();
      }
    },
  };
}

/** COMPILE_CONCURRENCY as a positive integer, or the default when unset or invalid. */
export function concurrencyFromEnv(value: string | undefined): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 ? n : DEFAULT_CONCURRENCY;
}

/** Shared by every compile in the process so a burst of requests cannot starve the container. */
export const compileQueue = createQueue(concurrencyFromEnv(process.env.COMPILE_CONCURRENCY));
