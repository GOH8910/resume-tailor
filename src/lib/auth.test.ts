import { isAPIError } from "better-auth/api";
import { describe, expect, it, vi } from "vitest";
import { checkMagicLinkAllowed, checkSignupAllowed } from "./auth";

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

describe("checkMagicLinkAllowed", () => {
  const invited = new Set(["ada@example.com"]);

  it("lets anyone request a link when no allowlist is configured, without a lookup", async () => {
    const hasAccount = vi.fn();
    await expect(checkMagicLinkAllowed("anyone@example.com", new Set(), hasAccount)).resolves.toBeUndefined();
    expect(hasAccount).not.toHaveBeenCalled();
  });

  it("lets an invited address request a link", async () => {
    await expect(checkMagicLinkAllowed("Ada@Example.com", invited, async () => false)).resolves.toBeUndefined();
  });

  it("refuses an uninvited address without an account before any link is sent", async () => {
    await expect(checkMagicLinkAllowed("mallory@example.com", invited, async () => false)).rejects.toMatchObject({
      statusCode: 403,
      body: expect.objectContaining({ code: "SIGNUP_INVITE_ONLY" }),
    });
  });

  it("keeps sending links to an existing account the allowlist no longer names", async () => {
    const hasAccount = vi.fn(async () => true);
    await expect(checkMagicLinkAllowed("grace@example.com", invited, hasAccount)).resolves.toBeUndefined();
    expect(hasAccount).toHaveBeenCalledWith("grace@example.com");
  });
});
