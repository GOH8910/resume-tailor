// The Content-Security-Policy the proxy sends with every response (src/proxy.ts), and the one list of Google ad
// hosts it allows when the Google ad provider is on.

// Only browsers without 'strict-dynamic' (CSP2) read these: elsewhere the nonce decides which scripts run, and the
// Google tag is inserted by our own nonce'd code, which 'strict-dynamic' trusts.
const GOOGLE_SCRIPT_HOSTS = [
  "https://securepubads.g.doubleclick.net",
  "https://pagead2.googlesyndication.com",
  "https://fundingchoicesmessages.google.com",
  "https://www.googletagservices.com",
];
// The ad and consent iframes.
const GOOGLE_FRAME_HOSTS = [
  "https://*.doubleclick.net",
  "https://*.googlesyndication.com",
  "https://fundingchoicesmessages.google.com",
];
// What the Google tag fetches and pings from our page (images, beacons, ad requests).
const GOOGLE_NETWORK_HOSTS = [
  "https://*.doubleclick.net",
  "https://*.googlesyndication.com",
  "https://fundingchoicesmessages.google.com",
];

type Options = {
  /** Fresh for every request. */
  nonce: string;
  /** `next dev`: React needs eval for its debugging aids, and the dev overlay injects <style> elements. */
  dev: boolean;
  /** The Google ad provider is on (hosted mode with AD_PROVIDER=google). */
  googleAds: boolean;
};

/** The policy as one header line, directives joined with "; ". */
export function buildCsp({ nonce, dev, googleAds }: Options): string {
  const google = (hosts: string[]) => (googleAds ? hosts : []);
  const directives: string[][] = [
    ["default-src", "'self'"],
    ["script-src", "'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(dev ? ["'unsafe-eval'"] : []), ...google(GOOGLE_SCRIPT_HOSTS)],
    // Production: a walk through every page under `next build && next start` found no inline <style> or style=""
    // markup once Next's default 404 page was replaced (src/app/not-found.tsx); Tailwind is a stylesheet, and the
    // styles React sets from script (the test ad's progress bar) go through the CSS object model, which style-src
    // does not govern. Development keeps 'unsafe-inline' and no nonce: the dev overlay adds <style> elements without
    // one, and listing a nonce would make browsers ignore 'unsafe-inline'.
    ["style-src", "'self'", ...(dev ? ["'unsafe-inline'"] : [`'nonce-${nonce}'`])],
    ["img-src", "'self'", "blob:", "data:", ...google(GOOGLE_NETWORK_HOSTS)],
    ["font-src", "'self'"],
    ["connect-src", "'self'", ...google(GOOGLE_NETWORK_HOSTS)],
    // The PDF preview is an <iframe src="blob:…">.
    ["frame-src", "'self'", "blob:", ...google(GOOGLE_FRAME_HOSTS)],
    ["object-src", "'none'"],
    ["base-uri", "'self'"],
    ["form-action", "'self'"],
    ["frame-ancestors", "'none'"],
    ...(dev ? [] : [["upgrade-insecure-requests"]]),
  ];
  return directives.map((parts) => parts.join(" ")).join("; ");
}
