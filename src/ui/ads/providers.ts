import { createElement } from "react";
import { createRoot } from "react-dom/client";
import type { AdClientConfig } from "@/ads/provider";
import { TestAdModal } from "./TestAdModal";

export type RewardedAdEvents = {
  /** The server's ad session, which a network with server-side verification echoes back to it. */
  sessionId: string;
  onGranted: () => void;
  onClosed: () => void;
  onError: (message: string) => void;
};

/** Shows one rewarded ad and reports how it ended through exactly one callback. Returns a function that removes it. */
export type ShowRewardedAd = (events: RewardedAdEvents) => () => void;

/** The way to show a rewarded ad on this server, or null when it has no ad network. */
export function providerFor(config: AdClientConfig): ShowRewardedAd | null {
  switch (config.provider) {
    case "none":
      return null;
    case "test":
      return (events) => showTestAd(config.minWatchSeconds, events);
    case "google":
      return showGoogleAd;
  }
}

// Phase 2b loads the Google Publisher Tag and shows a rewarded slot here.
const showGoogleAd: ShowRewardedAd = ({ onError }) => {
  onError("Google ads are not wired up yet");
  return () => {};
};

function showTestAd(minWatchSeconds: number, { onGranted, onClosed }: RewardedAdEvents): () => void {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let open = true;
  const remove = () => {
    if (!open) return;
    open = false;
    // Deferred: Close calls this from a click handler that is still running inside this root.
    queueMicrotask(() => {
      root.unmount();
      container.remove();
    });
  };
  const endWith = (callback: () => void) => () => {
    if (!open) return;
    remove();
    callback();
  };
  root.render(createElement(TestAdModal, { minWatchSeconds, onFinished: endWith(onGranted), onDismiss: endWith(onClosed) }));
  return remove;
}
