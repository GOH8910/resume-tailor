import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";
import { buildCsp } from "@/ads/csp";
import { env } from "@/lib/env";

const PUBLIC = [
  /^\/signin(\/|$)/,
  /^\/api\/auth\//,
  /^\/api\/health$/,
  /^\/privacy$/,
  /^\/terms$/,
  // The ad network's server-to-server reward callback; its signature is checked in the route.
  /^\/api\/ads\/ssv$/,
];

function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (origin === null) return true; // top-level navigations and non-browser clients send none
  try {
    return new URL(origin).host === request.headers.get("host");
  } catch {
    return false;
  }
}

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp({
    nonce,
    dev: env.NODE_ENV === "development",
    googleAds: env.adProvider === "google",
    // Hosted production requires an https BETTER_AUTH_URL (env.ts); an http one is local, where upgrading breaks every request.
    upgradeInsecure: env.BETTER_AUTH_URL.startsWith("https://"),
  });
  const response = route(request, nonce, csp);
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

function route(request: NextRequest, nonce: string, csp: string): NextResponse {
  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith("/api/");
  // CSRF: a browser request from another site carries its Origin, and is refused.
  // OAuth callbacks are GET navigations (no Origin); a provider using response_mode=form_post (e.g. Apple) would need an exemption.
  if (isApi && !sameOrigin(request)) {
    return NextResponse.json({ error: "Cross-origin request refused" }, { status: 403 });
  }
  if (PUBLIC.some((re) => re.test(pathname))) return next(request, nonce, csp);
  // Optimistic check only (a cookie can be forged); requireUser and the (app) layout verify for real.
  if (!getSessionCookie(request)) {
    if (isApi) return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });
    const signin = new URL("/signin", request.url);
    signin.searchParams.set("next", pathname + request.nextUrl.search);
    return NextResponse.redirect(signin);
  }
  return next(request, nonce, csp);
}

// Next reads the nonce from the request's policy and puts it on its own scripts; x-nonce is for our server components.
// Both replace anything the client sent under those names.
function next(request: NextRequest, nonce: string, csp: string): NextResponse {
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  return NextResponse.next({ request: { headers } });
}

// Pages skip static files (anything with an extension); every API path runs, dotted or not, so the CSRF check holds.
export const config = { matcher: ["/api/:path*", "/((?!_next/|favicon\\.ico|.*\\.[a-z0-9]+$).*)"] };
