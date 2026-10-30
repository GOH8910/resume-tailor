import { generateKeyPairSync, type KeyObject, sign } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { createSsvKeyFetcher, type SsvKey, verifySsv } from "./ssv";

function keyPair(namedCurve: string) {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve });
  return { privateKey, pem: publicKey.export({ type: "spki", format: "pem" }).toString() };
}

const GOOGLE = keyPair("prime256v1");
const KEYS: SsvKey[] = [{ keyId: "3335741209", pem: GOOGLE.pem }];
const QUERY = "ad_network=5450213213286189855&ad_unit=1234&custom_data=7d3c0d0e-1b2a-4c5d-8e9f-0a1b2c3d4e5f&reward_amount=1&reward_item=credit&timestamp=1793300000000&transaction_id=tx-123&user_id=";

function callback(query: string, privateKey: KeyObject = GOOGLE.privateKey, keyId = "3335741209", signed = query): URL {
  const signature = sign("sha256", Buffer.from(signed), privateKey).toString("base64url");
  return new URL(`https://app.example/api/ads/ssv?${query}&signature=${signature}&key_id=${keyId}`);
}

describe("verifySsv", () => {
  it("accepts a callback signed by a listed key and returns its parameters", () => {
    const result = verifySsv(callback(QUERY), KEYS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.params.get("custom_data")).toBe("7d3c0d0e-1b2a-4c5d-8e9f-0a1b2c3d4e5f");
    expect(result.params.get("transaction_id")).toBe("tx-123");
  });

  it("signs the query as received, wherever the signature parameters sit", () => {
    const signature = sign("sha256", Buffer.from(QUERY), GOOGLE.privateKey).toString("base64url");
    const [first, ...rest] = QUERY.split("&");
    const url = new URL(`https://app.example/api/ads/ssv?${first}&key_id=3335741209&signature=${signature}&${rest.join("&")}`);
    expect(verifySsv(url, KEYS).ok).toBe(true);
  });

  it("rejects a callback whose parameters were changed after signing", () => {
    const tampered = callback(QUERY.replace("reward_amount=1", "reward_amount=100"), GOOGLE.privateKey, "3335741209", QUERY);
    expect(verifySsv(tampered, KEYS)).toEqual({ ok: false, reason: "bad signature" });
  });

  it("rejects a callback from a key id that is not listed", () => {
    expect(verifySsv(callback(QUERY, GOOGLE.privateKey, "42"), KEYS)).toEqual({ ok: false, reason: "unknown key_id 42" });
  });

  it("rejects a signature made by another P-256 key", () => {
    expect(verifySsv(callback(QUERY, keyPair("prime256v1").privateKey), KEYS)).toEqual({ ok: false, reason: "bad signature" });
  });

  it("rejects a listed key on the wrong curve, even when the signature matches it", () => {
    const p384 = keyPair("secp384r1");
    const result = verifySsv(callback(QUERY, p384.privateKey, "7"), [{ keyId: "7", pem: p384.pem }]);
    expect(result).toEqual({ ok: false, reason: "key 7 is not an ECDSA P-256 key" });
  });

  it("rejects a callback without a signature or key id, or with a garbled signature, without throwing", () => {
    expect(verifySsv(new URL(`https://app.example/api/ads/ssv?${QUERY}`), KEYS)).toEqual({
      ok: false,
      reason: "missing signature or key_id",
    });
    const garbled = new URL(`https://app.example/api/ads/ssv?${QUERY}&signature=not-a-signature&key_id=3335741209`);
    expect(verifySsv(garbled, KEYS)).toEqual({ ok: false, reason: "bad signature" });
  });
});

describe("createSsvKeyFetcher", () => {
  const URL_A = "https://keys.example/verifier-keys.json";
  const body = { keys: [{ keyId: 3335741209, pem: GOOGLE.pem, base64: "ignored" }] };
  const answering = (status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

  it("reads the published keys, with numeric key ids as strings", async () => {
    const fetchKeys = createSsvKeyFetcher(answering());
    expect(await fetchKeys(URL_A, 0)).toEqual([{ keyId: "3335741209", pem: GOOGLE.pem }]);
  });

  it("caches the keys for 24 hours", async () => {
    const fetch = answering();
    const fetchKeys = createSsvKeyFetcher(fetch);
    await fetchKeys(URL_A, 0);
    await fetchKeys(URL_A, 24 * 3_600_000 - 1);
    expect(fetch).toHaveBeenCalledOnce();
    await fetchKeys(URL_A, 24 * 3_600_000);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  // A ZodError would reach the client as a 400; this is our failure, so it must be a 500 the network retries.
  it("fails with a plain error when the keys document has the wrong shape", async () => {
    const fetchKeys = createSsvKeyFetcher(vi.fn(async () => new Response(JSON.stringify({ keys: [{ keyId: 1 }] }))));
    const err = await fetchKeys(URL_A, 0).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(ZodError);
    expect((err as Error).message).toContain("not a valid SSV keys document");
  });

  it("does not cache a failed fetch", async () => {
    const fetch = answering(503);
    const fetchKeys = createSsvKeyFetcher(fetch);
    await expect(fetchKeys(URL_A, 0)).rejects.toThrow("HTTP 503");
    fetch.mockImplementation(async () => new Response(JSON.stringify(body)));
    await expect(fetchKeys(URL_A, 1)).resolves.toHaveLength(1);
  });
});
