"use client";

import { useCallback, useRef, useState } from "react";
import type { AdSessionStatus } from "@/credits/types";
import { api, ApiError, errorMessage } from "@/ui/api";
import { useMe } from "@/ui/useMe";
import { adLimitMessage } from "./messages";
import { providerFor, type ShowRewardedAd } from "./providers";

const CLOSED_EARLY = "The ad was closed too early";
const VERIFY_POLL_MS = 1000;
const VERIFY_WAIT_MS = 20_000;

export type Credits = {
  credits: number;
  creditsPerTailor: number;
  creditsPerChatMessage: number;
  chargesCredits: boolean;
  adsAvailable: boolean;
  /** Plays one rewarded ad and adds its credit to the shared balance; failures land in `lastError`. */
  watchAd: () => Promise<void>;
  watching: boolean;
  lastError: string | null;
};

/** The account's credits and a way to earn more by watching an ad. */
export function useCredits(): Credits {
  const { me, setCredits } = useMe();
  const [watching, setWatching] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  // Catches a second click in the same tick, before `watching` has re-rendered.
  const inFlight = useRef(false);
  const ads = me?.ads;

  const watchAd = useCallback(async () => {
    const show = ads ? providerFor(ads) : null;
    if (!show || inFlight.current) return;
    inFlight.current = true;
    setWatching(true);
    setLastError(null);
    try {
      const { sessionId } = await api.send<{ sessionId: string }>("/api/ads/start", "POST");
      const outcome = await playAd(show, sessionId);
      if (outcome.kind === "granted") setCredits(await claimCredit(sessionId));
      else setLastError(outcome.kind === "closed" ? CLOSED_EARLY : outcome.message);
    } catch (err) {
      setLastError(adErrorMessage(err));
    } finally {
      inFlight.current = false;
      setWatching(false);
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

async function playAd(show: ShowRewardedAd, sessionId: string): Promise<AdOutcome> {
  let remove = () => {};
  // The first callback settles it; a provider may report before `show` returns (the Google stub does).
  const outcome = await new Promise<AdOutcome>((resolve) => {
    remove = show({
      sessionId,
      onGranted: () => resolve({ kind: "granted" }),
      onClosed: () => resolve({ kind: "closed" }),
      onError: (message) => resolve({ kind: "error", message }),
    });
  });
  remove();
  return outcome;
}

type GrantResponse = { credits: number; status?: AdSessionStatus };

/**
 * Asks the server for the ad's credit and returns the new balance. Without server-side verification the grant
 * answers at once; with it, the answer carries the session's status, and only the ad network's callback grants.
 */
async function claimCredit(sessionId: string): Promise<number> {
  const deadline = Date.now() + VERIFY_WAIT_MS;
  for (;;) {
    const result = await api.send<GrantResponse>("/api/ads/grant", "POST", { sessionId });
    if (result.status === undefined || result.status === "granted") return result.credits;
    if (result.status === "rejected") throw new Error("The ad network did not confirm this ad, so no credit was added");
    if (Date.now() >= deadline) {
      throw new Error("The ad network has not confirmed this ad yet. If it does, the credit shows after a reload.");
    }
    await new Promise((resolve) => setTimeout(resolve, VERIFY_POLL_MS));
  }
}

function adErrorMessage(err: unknown): string {
  if (err instanceof ApiError && err.status === 429) {
    const details = (err.details ?? {}) as { reason?: unknown; resetsAt?: unknown };
    if (details.reason === "account" || details.reason === "ip") return adLimitMessage(details.resetsAt);
  }
  // A 409 carries the server's reason, e.g. "The ad was closed too early".
  return errorMessage(err);
}
