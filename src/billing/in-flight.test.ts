import { describe, expect, it } from "vitest";
import { createInFlightCap } from "./in-flight";

describe("createInFlightCap", () => {
  it("gives out up to `max` slots, then refuses with a 503 that says when to retry", () => {
    const cap = createInFlightCap(2);
    cap.claim();
    cap.claim();
    expect(() => cap.claim()).toThrow(expect.objectContaining({ status: 503, message: "The free AI is busy, try again in a moment", details: { retryAfter: 5 } }));
    expect(cap.running()).toBe(2);
  });

  it("frees a slot when it is released, once however often the release is called", () => {
    const cap = createInFlightCap(1);
    const release = cap.claim();
    release();
    release();
    expect(cap.running()).toBe(0);
    cap.claim();
    expect(() => cap.claim()).toThrow(expect.objectContaining({ status: 503 }));
  });
});
