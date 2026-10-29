import { describe, expect, it } from "vitest";
import { chooseModel, policyFor, signupPlan } from "./plan";

const settings = { freeModel: "claude-haiku-5-5", unlimitedModel: "claude-sonnet-5-5" };

describe("policyFor", () => {
  it("charges free accounts credits, shows them ads and runs them on the free model in hosted mode", () => {
    expect(policyFor("free", "hosted", settings)).toEqual({
      model: "claude-haiku-5-5",
      picksModel: false,
      chargesCredits: true,
      showsAds: true,
      limited: true,
    });
  });

  it("gives unlimited accounts the unlimited model without credits or ads, but still limits them, in hosted mode", () => {
    expect(policyFor("unlimited", "hosted", settings)).toEqual({
      model: "claude-sonnet-5-5",
      picksModel: true,
      chargesCredits: false,
      showsAds: false,
      limited: true,
    });
  });

  it.each(["free", "unlimited"] as const)("treats a %s account in selfhost mode as unrestricted", (plan) => {
    expect(policyFor(plan, "selfhost", settings)).toEqual({
      model: "claude-sonnet-5-5",
      picksModel: true,
      chargesCredits: false,
      showsAds: false,
      limited: false,
    });
  });
});

describe("chooseModel", () => {
  const free = policyFor("free", "hosted", settings);
  const unlimited = policyFor("unlimited", "hosted", settings);
  const selfhost = policyFor("free", "selfhost", settings);

  it("ignores a requested model for an account that does not pick its model", () => {
    expect(chooseModel(free, "claude-opus-5-5")).toBe("claude-haiku-5-5");
  });

  it("decides from picksModel alone, not from whether credits are charged", () => {
    expect(chooseModel({ ...free, picksModel: true }, "claude-opus-5-5")).toBe("claude-opus-5-5");
    expect(chooseModel({ ...unlimited, picksModel: false }, "claude-opus-5-5")).toBe("claude-sonnet-5-5");
  });

  it("honours a requested model for unlimited and self-hosted accounts", () => {
    expect(chooseModel(unlimited, "claude-opus-5-5")).toBe("claude-opus-5-5");
    expect(chooseModel(selfhost, "claude-haiku-5-5")).toBe("claude-haiku-5-5");
  });

  it("falls back to the plan's model when none is requested", () => {
    expect(chooseModel(free, undefined)).toBe("claude-haiku-5-5");
    expect(chooseModel(unlimited, undefined)).toBe("claude-sonnet-5-5");
  });
});

describe("signupPlan", () => {
  const admins = new Set(["ed@example.com"]);

  it("gives an admin address the unlimited plan, ignoring case", () => {
    expect(signupPlan("Ed@Example.com", admins)).toBe("unlimited");
  });

  it("gives everyone else the free plan", () => {
    expect(signupPlan("ada@example.com", admins)).toBe("free");
    expect(signupPlan("ed@example.com", new Set())).toBe("free");
  });
});
