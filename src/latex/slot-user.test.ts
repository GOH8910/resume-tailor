import { describe, expect, it } from "vitest";
import { slotGroup, slotIdentity, slotUser } from "./slot-user";

describe("slotUser", () => {
  it("numbers the users from 1 after the prefix", () => {
    expect(slotUser("tex", 0)).toBe("tex1");
    expect(slotUser("tex", 1)).toBe("tex2");
  });

  it("is undefined without a prefix: TeX runs as the server's own user", () => {
    expect(slotUser(undefined, 0)).toBeUndefined();
  });
});

describe("slotGroup", () => {
  it("names the slot's own group", () => {
    expect(slotGroup("tex", 0)).toBe("texrun1");
    expect(slotGroup("tex", 1)).toBe("texrun2");
  });

  it("is undefined without a prefix", () => {
    expect(slotGroup(undefined, 1)).toBeUndefined();
  });
});

describe("slotIdentity", () => {
  it("gives compileTex the slot's user and group", () => {
    expect(slotIdentity("tex", 1)).toEqual({ runAs: "tex2", group: "texrun2" });
  });

  it("is empty without a prefix", () => {
    expect(slotIdentity(undefined, 0)).toEqual({});
  });
});
