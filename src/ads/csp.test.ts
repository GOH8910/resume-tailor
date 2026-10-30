import { describe, expect, it } from "vitest";
import { buildCsp } from "./csp";

const NONCE = "bm9uY2UtZm9yLXRlc3Rz";

/** The policy as a map from directive name to its full text, e.g. "script-src" -> "script-src 'self' …". */
function directives(policy: string): Map<string, string> {
  return new Map(policy.split("; ").map((directive) => [directive.split(" ")[0], directive]));
}

describe("buildCsp", () => {
  it("builds the production policy for an https deployment on one line", () => {
    expect(buildCsp({ nonce: NONCE, dev: false, googleAds: false, upgradeInsecure: true })).toBe(
      [
        "default-src 'self'",
        `script-src 'self' 'nonce-${NONCE}' 'strict-dynamic'`,
        `style-src 'self' 'nonce-${NONCE}'`,
        "img-src 'self' blob: data:",
        "font-src 'self'",
        "connect-src 'self'",
        "frame-src 'self' blob:",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
        "upgrade-insecure-requests",
      ].join("; "),
    );
  });

  it("allows eval and inline styles in development", () => {
    const policy = directives(buildCsp({ nonce: NONCE, dev: true, googleAds: false, upgradeInsecure: false }));
    expect(policy.get("script-src")).toBe(`script-src 'self' 'nonce-${NONCE}' 'strict-dynamic' 'unsafe-eval'`);
    // A nonce in style-src would make browsers ignore 'unsafe-inline', so development lists none.
    expect(policy.get("style-src")).toBe("style-src 'self' 'unsafe-inline'");
    expect(policy.get("frame-ancestors")).toBe("frame-ancestors 'none'");
  });

  it("asks browsers to upgrade http requests only when told to, in production or not", () => {
    for (const dev of [false, true]) {
      const upgraded = directives(buildCsp({ nonce: NONCE, dev, googleAds: false, upgradeInsecure: true }));
      const plain = directives(buildCsp({ nonce: NONCE, dev, googleAds: false, upgradeInsecure: false }));
      expect(upgraded.has("upgrade-insecure-requests")).toBe(true);
      expect(plain.has("upgrade-insecure-requests")).toBe(false);
    }
  });

  it("adds the Google ad hosts only when Google ads are on", () => {
    const policy = directives(buildCsp({ nonce: NONCE, dev: false, googleAds: true, upgradeInsecure: true }));
    expect(policy.get("script-src")).toBe(
      `script-src 'self' 'nonce-${NONCE}' 'strict-dynamic' https://securepubads.g.doubleclick.net ` +
        "https://pagead2.googlesyndication.com https://fundingchoicesmessages.google.com https://www.googletagservices.com",
    );
    expect(policy.get("frame-src")).toBe(
      "frame-src 'self' blob: https://*.doubleclick.net https://*.googlesyndication.com https://fundingchoicesmessages.google.com",
    );
    const network = "https://*.doubleclick.net https://*.googlesyndication.com https://fundingchoicesmessages.google.com";
    expect(policy.get("img-src")).toBe(`img-src 'self' blob: data: ${network}`);
    expect(policy.get("connect-src")).toBe(`connect-src 'self' ${network}`);
    // Everything else is the same as without ads.
    const withoutAds = directives(buildCsp({ nonce: NONCE, dev: false, googleAds: false, upgradeInsecure: true }));
    for (const name of ["default-src", "style-src", "font-src", "object-src", "base-uri", "form-action", "frame-ancestors"]) {
      expect(policy.get(name)).toBe(withoutAds.get(name));
    }
  });

  it("keeps the Google hosts in development too, after 'unsafe-eval'", () => {
    const policy = directives(buildCsp({ nonce: NONCE, dev: true, googleAds: true, upgradeInsecure: false }));
    expect(policy.get("script-src")).toMatch(/^script-src 'self' 'nonce-\S+' 'strict-dynamic' 'unsafe-eval' https:\/\/securepubads/);
    expect(policy.get("frame-src")).toContain("https://*.doubleclick.net");
  });

  it.each([
    { dev: false, googleAds: false },
    { dev: true, googleAds: false },
    { dev: false, googleAds: true },
    { dev: true, googleAds: true },
  ])("never allows inline scripts, and carries the nonce ($dev, $googleAds)", ({ dev, googleAds }) => {
    const policy = buildCsp({ nonce: NONCE, dev, googleAds, upgradeInsecure: !dev });
    const scriptSrc = directives(policy).get("script-src") ?? "";
    expect(scriptSrc).toContain(`'nonce-${NONCE}'`);
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(policy).not.toMatch(/[\n\r]/);
  });

  it("puts a different nonce in each policy it builds", () => {
    const a = buildCsp({ nonce: "YWFh", dev: false, googleAds: false, upgradeInsecure: true });
    const b = buildCsp({ nonce: "YmJi", dev: false, googleAds: false, upgradeInsecure: true });
    expect(a).toContain("'nonce-YWFh'");
    expect(b).toContain("'nonce-YmJi'");
    expect(b).not.toContain("YWFh");
  });
});
