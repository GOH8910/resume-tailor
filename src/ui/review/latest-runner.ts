/**
 * Runs an async job one at a time. A request made while a job is running is held back, and only
 * the most recent one runs afterwards, so a burst of edits costs one extra run, not one per edit.
 * `run` is expected to report its own errors; a rejection is dropped so it cannot block the next request.
 */
export function createLatestRunner<T>(run: (input: T) => Promise<void>): (input: T) => void {
  let running = false;
  let pending: { input: T } | null = null;

  async function start(input: T): Promise<void> {
    running = true;
    try {
      await run(input);
    } catch {
      // Reported by `run` itself; nothing to surface from here.
    } finally {
      running = false;
      if (pending) {
        const next = pending.input;
        pending = null;
        void start(next);
      }
    }
  }

  return (input) => {
    if (running) {
      pending = { input };
      return;
    }
    void start(input);
  };
}
