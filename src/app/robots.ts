import type { MetadataRoute } from "next";

// Every other page redirects a crawler to /signin, which asks not to be indexed.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: ["/", "/privacy", "/terms", "/cookies"], disallow: ["/api/"] },
  };
}
