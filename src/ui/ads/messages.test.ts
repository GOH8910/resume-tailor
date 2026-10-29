import { describe, expect, it } from "vitest";
import { ApiError } from "@/ui/api";
import { adErrorMessage, adLimitMessage, creditProblem, creditsLabel, pausedMessage } from "./messages";

describe("creditProblem", () => {
  it("reads a short balance", () => {
    const err = new ApiError("Not enough credits", 402, { credits: 1, needed: 2 });
    expect(creditProblem(err)).toEqual({ kind: "short", credits: 1, needed: 2 });
  });

  it("reads a pause, in local time rather than the server's ISO string", () => {
    const resumesAt = "2026-10-30T00:00:00.000Z";
    const err = new ApiError("Free AI features are paused until …", 402, { paused: true, reason: "budget", resumesAt });
    const problem = creditProblem(err);
    expect(problem?.kind).toBe("paused");
    expect(problem?.kind === "paused" && problem.message).toMatch(/^Free AI features are paused until \S/);
    expect(problem?.kind === "paused" && problem.message).not.toContain(resumesAt);
  });

  it("ignores other errors", () => {
    expect(creditProblem(new ApiError("Bad request", 400))).toBeNull();
    expect(creditProblem(new ApiError("Payment required", 402))).toBeNull();
    expect(creditProblem(new Error("network"))).toBeNull();
  });
});

describe("pausedMessage", () => {
  it("names the operator for a manual pause", () => {
    expect(pausedMessage("manual", undefined)).toBe("Free AI features are paused by the operator");
  });

  it("falls back when there is no end time", () => {
    expect(pausedMessage("budget", undefined)).toBe("Free AI features are paused");
    expect(pausedMessage("budget", "not a date")).toBe("Free AI features are paused");
  });
});

describe("adLimitMessage", () => {
  it("says tomorrow when the reset falls on the next local day", () => {
    const now = new Date(2026, 9, 29, 15, 0);
    const resetsAt = new Date(2026, 9, 30, 1, 0).toISOString();
    expect(adLimitMessage(resetsAt, now)).toMatch(/^Daily ad limit reached, try again tomorrow after \S/);
  });

  it("gives only the time when the reset is later today", () => {
    const now = new Date(2026, 9, 29, 15, 0);
    const resetsAt = new Date(2026, 9, 29, 19, 0).toISOString();
    expect(adLimitMessage(resetsAt, now)).toMatch(/^Daily ad limit reached, try again after \S/);
  });

  it("falls back without a reset time", () => {
    expect(adLimitMessage(undefined)).toBe("Daily ad limit reached, try again tomorrow");
  });
});

describe("adErrorMessage", () => {
  const now = new Date(2026, 9, 29, 15, 0);
  const resetsAt = new Date(2026, 9, 30, 1, 0).toISOString();

  it.each(["account", "ip"])("explains the daily cap per %s with its reset time", (reason) => {
    const err = new ApiError("Daily ad limit reached", 429, { reason, resetsAt });
    expect(adErrorMessage(err, now)).toMatch(/^Daily ad limit reached, try again tomorrow after \S/);
  });

  it("keeps the server's words for any other 429, such as a burst limit", () => {
    expect(adErrorMessage(new ApiError("Too many requests", 429, { retryAfter: 30 }), now)).toBe("Too many requests");
  });

  it("keeps the server's reason for a refused grant", () => {
    const err = new ApiError("The ad was closed too early", 409, { reason: "watched too briefly" });
    expect(adErrorMessage(err, now)).toBe("The ad was closed too early");
    expect(adErrorMessage(new ApiError("Ad session is not pending", 409), now)).toBe("Ad session is not pending");
  });

  it("falls back for errors without a message", () => {
    expect(adErrorMessage(new Error("Failed to fetch"), now)).toBe("Failed to fetch");
    expect(adErrorMessage("boom", now)).toBe("Something went wrong");
  });
});

describe("creditsLabel", () => {
  it("pluralises", () => {
    expect(creditsLabel(0)).toBe("0 credits");
    expect(creditsLabel(1)).toBe("1 credit");
    expect(creditsLabel(2)).toBe("2 credits");
  });
});
