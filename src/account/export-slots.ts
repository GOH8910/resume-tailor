import { AppError } from "@/lib/errors";

/**
 * Who may start a data export now: one at a time per account, and at most `maxRunning` across the server, since each
 * keeps reading from the database for as long as the browser downloads. In memory, like the rate limits (one machine).
 */
export function createExportSlots(maxRunning: number) {
  const running = new Set<string>();
  return {
    /** Takes a slot for the account and returns its release, or refuses: 409 while its own export runs, 503 when full. */
    claim(userId: string): () => void {
      if (running.has(userId)) throw new AppError("An export is already running", 409);
      if (running.size >= maxRunning) {
        throw new AppError("Too many exports are running, try again in a moment", 503, { retryAfter: 10 });
      }
      running.add(userId);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        running.delete(userId);
      };
    },
  };
}
