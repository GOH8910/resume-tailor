import { beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.hoisted(() => vi.fn());
const plans = vi.hoisted(() => ({ get: vi.fn() }));
const usage = vi.hoisted(() => ({ setFreePaused: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAuth: () => ({ api: { getSession } }) }));
vi.mock("@/lib/deps", () => ({ plans, usage }));
vi.mock("@/lib/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/env")>();
  return { ...actual, env: actual.parseEnv({ APP_MODE: "hosted", ADMIN_EMAILS: "ops@example.com" }) };
});

import { POST } from "./route";

const as = (email: string) => ({ user: { id: "u1", email, name: "Ed" }, session: { id: "s1" } });

function postAs(session: unknown, body: unknown) {
  getSession.mockResolvedValueOnce(session);
  return POST(new Request("http://localhost/api/admin/pause", { method: "POST", body: JSON.stringify(body) }));
}

beforeEach(() => {
  vi.resetAllMocks();
  plans.get.mockResolvedValue({ plan: "free", credits: 0 });
});

describe("POST /api/admin/pause", () => {
  it("answers 404 to an account that is not an admin, and changes nothing", async () => {
    expect((await postAs(as("ada@example.com"), { paused: true })).status).toBe(404);
    expect((await postAs(null, { paused: true })).status).toBe(401);
    expect(usage.setFreePaused).not.toHaveBeenCalled();
  });

  it("pauses and resumes free usage for an admin", async () => {
    const paused = await postAs(as("ops@example.com"), { paused: true });
    expect(paused.status).toBe(200);
    expect(await paused.json()).toEqual({ paused: true });
    expect(usage.setFreePaused).toHaveBeenLastCalledWith(true);

    await postAs(as("ops@example.com"), { paused: false });
    expect(usage.setFreePaused).toHaveBeenLastCalledWith(false);
  });

  it("refuses anything but a boolean with a 400", async () => {
    expect((await postAs(as("ops@example.com"), { paused: "yes" })).status).toBe(400);
    expect((await postAs(as("ops@example.com"), {})).status).toBe(400);
    expect(usage.setFreePaused).not.toHaveBeenCalled();
  });
});
