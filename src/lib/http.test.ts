import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AppError } from "./errors";
import { clientIp, handle, ipKey, isAdminEmail, MAX_BODY_BYTES, readJson, requireAdmin, requireUser } from "./http";

// The real instance opens the database; these tests only need getSession.
const getSession = vi.hoisted(() => vi.fn());
const plans = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("./auth", () => ({ getAuth: () => ({ api: { getSession } }) }));
vi.mock("./deps", () => ({ plans }));
vi.mock("./env", () => ({ env: { adminEmails: new Set(["ed@example.com"]) } }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

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

  it("sets Retry-After from details.retryAfter, so 429s and 503s say when to come back", async () => {
    const res = await handle(async () => {
      throw new AppError("Too many tailor requests, try again in 7 s", 429, { retryAfter: 7 });
    });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("7");
    expect(await res.json()).toEqual({ error: "Too many tailor requests, try again in 7 s", details: { retryAfter: 7 } });
  });

  it("answers a validation error with its first issue, prefixed by the field's path, and every issue in details", async () => {
    const schema = z.object({ experience: z.array(z.object({ text: z.string().max(3, "A bullet can be at most 3 characters") })), company: z.string() });
    const res = await handle(async () => {
      schema.parse({ experience: [{ text: "ok" }, { text: "too long" }] });
      return new Response();
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("experience.1.text: A bullet can be at most 3 characters");
    expect(body.details).toHaveLength(2);
  });

  it("answers a validation error on the whole body with the bare message", async () => {
    const res = await handle(async () => {
      z.array(z.string()).max(1, "At most one").parse(["a", "b"]);
      return new Response();
    });
    expect((await res.json()).error).toBe("At most one");
  });

  it("sets no Retry-After without a numeric details.retryAfter", async () => {
    const res = await handle(async () => {
      throw new AppError("Not enough credits", 402, { credits: 0, needed: 2 });
    });
    expect(res.headers.get("Retry-After")).toBeNull();
  });
});

describe("readJson", () => {
  const post = (body: BodyInit, headers: Record<string, string> = {}) =>
    new Request("http://localhost/api/bank", { method: "PUT", body, headers });

  it("parses a JSON body", async () => {
    expect(await readJson(post(JSON.stringify({ a: 1 })))).toEqual({ a: 1 });
  });

  it("ignores a leading byte-order mark, like request.json()", async () => {
    expect(await readJson(post("\uFEFF" + JSON.stringify({ a: 1 })))).toEqual({ a: 1 });
  });

  it("answers 400 for an empty or malformed body", async () => {
    await expect(readJson(post(""))).rejects.toMatchObject({ status: 400, message: "Request body must be valid JSON" });
    await expect(readJson(post("{"))).rejects.toMatchObject({ status: 400 });
  });

  it("accepts a body of exactly the limit", async () => {
    const body = JSON.stringify("x".repeat(98));
    expect(body.length).toBe(100);
    expect(await readJson(post(body), 100)).toBe("x".repeat(98));
  });

  it("refuses a declared content-length over the limit with a 413, before reading", async () => {
    const req = post("{}", { "content-length": String(MAX_BODY_BYTES + 1) });
    await expect(readJson(req)).rejects.toMatchObject({ status: 413, message: "Request body too large" });
    expect(req.bodyUsed).toBe(false);
  });

  it("counts the bytes it reads rather than trusting the header", async () => {
    const body = JSON.stringify("x".repeat(99));
    await expect(readJson(post(body), 100)).rejects.toMatchObject({ status: 413 });
    await expect(readJson(post(body, { "content-length": "2" }), 100)).rejects.toMatchObject({ status: 413 });
  });

  it("counts bytes, not characters", async () => {
    // 50 two-byte characters plus the quotes: 52 characters, 102 bytes.
    await expect(readJson(post(JSON.stringify("é".repeat(50))), 100)).rejects.toMatchObject({ status: 413 });
  });

  it("reads a streamed body in chunks and stops at the limit", async () => {
    const chunk = new TextEncoder().encode("[" + "1,".repeat(40));
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        controller.enqueue(chunk);
      },
    });
    const req = new Request("http://localhost/api/bank", { method: "PUT", body: stream, duplex: "half" } as RequestInit);
    await expect(readJson(req, 200)).rejects.toMatchObject({ status: 413 });
    expect(pulled).toBeLessThan(10);
  });
});

describe("requireUser", () => {
  const request = () => new Request("http://localhost/api/bank", { headers: { cookie: "session=abc" } });

  const session = (email: string) => ({
    user: { id: "u1", email, name: "Ada", image: null },
    session: { id: "s1" },
  });

  it("rejects a request without a session with a 401, reading no plan", async () => {
    getSession.mockResolvedValueOnce(null);
    await expect(requireUser(request())).rejects.toMatchObject({ status: 401, message: "Sign in to continue" });
    expect(plans.get).not.toHaveBeenCalled();
  });

  it("returns the signed-in user and their plan, passing the request headers to Better Auth", async () => {
    getSession.mockResolvedValueOnce(session("ada@example.com"));
    plans.get.mockResolvedValueOnce({ plan: "unlimited", credits: 4 });
    const req = request();
    await expect(requireUser(req)).resolves.toEqual({ id: "u1", email: "ada@example.com", name: "Ada", plan: "unlimited" });
    expect(getSession).toHaveBeenLastCalledWith({ headers: req.headers });
  });

  it("creates a missing plan as free for an ordinary account", async () => {
    getSession.mockResolvedValueOnce(session("ada@example.com"));
    plans.get.mockResolvedValueOnce({ plan: "free", credits: 0 });
    await requireUser(request());
    expect(plans.get).toHaveBeenLastCalledWith("u1", "free");
  });

  it("creates a missing plan as unlimited for an admin account", async () => {
    getSession.mockResolvedValueOnce(session("Ed@Example.com"));
    plans.get.mockResolvedValueOnce({ plan: "unlimited", credits: 0 });
    await requireUser(request());
    expect(plans.get).toHaveBeenLastCalledWith("u1", "unlimited");
  });
});

describe("requireAdmin", () => {
  const request = () => new Request("http://localhost/api/admin/summary", { headers: { cookie: "session=abc" } });
  const signedInAs = (email: string, plan: "free" | "unlimited") => {
    getSession.mockResolvedValueOnce({ user: { id: "u1", email, name: "Ed", image: null }, session: { id: "s1" } });
    plans.get.mockResolvedValueOnce({ plan, credits: 0 });
  };

  it("lets in an account listed in ADMIN_EMAILS, ignoring case and plan", async () => {
    signedInAs("Ed@Example.com", "free");
    await expect(requireAdmin(request())).resolves.toMatchObject({ id: "u1", email: "Ed@Example.com" });
  });

  it("answers any other signed-in account with a 404, so the admin pages are not advertised", async () => {
    signedInAs("ada@example.com", "unlimited");
    await expect(requireAdmin(request())).rejects.toMatchObject({ status: 404, message: "Not found" });
  });

  it("answers a signed-out request with the usual 401", async () => {
    getSession.mockResolvedValueOnce(null);
    await expect(requireAdmin(request())).rejects.toMatchObject({ status: 401 });
  });
});

describe("isAdminEmail", () => {
  it("matches ADMIN_EMAILS without regard to case", () => {
    expect(isAdminEmail("ED@example.com")).toBe(true);
    expect(isAdminEmail("ed@example.org")).toBe(false);
  });
});

describe("clientIp", () => {
  const from = (headers: Record<string, string>) => clientIp(new Request("http://localhost/api/ads/start", { headers }));

  it("prefers the address Fly's proxy saw", () => {
    expect(from({ "fly-client-ip": "203.0.113.1", "x-forwarded-for": "198.51.100.7" })).toBe("203.0.113.1");
  });

  it("falls back to the first x-forwarded-for entry", () => {
    expect(from({ "x-forwarded-for": " 198.51.100.7 , 10.0.0.1" })).toBe("198.51.100.7");
  });

  it("is 'unknown' without either header", () => {
    expect(from({})).toBe("unknown");
    expect(from({ "fly-client-ip": " ", "x-forwarded-for": "" })).toBe("unknown");
  });

  it("buckets an IPv6 client by its /64, the block one subscriber usually gets", () => {
    expect(from({ "fly-client-ip": "2001:db8:1:2:aaaa::1" })).toBe("2001:db8:1:2::/64");
    expect(from({ "x-forwarded-for": "2001:db8:1:2:bbbb::2" })).toBe("2001:db8:1:2::/64");
  });
});

describe("ipKey", () => {
  it("leaves IPv4 addresses and non-addresses as they are", () => {
    expect(ipKey("203.0.113.1")).toBe("203.0.113.1");
    expect(ipKey("unknown")).toBe("unknown");
    expect(ipKey("not:an:address")).toBe("not:an:address");
  });

  it("keeps the first four hextets of an IPv6 address, normalised", () => {
    expect(ipKey("2001:db8:1:2:3:4:5:6")).toBe("2001:db8:1:2::/64");
    expect(ipKey("2001:0DB8:0001:0002:ffff::1")).toBe("2001:db8:1:2::/64");
    expect(ipKey("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(ipKey("::1")).toBe("0:0:0:0::/64");
    expect(ipKey("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
    expect(ipKey("64:ff9b::203.0.113.1")).toBe("64:ff9b:0:0::/64");
  });

  it("unwraps an IPv4-mapped IPv6 address to the IPv4 address", () => {
    expect(ipKey("::ffff:203.0.113.9")).toBe("203.0.113.9");
    expect(ipKey("::FFFF:cb00:7109")).toBe("203.0.113.9");
  });
});
