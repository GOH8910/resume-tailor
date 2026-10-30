import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdClientConfig } from "@/ads/provider";
import { adSlot, loadProvider } from "./providers";

const config = (provider: AdClientConfig["provider"]): AdClientConfig => ({ provider, ssv: false, minWatchSeconds: 1 });

describe("loadProvider", () => {
  it("offers no ad when the server has no ad network", async () => {
    expect(await loadProvider(config("none"))).toBeNull();
  });

  it("loads the test ad for the test provider", async () => {
    expect(await loadProvider(config("test"))).toBeTypeOf("function");
  });

  it("reports that Google ads are not available yet, without granting or closing", async () => {
    const show = await loadProvider(config("google"));
    const events = { sessionId: "s1", onShown: vi.fn(), onGranted: vi.fn(), onClosed: vi.fn(), onError: vi.fn() };

    const remove = show?.(events);

    expect(events.onError).toHaveBeenCalledExactlyOnceWith("Google ads are not wired up yet");
    expect(events.onShown).not.toHaveBeenCalled();
    expect(events.onGranted).not.toHaveBeenCalled();
    expect(events.onClosed).not.toHaveBeenCalled();
    expect(remove).toBeTypeOf("function");
  });
});

describe("adSlot", () => {
  afterEach(() => adSlot.release());

  it("lets one ad play at a time and tells its subscribers", () => {
    const listener = vi.fn();
    const unsubscribe = adSlot.subscribe(listener);

    expect(adSlot.claim()).toBe(true);
    expect(adSlot.isTaken()).toBe(true);
    expect(adSlot.claim()).toBe(false);
    adSlot.release();
    expect(adSlot.isTaken()).toBe(false);
    expect(adSlot.claim()).toBe(true);

    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
  });
});
