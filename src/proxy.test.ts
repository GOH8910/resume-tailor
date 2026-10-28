import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { config, proxy } from "./proxy";

const SESSION = "better-auth.session_token=abc.def";

function request(path: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, { headers: { host: "localhost:3000", ...headers } });
}

const passesThrough = (res: Response) => res.headers.get("x-middleware-next") === "1";

describe("proxy", () => {
  it.each(["/signin", "/signin?next=%2Fbank", "/api/auth/get-session", "/api/health", "/privacy", "/terms"])(
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

  it.each(["/_next/static/chunks/app.js", "/favicon.ico", "/robots.txt"])("skips %s", (url) => {
    expect(unstable_doesMiddlewareMatch({ config, url })).toBe(false);
  });
});
