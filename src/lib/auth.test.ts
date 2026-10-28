import { isAPIError } from "better-auth/api";
import { describe, expect, it } from "vitest";
import { checkSignupAllowed } from "./auth";

describe("checkSignupAllowed", () => {
  it("lets anyone sign up when no allowlist is configured", () => {
    expect(() => checkSignupAllowed("anyone@example.com", new Set())).not.toThrow();
  });

  it("lets an invited address sign up, ignoring case", () => {
    expect(() => checkSignupAllowed("Ada@Example.com", new Set(["ada@example.com"]))).not.toThrow();
  });

  it("refuses an address that is not on the allowlist with a 403", () => {
    let error: unknown;
    try {
      checkSignupAllowed("mallory@example.com", new Set(["ada@example.com"]));
    } catch (err) {
      error = err;
    }
    expect(isAPIError(error)).toBe(true);
    expect(error).toMatchObject({ statusCode: 403, message: "Sign-ups are invite-only right now" });
  });
});
