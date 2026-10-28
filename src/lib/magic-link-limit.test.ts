import { isAPIError } from "better-auth/api";
import { describe, expect, it } from "vitest";
import { checkMagicLinkLimit } from "./magic-link-limit";

const HOUR = 60 * 60 * 1000;

function sendFive(email: string, at: number) {
  for (let i = 0; i < 5; i++) checkMagicLinkLimit(email, at + i);
}

describe("checkMagicLinkLimit", () => {
  it("allows five links per address per hour, then answers 429", () => {
    sendFive("ada@example.com", 0);
    let error: unknown;
    try {
      checkMagicLinkLimit("ada@example.com", 10);
    } catch (err) {
      error = err;
    }
    expect(isAPIError(error)).toBe(true);
    expect(error).toMatchObject({ statusCode: 429, message: expect.stringContaining("Too many sign-in links") });
  });

  it("counts addresses case-insensitively", () => {
    sendFive("bob@example.com", 0);
    expect(() => checkMagicLinkLimit("BOB@example.com", 10)).toThrow();
  });

  it("counts each address separately", () => {
    sendFive("cy@example.com", 0);
    expect(() => checkMagicLinkLimit("dee@example.com", 10)).not.toThrow();
  });

  it("allows links again once the hour has passed", () => {
    sendFive("eve@example.com", 0);
    expect(() => checkMagicLinkLimit("eve@example.com", HOUR + 1)).not.toThrow();
  });
});
