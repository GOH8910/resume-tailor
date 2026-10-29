import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/ui/api";
import { retryOnceWhenBusy } from "./busy-retry";

const busy = () => new ApiError("Server busy, try again in a moment", 503, { retryAfter: 10 });

describe("retryOnceWhenBusy", () => {
  it("returns the first result without waiting", async () => {
    const onWait = vi.fn();
    const wait = vi.fn();
    expect(await retryOnceWhenBusy(async () => "pdf", onWait, wait)).toBe("pdf");
    expect(onWait).not.toHaveBeenCalled();
    expect(wait).not.toHaveBeenCalled();
  });

  it("reports the wait, waits it out and tries once more when the server is busy", async () => {
    const attempt = vi.fn().mockRejectedValueOnce(busy()).mockResolvedValueOnce("pdf");
    const onWait = vi.fn();
    const wait = vi.fn(async () => {});
    expect(await retryOnceWhenBusy(attempt, onWait, wait)).toBe("pdf");
    expect(onWait).toHaveBeenCalledWith(10);
    expect(wait).toHaveBeenCalledWith(10_000);
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it("gives up after one retry", async () => {
    const attempt = vi.fn().mockRejectedValue(busy());
    await expect(retryOnceWhenBusy(attempt, () => {}, async () => {})).rejects.toMatchObject({ status: 503 });
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["a 503 without retryAfter", new ApiError("The AI service is not configured on this server", 503, null)],
    ["a rate limit", new ApiError("Too many compile requests, try again in 20 s", 429, { retryAfter: 20 })],
    ["a LaTeX error", new ApiError("LaTeX compilation failed", 422, "log")],
  ])("does not retry %s", async (_label, error) => {
    const attempt = vi.fn().mockRejectedValue(error);
    await expect(retryOnceWhenBusy(attempt, () => {}, async () => {})).rejects.toBe(error);
    expect(attempt).toHaveBeenCalledOnce();
  });
});
