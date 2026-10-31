import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { config, proxy } from "./proxy";

const env = vi.hoisted(() => ({ NODE_ENV: "production", adProvider: "none", BETTER_AUTH_URL: "https://resume.example.com" }));
const PRODUCTION = { ...env };
vi.mock("@/lib/env", () => ({ env }));

const SESSION = "better-auth.session_token=abc.def";

function request(path: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, { headers: { host: "localhost:3000", ...headers } });
}

const passesThrough = (res: Response) => res.headers.get("x-middleware-next") === "1";

describe("proxy", () => {
  it.each([
    "/",
    "/?deleted=1",
    "/signin",
    "/signin?next=%2Fbank",
    "/api/auth/get-session",
    "/api/health",
    "/privacy",
    "/terms",
    "/cookies",
    "/api/ads/ssv?key_id=1",
  ])(
    "lets %s through without a session",
    (path) => {
      expect(passesThrough(proxy(request(path)))).toBe(true);
    },
  );

  it("sends a signed-out page visit to /signin, remembering where it was going", () => {
    const res = proxy(request("/bank"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/signin?next=%2Fbank");
  });

  it("keeps the query string in ?next=", () => {
    const res = proxy(request("/tailor?company=acme"));
    expect(new URL(res.headers.get("location") ?? "").searchParams.get("next")).toBe("/tailor?company=acme");
  });

  it.each(["/dashboard", "/privacy/x", "/cookies/x", "/terms-x"])("keeps %s behind sign-in: the public pages match exactly", (path) => {
    expect(proxy(request(path)).status).toBe(307);
  });

  it("keeps the other ads endpoints behind sign-in", () => {
    expect(proxy(request("/api/ads/start")).status).toBe(401);
    expect(proxy(request("/api/ads/ssv/extra")).status).toBe(401);
  });

  it("answers a signed-out API request with a 401 instead of a redirect", async () => {
    const res = proxy(request("/api/bank"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Sign in to continue" });
  });

  it("refuses an API request from another site, even with a session cookie", () => {
    const res = proxy(request("/api/bank", { origin: "https://evil.example", cookie: SESSION }));
    expect(res.status).toBe(403);
  });

  it("refuses a cross-site request to a public auth endpoint", () => {
    const res = proxy(request("/api/auth/sign-in/magic-link", { origin: "https://evil.example" }));
    expect(res.status).toBe(403);
  });

  it("refuses an API request whose Origin is not a URL", () => {
    expect(proxy(request("/api/bank", { origin: "null", cookie: SESSION })).status).toBe(403);
  });

  // OAuth and magic-link callbacks are top-level GET navigations from another site, which carry no Origin.
  it.each(["/api/auth/callback/google?code=x&state=y", "/api/auth/magic-link/verify?token=x&callbackURL=%2F"])(
    "lets the cross-site navigation to %s through",
    (path) => {
      expect(passesThrough(proxy(request(path)))).toBe(true);
    },
  );

  it("lets a request without Origin (curl, server-to-server) through the CSRF check", () => {
    const put = new NextRequest("http://localhost:3000/api/bank", { method: "PUT", headers: { host: "localhost:3000", cookie: SESSION } });
    expect(passesThrough(proxy(put))).toBe(true);
  });

  it("lets a same-origin API request with a session cookie through", () => {
    expect(passesThrough(proxy(request("/api/bank", { origin: "http://localhost:3000", cookie: SESSION })))).toBe(true);
  });

  it("accepts the __Secure- cookie name used over https", () => {
    expect(passesThrough(proxy(request("/bank", { cookie: "__Secure-better-auth.session_token=abc.def" })))).toBe(true);
  });
});

describe("proxy matcher", () => {
  it.each(["/", "/bank/experience", "/api/bank", "/api/applications/abc/pdf", "/api/applications/a.b"])("runs on %s", (url) => {
    expect(unstable_doesMiddlewareMatch({ config, url })).toBe(true);
  });

  // Static files are served without the proxy, so signed out too: the landing page's sample resume is a /_next/ one.
  it.each(["/_next/static/chunks/app.js", "/_next/static/media/sample-resume.0a1b2c3d.png", "/favicon.ico", "/robots.txt"])("skips %s", (url) => {
    expect(unstable_doesMiddlewareMatch({ config, url })).toBe(false);
  });
});

describe("proxy content security policy", () => {
  afterEach(() => Object.assign(env, PRODUCTION));

  const csp = (res: Response) => res.headers.get("content-security-policy") ?? "";
  const nonceIn = (policy: string) => /'nonce-([^']+)'/.exec(policy)?.[1];
  // NextResponse.next({ request: { headers } }) hands the rewritten request headers to Next in these.
  const forwarded = (res: Response, name: string) => res.headers.get(`x-middleware-request-${name}`);

  it("sends a policy with a fresh nonce on every page", () => {
    const first = csp(proxy(request("/signin")));
    const second = csp(proxy(request("/signin")));
    expect(first).toContain("frame-ancestors 'self'");
    expect(nonceIn(first)).toBeTruthy();
    expect(nonceIn(second)).toBeTruthy();
    expect(nonceIn(first)).not.toBe(nonceIn(second));
  });

  it("makes the nonce from a random UUID, base64-encoded", () => {
    const nonce = nonceIn(csp(proxy(request("/signin")))) ?? "";
    expect(Buffer.from(nonce, "base64").toString()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("hands Next the same policy and nonce on the request, so it can put the nonce on its scripts", () => {
    const res = proxy(request("/bank", { cookie: SESSION }));
    expect(passesThrough(res)).toBe(true);
    expect(forwarded(res, "content-security-policy")).toBe(csp(res));
    expect(forwarded(res, "x-nonce")).toBe(nonceIn(csp(res)));
  });

  it("replaces a nonce or policy the client sent", () => {
    const res = proxy(request("/signin", { "x-nonce": "chosen-by-attacker", "content-security-policy": "script-src *" }));
    expect(forwarded(res, "x-nonce")).not.toBe("chosen-by-attacker");
    expect(forwarded(res, "content-security-policy")).toBe(csp(res));
  });

  it("sends the policy on redirects and refusals too", () => {
    expect(csp(proxy(request("/bank")))).toContain("default-src 'self'");
    expect(csp(proxy(request("/api/bank")))).toContain("default-src 'self'");
    expect(csp(proxy(request("/api/bank", { origin: "https://evil.example" })))).toContain("default-src 'self'");
  });

  it("uses the production policy outside development, upgrading requests on an https deployment", () => {
    const policy = csp(proxy(request("/signin")));
    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).toContain("upgrade-insecure-requests");
    expect(policy).not.toContain("doubleclick");
  });

  it("allows eval under next dev, and does not upgrade requests on an http deployment", () => {
    Object.assign(env, { NODE_ENV: "development", BETTER_AUTH_URL: "http://localhost:3000" });
    const policy = csp(proxy(request("/signin")));
    expect(policy).toContain("'unsafe-eval'");
    expect(policy).not.toContain("upgrade-insecure-requests");
  });

  // The Docker smoke test runs a production build on http://localhost: upgrading would send its requests to https.
  it("does not upgrade requests for a production build served over http", () => {
    env.BETTER_AUTH_URL = "http://localhost:3000";
    const policy = csp(proxy(request("/signin")));
    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).not.toContain("upgrade-insecure-requests");
  });

  it("adds the Google ad hosts when the Google provider is on", () => {
    env.adProvider = "google";
    expect(csp(proxy(request("/signin")))).toContain("https://securepubads.g.doubleclick.net");
  });
});
