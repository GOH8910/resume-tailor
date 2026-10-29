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

export type RewardedAdEvents = {
  /** The server's ad session, which a network with server-side verification echoes back to it. */
  sessionId: string;
  /** The ad is on screen. Ends the caller's load timeout; never fires for an ad that failed to load. */
  onShown?: () => void;
  onGranted: () => void;
  onClosed: () => void;
  onError: (message: string) => void;
};

/**
 * Shows one rewarded ad and returns `remove`, which takes it down. The contract every provider keeps:
 * - Exactly one terminal callback fires (onGranted, onClosed or onError), once, and only after the ad's UI is gone
 *   from the page. It may fire before `show` returns when the ad cannot start at all.
 * - onShown fires at most once, before the terminal callback.
 * - `remove` is idempotent and suppresses every later callback; the caller decides what a removed ad means.
 */
export type ShowRewardedAd = (events: RewardedAdEvents) => () => void;

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
