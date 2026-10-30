import { describe, expect, it } from "vitest";
import robots from "./robots";

describe("robots.txt", () => {
  it("lets crawlers read the public pages and keeps them out of the API", () => {
    expect(robots()).toEqual({
      rules: { userAgent: "*", allow: ["/", "/privacy", "/terms", "/cookies"], disallow: ["/api/"] },
    });
  });
});
