import type { Db } from "@/db/types";
import { forgetOldIps } from "./service";

export const IP_PURGE_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Blanks ad-session IPs past their retention now and every hour after, so they go on time even when nobody starts an
 * ad (the privacy page promises about two days). The timer does not keep the process alive. A failed run is logged
 * and the next hour tries again.
 */
export function startIpPurge(getDb: () => Promise<Db>): void {
  const run = async () => {
    try {
      await forgetOldIps(await getDb(), new Date());
    } catch (err) {
      console.error("[credits] blanking old ad-session IPs failed; retrying in an hour", err);
    }
  };
  void run();
  setInterval(() => void run(), IP_PURGE_INTERVAL_MS).unref();
}
