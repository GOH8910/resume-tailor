import { env } from "@/lib/env";
import type { LegalContext } from "./types";

/** The deployment's details for the legal texts. Server-only: it reads the environment. */
export function legalContext(): LegalContext {
  return { contactEmail: env.privacyContactEmail, adsEnabled: env.adProvider === "google" };
}
