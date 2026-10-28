import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "./api";

function respond(status: number, body: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(body, { status })));
}

afterEach(() => vi.unstubAllGlobals());

describe("api", () => {
  it("sends the browser to sign in on a 401, remembering the page, and still throws", async () => {
    const assign = vi.fn();
    vi.stubGlobal("window", { location: { pathname: "/tailor/abc", search: "?x=1", assign } });
    respond(401, { error: "Sign in to continue" });

    await expect(api.get("/api/bank")).rejects.toMatchObject({ status: 401, message: "Sign in to continue" });
    expect(assign).toHaveBeenCalledWith("/signin?next=%2Ftailor%2Fabc%3Fx%3D1");
  });

  it("leaves other errors to the caller", async () => {
    const assign = vi.fn();
    vi.stubGlobal("window", { location: { pathname: "/", search: "", assign } });
    respond(404, { error: "Application not found" });

    await expect(api.send("/api/applications/x", "DELETE")).rejects.toBeInstanceOf(ApiError);
    expect(assign).not.toHaveBeenCalled();
  });

  it("throws on a 401 without a window (server rendering)", async () => {
    respond(401, { error: "Sign in to continue" });
    await expect(api.get("/api/bank")).rejects.toMatchObject({ status: 401 });
  });
});
