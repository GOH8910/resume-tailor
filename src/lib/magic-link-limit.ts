import { APIError } from "better-auth/api";

const MAX_LINKS = 5;
const WINDOW_MS = 60 * 60 * 1000;

// In memory, so per server process and reset on restart: a cap on emails to one inbox, not an audit log.
// Better Auth's own rate limiter already caps requests per IP.
const sentAt = new Map<string, number[]>();

/** Allows five sign-in links per address per hour; beyond that throws a 429. */
export function checkMagicLinkLimit(email: string, now = Date.now()): void {
  const key = email.toLowerCase();
  const recent = (sentAt.get(key) ?? []).filter((time) => now - time < WINDOW_MS);
  if (recent.length >= MAX_LINKS) {
    throw new APIError("TOO_MANY_REQUESTS", {
      code: "TOO_MANY_MAGIC_LINKS",
      message: "Too many sign-in links requested for this email. Try again in an hour.",
    });
  }
  sentAt.set(key, [...recent, now]);
}
