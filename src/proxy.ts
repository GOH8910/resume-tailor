import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

const PUBLIC = [/^\/signin(\/|$)/, /^\/api\/auth\//, /^\/api\/health$/, /^\/privacy$/, /^\/terms$/];

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
  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith("/api/");
  // CSRF: a browser request from another site carries its Origin, and is refused.
  if (isApi && !sameOrigin(request)) {
    return NextResponse.json({ error: "Cross-origin request refused" }, { status: 403 });
  }
  if (PUBLIC.some((re) => re.test(pathname))) return NextResponse.next();
  // Optimistic check only (a cookie can be forged); requireUser and the (app) layout verify for real.
  if (!getSessionCookie(request)) {
    if (isApi) return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });
    const signin = new URL("/signin", request.url);
    signin.searchParams.set("next", pathname + request.nextUrl.search);
    return NextResponse.redirect(signin);
  }
  return NextResponse.next();
}

// Pages skip static files (anything with an extension); every API path runs, dotted or not, so the CSRF check holds.
export const config = { matcher: ["/api/:path*", "/((?!_next/|favicon\\.ico|.*\\.[a-z0-9]+$).*)"] };
