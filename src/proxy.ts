import { type NextRequest, NextResponse } from "next/server";

// Any website open in the browser can send simple cross-site POSTs to localhost, and a DNS-rebinding page
// reaches us under its own hostname. So the API only answers requests addressed to this machine by name,
// and, when a browser says where the request came from, only requests from this app's own origin.
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

function hostOf(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export function proxy(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  const target = hostOf(`http://${host}`);
  if (!target || !LOCAL_HOSTNAMES.has(target.hostname)) {
    return NextResponse.json({ error: `Requests to host "${host}" are not allowed` }, { status: 403 });
  }
  // Browsers send Origin on every cross-origin request and on same-origin POST/PUT/DELETE; curl sends none.
  const origin = request.headers.get("origin");
  if (origin !== null && hostOf(origin)?.host !== target.host) {
    return NextResponse.json({ error: `Cross-origin request from "${origin}" refused` }, { status: 403 });
  }
  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
