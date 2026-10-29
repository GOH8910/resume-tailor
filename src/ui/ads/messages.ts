import { ApiError, errorMessage } from "@/ui/api";

/** Why a paid AI route answered 402: the account is short of credits, or free usage is paused (for everyone or the account). */
export type CreditProblem = { kind: "short"; credits: number; needed: number } | { kind: "paused"; message: string };

type PaymentDetails = { credits?: unknown; needed?: unknown; paused?: unknown; reason?: unknown; resumesAt?: unknown };

/** Reads a 402 from `/api/tailor` or `/api/chat`; any other error is null. */
export function creditProblem(err: unknown): CreditProblem | null {
  if (!(err instanceof ApiError) || err.status !== 402) return null;
  const details = (err.details ?? {}) as PaymentDetails;
  if (details.paused === true) return { kind: "paused", message: pausedMessage(details.reason, details.resumesAt) };
  if (typeof details.credits === "number" && typeof details.needed === "number") {
    return { kind: "short", credits: details.credits, needed: details.needed };
  }
  return null;
}

/** `reason` "account": this account reached its own daily limit; the others pause free usage for everyone. */
export function pausedMessage(reason: unknown, resumesAt: unknown): string {
  if (reason === "manual") return "Free AI features are paused by the operator";
  const at = parseDate(resumesAt);
  const when = at?.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
  if (reason === "account") {
    const limit = "You've reached today's free AI limit for this account";
    return when ? `${limit}; it resets at ${when}` : limit;
  }
  return when ? `Free AI features are paused until ${when}` : "Free AI features are paused";
}

/** The message for the daily ad cap. It resets at midnight UTC, which is not always tomorrow in local time. */
export function adLimitMessage(resetsAt: unknown, now = new Date()): string {
  const at = parseDate(resetsAt);
  if (!at) return "Daily ad limit reached, try again tomorrow";
  const time = at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const day = at.toDateString() === now.toDateString() ? "" : "tomorrow ";
  return `Daily ad limit reached, try again ${day}after ${time}`;
}

/** What to tell the viewer when starting or claiming an ad failed. */
export function adErrorMessage(err: unknown, now = new Date()): string {
  if (err instanceof ApiError && err.status === 429) {
    const details = (err.details ?? {}) as { reason?: unknown; resetsAt?: unknown };
    if (details.reason === "account" || details.reason === "ip") return adLimitMessage(details.resetsAt, now);
  }
  // Anything else carries the server's own words, e.g. a 409's "The ad was closed too early".
  return errorMessage(err);
}

export function creditsLabel(count: number): string {
  return `${count} ${count === 1 ? "credit" : "credits"}`;
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
