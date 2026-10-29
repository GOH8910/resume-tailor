import { describe, expect, it } from "vitest";
import { creditsSource, heroFunding } from "./copy";

describe("heroFunding", () => {
  it("says an ad pays for the AI when ads can be watched", () => {
    expect(heroFunding({ selfHosted: false, adsAvailable: true })).toBe(
      "It’s free: watching an ad pays for the AI. It’s open source, so you can also run it yourself.",
    );
  });

  it("promises no ad that cannot be watched yet", () => {
    const text = heroFunding({ selfHosted: false, adsAvailable: false });
    expect(text).toBe("It’s free, and it will be paid for by ads. It’s open source, so you can also run it yourself.");
    expect(text).not.toContain("watching an ad");
  });

  it("mentions no ads on a self-hosted server", () => {
    expect(heroFunding({ selfHosted: true, adsAvailable: false })).toBe("It’s free and open source, so you can also run it yourself.");
  });
});

describe("creditsSource", () => {
  it("says credits come from watching ads when ads can be watched", () => {
    expect(creditsSource({ adsAvailable: true, signupGrantCredits: 4 })).toBe(
      "The AI costs credits, and you earn them by watching short ads: one ad is worth about one credit.",
    );
  });

  it("says ads are still to come, and what new accounts start with", () => {
    expect(creditsSource({ adsAvailable: false, signupGrantCredits: 4 })).toBe(
      "The AI costs credits. Credits will come from short ads once they’re switched on; new accounts start with 4 credits.",
    );
    expect(creditsSource({ adsAvailable: false, signupGrantCredits: 1 })).toContain("new accounts start with 1 credit.");
  });

  it("leaves out the starting credits when there are none", () => {
    expect(creditsSource({ adsAvailable: false, signupGrantCredits: 0 })).toBe(
      "The AI costs credits. Credits will come from short ads once they’re switched on.",
    );
  });
});
