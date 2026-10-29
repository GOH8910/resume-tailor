export type AdProviderName = "none" | "test" | "google";

/** What the browser needs to show a rewarded ad. Built on the server from the environment; never carries secrets. */
export type AdClientConfig = {
  provider: AdProviderName;
  /** The Google Ad Manager ad unit, only for the google provider. */
  adUnitPath?: string;
  /** Whether only the ad network's server-side callback grants credits, so the client waits for it. */
  ssv: boolean;
  /** The server refuses a grant sooner than this after the ad session started. */
  minWatchSeconds: number;
};

/** How long the test ad plays: always past the server's minimum watch time, so watching to the end is accepted. */
export function testAdSeconds(minWatchSeconds: number): number {
  return Math.max(minWatchSeconds + 1, 2);
}

const TICK_MS = 100;

/**
 * Runs the test ad's clock: `onProgress` gets the fraction played (0 to 1) every tick and `onDone` fires once at
 * the end. Time is measured from the start rather than by counting ticks, because background tabs throttle timers.
 * Returns a function that stops the clock without calling `onDone`.
 */
export function createTestAdTimer(
  minWatchSeconds: number,
  onDone: () => void,
  onProgress?: (fraction: number) => void,
): () => void {
  const totalMs = testAdSeconds(minWatchSeconds) * 1000;
  const startedAt = Date.now();
  let stopped = false;
  const tick = setInterval(() => {
    if (stopped) return;
    const fraction = Math.min((Date.now() - startedAt) / totalMs, 1);
    onProgress?.(fraction);
    if (fraction < 1) return;
    stop();
    onDone();
  }, TICK_MS);
  function stop() {
    stopped = true;
    clearInterval(tick);
  }
  return stop;
}
