"use client";

import { Button } from "@/ui/Button";
import { creditsLabel } from "./messages";
import { useCredits } from "./useCredits";

/**
 * "Watch an ad (+1 credit)" for accounts that pay in credits, and nothing for the others. While the ad plays the
 * button is aria-disabled rather than disabled, so it keeps focus and the ad dialog can hand focus back to it.
 */
export function RewardedAdButton({ size = "md" }: { size?: "sm" | "md" }) {
  const { chargesCredits, adsAvailable, credits, watchAd, watching, lastError } = useCredits();
  if (!chargesCredits) return null;
  if (!adsAvailable) {
    return (
      <p className="text-xs text-ink-faint">Ads aren&apos;t available yet. Your account has {creditsLabel(credits)}.</p>
    );
  }
  return (
    <div className="grid gap-1.5">
      <Button
        size={size}
        variant="secondary"
        aria-disabled={watching}
        onClick={() => {
          if (!watching) void watchAd();
        }}
        className={watching ? "cursor-progress opacity-60" : ""}
      >
        {watching ? "Watching the ad…" : "Watch an ad (+1 credit)"}
      </Button>
      {lastError && (
        <p role="alert" className="text-xs text-danger">
          {lastError}
        </p>
      )}
    </div>
  );
}
