import type { ShowRewardedAd } from "@/ads/provider";

export const DID_NOT_LOAD = "The ad did not load, try again";
export const LOAD_TIMEOUT_MS = 15_000;

export type AdOutcome = { kind: "granted" } | { kind: "closed" } | { kind: "error"; message: string };

/** Where playAd leaves a way to take down the ad while it plays (a React ref fits). */
export type RemoveRef = { current: (() => void) | null };

/**
 * Shows the ad and settles on its first terminal event. Until it is on screen, a timeout stands in for a blocked or
 * stalled ad network. While it plays, `removeRef` holds a way to take it down, which counts as closing it.
 */
export function playAd(show: ShowRewardedAd, sessionId: string, removeRef: RemoveRef): Promise<AdOutcome> {
  return new Promise((resolve) => {
    let settled = false;
    let remove = () => {};
    const settle = (outcome: AdOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(loadTimer);
      removeRef.current = null;
      remove();
      resolve(outcome);
    };
    const loadTimer = setTimeout(() => settle({ kind: "error", message: DID_NOT_LOAD }), LOAD_TIMEOUT_MS);
    remove = show({
      sessionId,
      onShown: () => clearTimeout(loadTimer),
      onGranted: () => settle({ kind: "granted" }),
      onClosed: () => settle({ kind: "closed" }),
      onError: (message) => settle({ kind: "error", message }),
    });
    // A provider may settle before `show` returns (the Google stub does), when `remove` was still the no-op.
    if (settled) remove();
    else removeRef.current = () => settle({ kind: "closed" });
  });
}
