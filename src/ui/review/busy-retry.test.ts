import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/ui/api";
import { retryOnceAfterWait } from "./busy-retry";

const busy = () => new ApiError("Server busy, try again in a moment", 503, { retryAfter: 10 });
const limited = () => new ApiError("Too many compile requests, try again in 20 s", 429, { retryAfter: 20 });
const noWait = async () => {};

describe("retryOnceAfterWait", () => {
  it("returns the first result without waiting", async () => {
    const onWait = vi.fn();
    const wait = vi.fn();
    expect(await retryOnceAfterWait(async () => "pdf", { onWait, stillWanted: () => true, wait })).toBe("pdf");
    expect(onWait).not.toHaveBeenCalled();
    expect(wait).not.toHaveBeenCalled();
  });

  it.each([
    ["the queue is full", busy, 10, "busy"],
    ["the account is rate limited", limited, 20, "limited"],
  ] as const)("reports the wait, waits it out and tries once more when %s", async (_label, error, seconds, reason) => {
    const attempt = vi.fn().mockRejectedValueOnce(error()).mockResolvedValueOnce("pdf");
    const onWait = vi.fn();
    const wait = vi.fn(noWait);
    expect(await retryOnceAfterWait(attempt, { onWait, stillWanted: () => true, wait })).toBe("pdf");
    expect(onWait).toHaveBeenCalledWith(seconds, reason);
    expect(wait).toHaveBeenCalledWith(seconds * 1000);
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it("gives up after one retry", async () => {
    const attempt = vi.fn().mockRejectedValue(busy());
    await expect(retryOnceAfterWait(attempt, { onWait: () => {}, stillWanted: () => true, wait: noWait })).rejects.toMatchObject({
      status: 503,
    });
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it("does not retry once the caller has gone (the preview unmounted during the wait)", async () => {
    const error = busy();
    const attempt = vi.fn().mockRejectedValue(error);
    let wanted = true;
    const wait = async () => {
      wanted = false;
    };
    await expect(retryOnceAfterWait(attempt, { onWait: () => {}, stillWanted: () => wanted, wait })).rejects.toBe(error);
    expect(attempt).toHaveBeenCalledOnce();
  });

  it.each([
    ["a 503 without retryAfter", new ApiError("The AI service is not configured on this server", 503, null)],
    ["a 429 without retryAfter", new ApiError("Daily ad limit reached", 429, { reason: "account" })],
    ["a LaTeX error", new ApiError("LaTeX compilation failed", 422, "log")],
  ])("does not retry %s", async (_label, error) => {
    const attempt = vi.fn().mockRejectedValue(error);
    await expect(retryOnceAfterWait(attempt, { onWait: () => {}, stillWanted: () => true, wait: noWait })).rejects.toBe(error);
    expect(attempt).toHaveBeenCalledOnce();
  });
});
