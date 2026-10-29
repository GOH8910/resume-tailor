"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { api } from "@/ui/api";
import { useMe } from "@/ui/useMe";
import { claimCredit, type GrantResponse } from "./claim";
import { adErrorMessage } from "./messages";
import { playAd } from "./play-ad";
import { adSlot, loadProvider } from "./providers";

const CLOSED_EARLY = "The ad was closed too early";

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
  const mounted = useRef(false);
  const ads = me?.ads;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => () => removeAd.current?.(), []);

  const watchAd = useCallback(async () => {
    if (!ads || !adSlot.claim()) return;
    setLastError(null);
    try {
      const show = await loadProvider(ads);
      if (!show) return;
      const { sessionId } = await api.send<{ sessionId: string }>("/api/ads/start", "POST");
      // The button may have gone while the provider loaded or the session started; its cleanup has already run, so
      // an ad shown now could never be taken down. The unused session stays pending and earns nothing.
      if (!mounted.current) return;
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
