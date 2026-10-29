import type { AdSessionStatus } from "@/credits/types";

/** `POST /api/ads/grant`: the new balance, plus the session's status when only the ad network's callback grants. */
export type GrantResponse = { credits: number; status?: AdSessionStatus };
export type SendGrant = (sessionId: string) => Promise<GrantResponse>;

export const VERIFY_POLL_MS = 1000;
export const VERIFY_WAIT_MS = 20_000;

/**
 * Claims a watched ad's credit and returns the new balance. Without server-side verification the first answer
 * grants it; with it, the answer carries the session's status, so keep asking until the network's callback lands.
 */
export async function claimCredit(sessionId: string, sendGrant: SendGrant): Promise<number> {
  const deadline = Date.now() + VERIFY_WAIT_MS;
  for (;;) {
    const result = await sendGrant(sessionId);
    if (result.status === undefined || result.status === "granted") return result.credits;
    if (result.status === "rejected") throw new Error("The ad network did not confirm this ad, so no credit was added");
    if (Date.now() >= deadline) {
      throw new Error("The ad network has not confirmed this ad yet. If it does, the credit shows after a reload.");
    }
    await new Promise((resolve) => setTimeout(resolve, VERIFY_POLL_MS));
  }
}
