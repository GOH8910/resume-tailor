import { isAPIError } from "better-auth/api";
import { beforeEach, describe, expect, it, vi } from "vitest";

const banks = vi.hoisted(() => ({ createEmpty: vi.fn() }));
const plans = vi.hoisted(() => ({ ensure: vi.fn() }));
const credits = vi.hoisted(() => ({ grantSignup: vi.fn() }));
vi.mock("./deps", () => ({ banks, plans, credits }));
vi.mock("./env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./env")>();
  return { ...actual, env: { ...actual.env, adminEmails: new Set(["ed@example.com"]), SIGNUP_GRANT_CREDITS: 4 } };
});

import { checkMagicLinkAllowed, checkSignupAllowed, onUserCreated } from "./auth";

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

describe("onUserCreated", () => {
  beforeEach(() => vi.resetAllMocks());

  it("gives a new account an empty bank named after it and the free plan", async () => {
    await onUserCreated({ id: "u1", email: "ada@example.com", name: "Ada" });
    expect(banks.createEmpty).toHaveBeenCalledWith("u1", "Ada");
    expect(plans.ensure).toHaveBeenCalledWith("u1", "free");
  });

  it("grants the starting credits once the plan exists", async () => {
    await onUserCreated({ id: "u1", email: "ada@example.com", name: "Ada" });
    expect(credits.grantSignup).toHaveBeenCalledExactlyOnceWith("u1", 4);
    expect(plans.ensure.mock.invocationCallOrder[0]).toBeLessThan(credits.grantSignup.mock.invocationCallOrder[0]);
  });

  it("gives an admin address the unlimited plan, ignoring case", async () => {
    await onUserCreated({ id: "u2", email: "Ed@Example.com", name: "Ed" });
    expect(plans.ensure).toHaveBeenCalledWith("u2", "unlimited");
  });
});
