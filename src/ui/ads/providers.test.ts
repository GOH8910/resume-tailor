import { describe, expect, it, vi } from "vitest";
import type { AdClientConfig } from "@/ads/provider";
import { providerFor } from "./providers";

const config = (provider: AdClientConfig["provider"]): AdClientConfig => ({ provider, ssv: false, minWatchSeconds: 1 });

describe("providerFor", () => {
  it("offers no ad when the server has no ad network", () => {
    expect(providerFor(config("none"))).toBeNull();
  });

  it("shows the test ad for the test provider", () => {
    expect(providerFor(config("test"))).toBeTypeOf("function");
  });

  it("reports that Google ads are not available yet, without granting or closing", () => {
    const show = providerFor(config("google"));
    const events = { sessionId: "s1", onGranted: vi.fn(), onClosed: vi.fn(), onError: vi.fn() };

    const remove = show?.(events);

    expect(events.onError).toHaveBeenCalledWith("Google ads are not wired up yet");
    expect(events.onGranted).not.toHaveBeenCalled();
    expect(events.onClosed).not.toHaveBeenCalled();
    expect(remove).toBeTypeOf("function");
  });
});
