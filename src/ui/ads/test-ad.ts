import { createElement } from "react";
import { createRoot } from "react-dom/client";
import type { RewardedAdEvents } from "@/ads/provider";
import { TestAdModal } from "./TestAdModal";

/** The test provider: TestAdModal in a React root of its own. Keeps the ShowRewardedAd contract in src/ads/provider.ts. */
export function showTestAd(minWatchSeconds: number, { onShown, onGranted, onClosed }: RewardedAdEvents): () => void {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let state: "open" | "ending" | "removed" = "open";

  // Deferred: the Close button and React effects call in here while this root is still running them.
  const tearDown = (then?: () => void) =>
    queueMicrotask(() => {
      root.unmount();
      container.remove();
      then?.();
    });

  const endWith = (callback: () => void) => () => {
    if (state !== "open") return;
    state = "ending";
    // The callback fires once the dialog is gone, unless `remove` was called in between.
    tearDown(() => {
      if (state !== "ending") return;
      state = "removed";
      callback();
    });
  };

  const remove = () => {
    if (state === "removed") return;
    const tearDownScheduled = state === "ending";
    state = "removed";
    if (!tearDownScheduled) tearDown();
  };

  root.render(
    createElement(TestAdModal, {
      minWatchSeconds,
      onShown: () => {
        if (state === "open") onShown?.();
      },
      onFinished: endWith(onGranted),
      onDismiss: endWith(onClosed),
    }),
  );
  return remove;
}
