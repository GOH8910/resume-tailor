import { env, type Env } from "@/lib/env";
import type { AdClientConfig } from "./provider";

type AdSettings = Pick<Env, "adProvider" | "AD_UNIT_PATH" | "AD_SSV_ENABLED" | "AD_MIN_WATCH_SECONDS">;

/** The ad settings `GET /api/me` hands the browser. Server only: it reads the environment. */
export function adClientConfig(settings: AdSettings = env): AdClientConfig {
  const usesAdUnit = settings.adProvider === "google" && Boolean(settings.AD_UNIT_PATH);
  return {
    provider: settings.adProvider,
    ...(usesAdUnit ? { adUnitPath: settings.AD_UNIT_PATH } : {}),
    ssv: settings.AD_SSV_ENABLED,
    minWatchSeconds: settings.AD_MIN_WATCH_SECONDS,
  };
}
