import { describe, expect, it } from "vitest";
import { plainText, splitLinks } from "./inline-links";

describe("splitLinks", () => {
  it("returns plain text as one part", () => {
    expect(splitLinks("No links here.")).toEqual([{ text: "No links here." }]);
  });

  it("splits out links to a path, an https URL and an email address", () => {
    expect(splitLinks("See [Cookies](/cookies), [the ICO](https://ico.org.uk) or [me](mailto:a@example.com).")).toEqual([
      { text: "See " },
      { text: "Cookies", href: "/cookies" },
      { text: ", " },
      { text: "the ICO", href: "https://ico.org.uk" },
      { text: " or " },
      { text: "me", href: "mailto:a@example.com" },
      { text: "." },
    ]);
  });

  it("handles a link at the very start and end", () => {
    expect(splitLinks("[a](/a)[b](/b)")).toEqual([
      { text: "a", href: "/a" },
      { text: "b", href: "/b" },
    ]);
  });

  it.each(["javascript:alert(1)", "http://example.com", "//evil.example", "cookies"])("refuses a link to %s", (href) => {
    expect(() => splitLinks(`[x](${href})`)).toThrow("Refusing the link");
  });

  it("leaves brackets that are not a link alone", () => {
    expect(splitLinks("a [note] (aside)")).toEqual([{ text: "a [note] (aside)" }]);
  });
});

describe("plainText", () => {
  it("keeps the labels and drops the addresses", () => {
    expect(plainText("Write to [me](mailto:a@example.com) today.")).toBe("Write to me today.");
  });
});
