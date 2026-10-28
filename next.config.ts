import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A self-contained server for the Docker image. It does not trace templates/ or drizzle/: the Dockerfile copies them.
  output: "standalone",
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
