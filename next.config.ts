import type { NextConfig } from "next";

// The Content-Security-Policy needs a fresh nonce per request, so src/proxy.ts sends it, not this file.
const securityHeaders = [
  // Production only (`next build` and `next start`), so local http development is never pinned to https.
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
    : []),
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  // A self-contained server for the Docker image. It does not trace templates/ or drizzle/: the Dockerfile copies them.
  output: "standalone",
  // Next allows one `next dev` per build folder; the e2e servers set their own so they can run beside each other.
  // Production builds always use .next: the Dockerfile copies .next/standalone and .next/static from there.
  distDir: process.env.NODE_ENV === "production" ? ".next" : process.env.NEXT_DIST_DIR || ".next",
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
