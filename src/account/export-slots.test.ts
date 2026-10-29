import { describe, expect, it } from "vitest";
import { createExportSlots } from "./export-slots";

describe("createExportSlots", () => {
  it("runs one export per account at a time", () => {
    const slots = createExportSlots(2);
    const release = slots.claim("ada");
    expect(() => slots.claim("ada")).toThrow(expect.objectContaining({ status: 409, message: "An export is already running" }));
    release();
    expect(() => slots.claim("ada")).not.toThrow();
  });

  it("runs at most the given number across the server, then asks to come back", () => {
    const slots = createExportSlots(2);
    slots.claim("ada");
    const releaseBob = slots.claim("bob");
    expect(() => slots.claim("carol")).toThrow(expect.objectContaining({ status: 503, details: { retryAfter: 10 } }));
    releaseBob();
    expect(() => slots.claim("carol")).not.toThrow();
  });

  it("frees a slot once however often it is released", () => {
    const slots = createExportSlots(1);
    const release = slots.claim("ada");
    release();
    const releaseBob = slots.claim("bob");
    release();
    expect(() => slots.claim("carol")).toThrow(expect.objectContaining({ status: 503 }));
    releaseBob();
  });
});
