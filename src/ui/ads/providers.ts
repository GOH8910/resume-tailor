import type { AdClientConfig, ShowRewardedAd } from "@/ads/provider";

/**
 * The way to show a rewarded ad on this server, or null when it has no ad network. A provider's code is imported
 * only when an ad is about to play, so the test ad never ships in the pages' initial bundle.
 */
export async function loadProvider(config: AdClientConfig): Promise<ShowRewardedAd | null> {
  switch (config.provider) {
    case "none":
      return null;
    case "test": {
      const { showTestAd } = await import("./test-ad");
      return (events) => showTestAd(config.minWatchSeconds, events);
    }
    case "google":
      return showGoogleAd;
  }
}

// Phase 2b loads the Google Publisher Tag and shows a rewarded slot here.
const showGoogleAd: ShowRewardedAd = ({ onError }) => {
  onError("Google ads are not wired up yet");
  return () => {};
};

// One ad at a time for the whole page, however many "Watch an ad" buttons are mounted.
let adPlaying = false;
const listeners = new Set<() => void>();

function setAdPlaying(playing: boolean): void {
  adPlaying = playing;
  for (const listener of listeners) listener();
}

export const adSlot = {
  /** For useSyncExternalStore. */
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  isTaken: (): boolean => adPlaying,
  /** Takes the slot; false when an ad is already under way somewhere on the page. */
  claim(): boolean {
    if (adPlaying) return false;
    setAdPlaying(true);
    return true;
  },
  release(): void {
    setAdPlaying(false);
  },
};
