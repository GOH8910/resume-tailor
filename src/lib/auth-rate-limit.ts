const HOUR_S = 60 * 60;

/**
 * Better Auth's per-IP limits for the magic-link paths, in place of the magic-link plugin's own rule for them (5 a
 * minute): one IP may ask for 5 links an hour, so it cannot mail many inboxes, and open 20. Our per-email throttle
 * (magic-link-limit.ts) applies as well. Better Auth collapses IPv6 addresses to their /64 before counting.
 * Enforced in production only (Better Auth's default), in memory, so per process.
 */
export function signInRateRules() {
  return {
    "/sign-in/magic-link": { window: HOUR_S, max: 5 },
    "/magic-link/verify": { window: HOUR_S, max: 20 },
  };
}
