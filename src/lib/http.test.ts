import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "./errors";
import { handle } from "./http";

afterEach(() => vi.restoreAllMocks());

describe("handle", () => {
  it("answers an unexpected error with a generic 500 that leaks nothing", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = new Error("Failed query: insert into banks ... params: secret");
    const res = await handle(async () => {
      throw err;
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "Something went wrong" });
    expect(JSON.stringify(body)).not.toContain("secret");
    expect(log).toHaveBeenCalledWith(err);
  });

  it("logs the underlying cause of a wrapped error", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const cause = new Error("connect ECONNREFUSED");
    await handle(async () => {
      throw new Error("Failed query: select 1", { cause });
    });
    expect(log).toHaveBeenCalledWith(cause);
  });

  it("passes an AppError's message and status through", async () => {
    const res = await handle(async () => {
      throw new AppError("Application not found", 404);
    });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Application not found");
  });
});
