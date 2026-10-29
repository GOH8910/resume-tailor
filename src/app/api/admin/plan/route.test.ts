import { beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.hoisted(() => vi.fn());
const plans = vi.hoisted(() => ({ get: vi.fn(), setPlan: vi.fn() }));
const findUserIdByEmail = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth", () => ({ getAuth: () => ({ api: { getSession } }) }));
vi.mock("@/lib/deps", () => ({ plans }));
vi.mock("@/db/users", () => ({ findUserIdByEmail }));
vi.mock("@/lib/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/env")>();
  return { ...actual, env: actual.parseEnv({ APP_MODE: "hosted", ADMIN_EMAILS: "ops@example.com" }) };
});

import { POST } from "./route";

const as = (email: string) => ({ user: { id: "u_ops", email, name: "Ed" }, session: { id: "s1" } });

function postAs(session: unknown, body: unknown) {
  getSession.mockResolvedValueOnce(session);
  return POST(new Request("http://localhost/api/admin/plan", { method: "POST", body: JSON.stringify(body) }));
}

beforeEach(() => {
  vi.resetAllMocks();
  plans.get.mockResolvedValue({ plan: "unlimited", credits: 0 });
});

describe("POST /api/admin/plan", () => {
  it("answers 404 to an account that is not an admin, and changes nothing", async () => {
    expect((await postAs(as("ada@example.com"), { email: "ada@example.com", plan: "unlimited" })).status).toBe(404);
    expect(findUserIdByEmail).not.toHaveBeenCalled();
    expect(plans.setPlan).not.toHaveBeenCalled();
  });

  it("sets an existing account's plan, looked up by its email", async () => {
    findUserIdByEmail.mockResolvedValueOnce("u_ada");

    const res = await postAs(as("ops@example.com"), { email: " Ada@Example.com ", plan: "unlimited" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ email: "ada@example.com", plan: "unlimited" });
    expect(findUserIdByEmail).toHaveBeenCalledWith("ada@example.com");
    expect(plans.setPlan).toHaveBeenCalledExactlyOnceWith("u_ada", "unlimited");
  });

  it("answers 404 when no account uses the email", async () => {
    findUserIdByEmail.mockResolvedValueOnce(null);

    const res = await postAs(as("ops@example.com"), { email: "nobody@example.com", plan: "free" });

    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("No account uses that email");
    expect(plans.setPlan).not.toHaveBeenCalled();
  });

  it("refuses an unknown plan or a malformed email with a 400", async () => {
    expect((await postAs(as("ops@example.com"), { email: "ada@example.com", plan: "gold" })).status).toBe(400);
    expect((await postAs(as("ops@example.com"), { email: "not an email", plan: "free" })).status).toBe(400);
    expect(findUserIdByEmail).not.toHaveBeenCalled();
  });
});
