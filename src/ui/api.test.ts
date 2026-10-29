import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, retryAfterOf, setSigningOut } from "./api";

function respond(status: number, body: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(body, { status })));
}

afterEach(() => {
  vi.unstubAllGlobals();
  setSigningOut(false);
});

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

  it("leaves the page alone on a 401 while signing out, which navigates on its own", async () => {
    const assign = vi.fn();
    vi.stubGlobal("window", { location: { pathname: "/tailor/abc", search: "", assign } });
    respond(401, { error: "Sign in to continue" });

    setSigningOut(true);
    await expect(api.get("/api/bank")).rejects.toMatchObject({ status: 401 });
    expect(assign).not.toHaveBeenCalled();

    // A sign-out that failed hands the redirect back.
    setSigningOut(false);
    await expect(api.get("/api/bank")).rejects.toMatchObject({ status: 401 });
    expect(assign).toHaveBeenCalledOnce();
  });

  it("throws on a 401 without a window (server rendering)", async () => {
    respond(401, { error: "Sign in to continue" });
    await expect(api.get("/api/bank")).rejects.toMatchObject({ status: 401 });
  });
});

describe("api.blob", () => {
  it("answers a file the server sends", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"bank":{}}', { headers: { "Content-Type": "application/json" } })));
    const blob = await api.blob("/api/account/export");
    expect(await blob.text()).toBe('{"bank":{}}');
  });

  it("throws the server's error, with its details, instead of a file", async () => {
    respond(429, { error: "Too many data export requests, try again in 600 s", details: { retryAfter: 600 } });
    await expect(api.blob("/api/account/export")).rejects.toMatchObject({ status: 429, details: { retryAfter: 600 } });
  });
});

describe("retryAfterOf", () => {
  it("reads details.retryAfter from a 429 or a 503", () => {
    expect(retryAfterOf(new ApiError("Too many tailor requests", 429, { retryAfter: 360 }))).toBe(360);
    expect(retryAfterOf(new ApiError("Server busy", 503, { retryAfter: 10 }))).toBe(10);
    expect(retryAfterOf(new ApiError("Server busy", 503, { retryAfter: 2.2 }))).toBe(3);
  });

  it("is null for anything else", () => {
    expect(retryAfterOf(new ApiError("The AI service is not configured on this server", 503, null))).toBeNull();
    expect(retryAfterOf(new ApiError("Daily ad limit", 429, { reason: "account", resetsAt: "x" }))).toBeNull();
    expect(retryAfterOf(new ApiError("Not enough credits", 402, { retryAfter: 5 }))).toBeNull();
    expect(retryAfterOf(new ApiError("Too many", 429, { retryAfter: "5" }))).toBeNull();
    expect(retryAfterOf(new Error("network"))).toBeNull();
  });
});
