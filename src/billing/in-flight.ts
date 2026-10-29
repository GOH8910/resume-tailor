import { AppError } from "@/lib/errors";

/**
 * At most `max` free Claude calls at once across the server. The daily budget is checked before each call, not
 * atomically with it, so this also bounds how far calls already running can overshoot it. In memory, like the rate
 * limits (one machine).
 */
export function createInFlightCap(max: number) {
  let running = 0;
  return {
    /** Takes a slot and returns its release, or refuses with a 503 while all `max` are taken. */
    claim(): () => void {
      if (running >= max) throw new AppError("The free AI is busy, try again in a moment", 503, { retryAfter: 5 });
      running += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        running -= 1;
      };
    },
    running: () => running,
  };
}

export type InFlightCap = ReturnType<typeof createInFlightCap>;
