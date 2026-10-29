import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RewardedAdEvents, ShowRewardedAd } from "@/ads/provider";
import { DID_NOT_LOAD, LOAD_TIMEOUT_MS, playAd } from "./play-ad";

/** A provider that hands its callbacks to the test, so the test decides what the ad does and when. */
function fakeProvider(onShow?: (events: RewardedAdEvents) => void) {
  const remove = vi.fn();
  let events: RewardedAdEvents | undefined;
  const show: ShowRewardedAd = (e) => {
    events = e;
    onShow?.(e);
    return remove;
  };
  return { show, remove, events: () => events as RewardedAdEvents };
}

const settledState = async <T>(promise: Promise<T>) => {
  const marker = Symbol("pending");
  return Promise.race([promise, Promise.resolve(marker)]).then((value) => (value === marker ? "pending" : value));
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("playAd", () => {
  it("gives up with 'did not load' when the ad never shows, taking it down", async () => {
    const provider = fakeProvider();
    const removeRef = { current: null as (() => void) | null };
    const outcome = playAd(provider.show, "s1", removeRef);
    expect(provider.events().sessionId).toBe("s1");
    expect(removeRef.current).toBeTypeOf("function");

    await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS - 1);
    expect(await settledState(outcome)).toBe("pending");
    await vi.advanceTimersByTimeAsync(1);

    expect(await outcome).toEqual({ kind: "error", message: DID_NOT_LOAD });
    expect(provider.remove).toHaveBeenCalledOnce();
    expect(removeRef.current).toBeNull();
  });

  it("waits as long as the ad plays once it is on screen, then settles on its grant", async () => {
    const provider = fakeProvider();
    const removeRef = { current: null as (() => void) | null };
    const outcome = playAd(provider.show, "s1", removeRef);

    provider.events().onShown?.();
    await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS * 4);
    expect(await settledState(outcome)).toBe("pending");
    provider.events().onGranted();

    expect(await outcome).toEqual({ kind: "granted" });
    expect(provider.remove).toHaveBeenCalledOnce();
    expect(removeRef.current).toBeNull();
  });

  it("settles on an error the provider reports before show returns, and still takes the ad down", async () => {
    const provider = fakeProvider((events) => events.onError("Ad blocked"));
    const removeRef = { current: null as (() => void) | null };

    const outcome = playAd(provider.show, "s1", removeRef);

    expect(await outcome).toEqual({ kind: "error", message: "Ad blocked" });
    expect(provider.remove).toHaveBeenCalledOnce();
    expect(removeRef.current).toBeNull();
    // The load timeout was cleared: nothing fires later.
    await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS);
    expect(provider.remove).toHaveBeenCalledOnce();
  });

  it("counts taking the ad down through removeRef as closing it, and ignores the provider afterwards", async () => {
    const provider = fakeProvider();
    const removeRef = { current: null as (() => void) | null };
    const outcome = playAd(provider.show, "s1", removeRef);
    provider.events().onShown?.();

    removeRef.current?.();
    provider.events().onGranted();

    expect(await outcome).toEqual({ kind: "closed" });
    expect(provider.remove).toHaveBeenCalledOnce();
    expect(removeRef.current).toBeNull();
  });

  it("settles on the first terminal event only", async () => {
    const provider = fakeProvider();
    const outcome = playAd(provider.show, "s1", { current: null });

    provider.events().onClosed();
    provider.events().onGranted();
    provider.events().onError("late");

    expect(await outcome).toEqual({ kind: "closed" });
    expect(provider.remove).toHaveBeenCalledOnce();
  });
});
