"use client";

import { type RefObject, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ShowRewardedAd } from "@/ads/provider";
import { api } from "@/ui/api";
import { useMe } from "@/ui/useMe";
import { claimCredit, type GrantResponse } from "./claim";
import { adErrorMessage } from "./messages";
import { adSlot, loadProvider } from "./providers";

const CLOSED_EARLY = "The ad was closed too early";
const DID_NOT_LOAD = "The ad did not load, try again";
const LOAD_TIMEOUT_MS = 15_000;

export type Credits = {
  credits: number;
  creditsPerTailor: number;
  creditsPerChatMessage: number;
  chargesCredits: boolean;
  adsAvailable: boolean;
  /** Plays one rewarded ad and adds its credit to the shared balance; failures land in `lastError`. */
  watchAd: () => Promise<void>;
  /** An ad is under way anywhere on the page: only one plays at a time. */
  watching: boolean;
  lastError: string | null;
};

const sendGrant = (sessionId: string) => api.send<GrantResponse>("/api/ads/grant", "POST", { sessionId });

/** The account's credits and a way to earn more by watching an ad. */
export function useCredits(): Credits {
  const { me, setCredits } = useMe();
  const watching = useSyncExternalStore(adSlot.subscribe, adSlot.isTaken, () => false);
  const [lastError, setLastError] = useState<string | null>(null);
  // Takes down the ad this component started, e.g. when the viewer leaves the page while it plays.
  const removeAd = useRef<(() => void) | null>(null);
  const ads = me?.ads;

  useEffect(() => () => removeAd.current?.(), []);

  const watchAd = useCallback(async () => {
    if (!ads || !adSlot.claim()) return;
    setLastError(null);
    try {
      const show = await loadProvider(ads);
      if (!show) return;
      const { sessionId } = await api.send<{ sessionId: string }>("/api/ads/start", "POST");
      const outcome = await playAd(show, sessionId, removeAd);
      if (outcome.kind === "granted") setCredits(await claimCredit(sessionId, sendGrant));
      else setLastError(outcome.kind === "closed" ? CLOSED_EARLY : outcome.message);
    } catch (err) {
      setLastError(adErrorMessage(err));
    } finally {
      adSlot.release();
    }
  }, [ads, setCredits]);

  return {
    credits: me?.credits ?? 0,
    creditsPerTailor: me?.creditsPerTailor ?? 0,
    creditsPerChatMessage: me?.creditsPerChatMessage ?? 0,
    chargesCredits: me?.policy.chargesCredits ?? false,
    adsAvailable: me?.adsAvailable ?? false,
    watchAd,
    watching,
    lastError,
  };
}

type AdOutcome = { kind: "granted" } | { kind: "closed" } | { kind: "error"; message: string };

/**
 * Shows the ad and settles on its first terminal event. Until it is on screen, a timeout stands in for a blocked or
 * stalled ad network. While it plays, `removeRef` holds a way to take it down, which counts as closing it.
 */
function playAd(show: ShowRewardedAd, sessionId: string, removeRef: RefObject<(() => void) | null>): Promise<AdOutcome> {
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
