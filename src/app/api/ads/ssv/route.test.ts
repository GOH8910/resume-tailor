import { generateKeyPairSync, sign } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const credits = vi.hoisted(() => ({ grantVerifiedAd: vi.fn() }));
const fetchSsvKeys = vi.hoisted(() => vi.fn());
const env = vi.hoisted(() => ({}) as Record<string, unknown>);
vi.mock("@/lib/auth", () => ({ getAuth: () => ({}) }));
vi.mock("@/lib/deps", () => ({ credits }));
vi.mock("@/lib/env", async (importOriginal) => ({ ...(await importOriginal<object>()), env }));
vi.mock("@/ads/ssv", async (importOriginal) => ({ ...(await importOriginal<object>()), fetchSsvKeys }));

import { parseEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { GET, POST } from "./route";

const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const KEYS = [{ keyId: "1", pem: publicKey.export({ type: "spki", format: "pem" }).toString() }];
const SESSION_ID = "7d3c0d0e-1b2a-4c5d-8e9f-0a1b2c3d4e5f";
const KEYS_URL = "https://keys.example/verifier-keys.json";

function callbackUrl(query: string, signed = query): string {
  const signature = sign("sha256", Buffer.from(signed), privateKey).toString("base64url");
  return `http://localhost/api/ads/ssv?${query}&signature=${signature}&key_id=1`;
}
const REWARD = `ad_unit=1234&custom_data=${SESSION_ID}&reward_amount=1&reward_item=credit&timestamp=1793300000000&transaction_id=tx-1`;

function useEnv(source: Record<string, string>) {
  for (const key of Object.keys(env)) delete env[key];
  Object.assign(env, parseEnv(source));
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.resetAllMocks();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  fetchSsvKeys.mockResolvedValue(KEYS);
  credits.grantVerifiedAd.mockResolvedValue({ userId: "u1", credits: 1 });
  useEnv({ APP_MODE: "hosted", AD_PROVIDER: "test", AD_SSV_ENABLED: "true", AD_SSV_KEYS_URL: KEYS_URL });
});
afterEach(() => vi.restoreAllMocks());

describe("/api/ads/ssv", () => {
  it("answers 503 and verifies nothing while server-side verification is off", async () => {
    useEnv({ APP_MODE: "hosted", AD_PROVIDER: "test" });
    expect((await GET(new Request(callbackUrl(REWARD)))).status).toBe(503);
    expect(fetchSsvKeys).not.toHaveBeenCalled();
    expect(credits.grantVerifiedAd).not.toHaveBeenCalled();
  });

  it.each([["GET", GET], ["POST", POST]])("grants the session named in a signed %s callback, with its transaction id", async (method, handler) => {
    const res = await handler(new Request(callbackUrl(REWARD), { method }));
    expect(res.status).toBe(200);
    expect(fetchSsvKeys).toHaveBeenCalledWith(KEYS_URL);
    expect(credits.grantVerifiedAd).toHaveBeenCalledExactlyOnceWith({ sessionId: SESSION_ID, transactionId: "tx-1" });
  });

  it("answers 200 but grants nothing for a bad signature, and logs it", async () => {
    const forged = callbackUrl(REWARD.replace("reward_amount=1", "reward_amount=9"), REWARD);
    expect((await GET(new Request(forged))).status).toBe(200);
    expect(credits.grantVerifiedAd).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("bad signature"));
  });

  it("answers 200 but grants nothing for a signed callback without our session id", async () => {
    expect((await GET(new Request(callbackUrl("ad_unit=1234&transaction_id=tx-1")))).status).toBe(200);
    expect(credits.grantVerifiedAd).not.toHaveBeenCalled();
  });

  it("answers 200 to a replayed or refused grant, and logs it", async () => {
    credits.grantVerifiedAd.mockRejectedValue(new AppError("Ad session is not pending", 409));
    expect((await GET(new Request(callbackUrl(REWARD)))).status).toBe(200);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Ad session is not pending"));
  });

  it("answers 200 to a reward whose transaction id another session already used, and logs it", async () => {
    const duplicate = Object.assign(new Error("duplicate key value"), { code: "23505", constraint: "ad_sessions_transaction_id_unique" });
    credits.grantVerifiedAd.mockRejectedValue(new Error("Failed query: update ad_sessions", { cause: duplicate }));
    expect((await GET(new Request(callbackUrl(REWARD)))).status).toBe(200);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("ignored: transaction_id already used"));
  });

  it("answers 500 to any other database failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const other = Object.assign(new Error("duplicate key value"), { code: "23505", constraint: "credit_events_pkey" });
    credits.grantVerifiedAd.mockRejectedValue(new Error("Failed query: insert into credit_events", { cause: other }));
    expect((await GET(new Request(callbackUrl(REWARD)))).status).toBe(500);
  });

  it("answers 500 when it could not check the callback, so the network can retry", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    fetchSsvKeys.mockRejectedValue(new Error("keys unreachable"));
    expect((await GET(new Request(callbackUrl(REWARD)))).status).toBe(500);
    expect(credits.grantVerifiedAd).not.toHaveBeenCalled();
  });
});
