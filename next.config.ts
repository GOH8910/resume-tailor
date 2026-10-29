import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A self-contained server for the Docker image. It does not trace templates/ or drizzle/: the Dockerfile copies them.
  output: "standalone",
  // Next allows one `next dev` per build folder; the e2e servers set their own so they can run beside each other.
  // Production builds always use .next: the Dockerfile copies .next/standalone and .next/static from there.
  distDir: process.env.NODE_ENV === "production" ? ".next" : process.env.NEXT_DIST_DIR || ".next",
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
