import { describe, expect, it } from "vitest";
import { CREDIT_KINDS } from "@/credits/types";
import { ledgerLabel, signedCredits } from "./ledger";

describe("ledgerLabel", () => {
  it("names every kind of ledger row in words", () => {
    expect(CREDIT_KINDS.map(ledgerLabel)).toEqual(["Ad watched", "Welcome credits", "Tailor", "Chat message", "Adjustment", "Refund"]);
  });

  it("shows a kind it does not know as it is", () => {
    expect(ledgerLabel("bonus")).toBe("bonus");
  });
});

describe("signedCredits", () => {
  it("signs earned and spent credits, with a true minus sign", () => {
    expect(signedCredits(1)).toBe("+1");
    expect(signedCredits(-2)).toBe("−2");
    expect(signedCredits(0)).toBe("0");
  });
});
