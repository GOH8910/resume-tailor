import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { claimCredit, type GrantResponse, VERIFY_POLL_MS, VERIFY_WAIT_MS } from "./claim";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const answers = (...responses: GrantResponse[]) => {
  const send = vi.fn(async (): Promise<GrantResponse> => responses[Math.min(send.mock.calls.length - 1, responses.length - 1)]);
  return send;
};

describe("claimCredit", () => {
  it("returns the balance from a direct grant without polling", async () => {
    const send = answers({ credits: 3 });
    expect(await claimCredit("s1", send)).toBe(3);
    expect(send).toHaveBeenCalledExactlyOnceWith("s1");
  });

  it("polls once a second until the network's callback grants", async () => {
    const send = answers({ credits: 0, status: "started" }, { credits: 0, status: "started" }, { credits: 1, status: "granted" });
    const claimed = claimCredit("s1", send);
    await vi.advanceTimersByTimeAsync(VERIFY_POLL_MS);
    expect(send).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(VERIFY_POLL_MS);
    expect(await claimed).toBe(1);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("stops when the network rejects the ad", async () => {
    const send = answers({ credits: 0, status: "started" }, { credits: 0, status: "rejected" });
    const claimed = claimCredit("s1", send);
    const failed = expect(claimed).rejects.toThrow("did not confirm this ad");
    await vi.advanceTimersByTimeAsync(VERIFY_POLL_MS);
    await failed;
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("gives up after 20 seconds without a confirmation", async () => {
    const send = answers({ credits: 0, status: "started" });
    const claimed = claimCredit("s1", send);
    const failed = expect(claimed).rejects.toThrow("has not confirmed this ad yet");
    await vi.advanceTimersByTimeAsync(VERIFY_WAIT_MS + VERIFY_POLL_MS);
    await failed;
    // One ask at the start and one a second for 20 seconds, then no more.
    expect(send).toHaveBeenCalledTimes(VERIFY_WAIT_MS / VERIFY_POLL_MS + 1);
    await vi.advanceTimersByTimeAsync(5 * VERIFY_POLL_MS);
    expect(send).toHaveBeenCalledTimes(VERIFY_WAIT_MS / VERIFY_POLL_MS + 1);
  });
});
