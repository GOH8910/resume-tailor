import { createPublicKey, type KeyObject, verify } from "node:crypto";
import { z } from "zod";

// Server-side verification (SSV) of a rewarded ad: the ad network calls us with the reward in the query string,
// followed by `signature` (ECDSA P-256 over SHA-256 of the rest of the query, base64url DER) and `key_id` (which
// of its published keys signed it). The parameter names and the keys URL follow Google's AdMob SSV documentation;
// confirm both against Ad Manager's web rewarded-ad SSV documentation in phase 2b.

export type SsvKey = { keyId: string; pem: string };
export type SsvResult = { ok: true; params: URLSearchParams } | { ok: false; reason: string };

const SIGNATURE_PARAMS = new Set(["signature", "key_id"]);
const KEYS_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;

/** Checks a callback URL's signature against the network's published keys. */
export function verifySsv(url: URL, keys: SsvKey[]): SsvResult {
  const query = url.search.replace(/^\?/, "");
  const params = new URLSearchParams(query);
  const signature = params.get("signature");
  const keyId = params.get("key_id");
  if (!signature || !keyId) return { ok: false, reason: "missing signature or key_id" };
  const key = keys.find((candidate) => candidate.keyId === keyId);
  if (!key) return { ok: false, reason: `unknown key_id ${keyId}` };
  const publicKey = p256Key(key.pem);
  if (!publicKey) return { ok: false, reason: `key ${keyId} is not an ECDSA P-256 key` };
  // The signed message is the raw query as received, minus the signature parameters, in its original order.
  const message = query
    .split("&")
    .filter((pair) => !SIGNATURE_PARAMS.has(pair.split("=")[0]))
    .join("&");
  return verifies(message, publicKey, signature) ? { ok: true, params } : { ok: false, reason: "bad signature" };
}

function p256Key(pem: string): KeyObject | undefined {
  try {
    const key = createPublicKey(pem);
    return key.asymmetricKeyType === "ec" && key.asymmetricKeyDetails?.namedCurve === "prime256v1" ? key : undefined;
  } catch {
    return undefined;
  }
}

function verifies(message: string, key: KeyObject, signature: string): boolean {
  try {
    return verify("sha256", Buffer.from(message), key, Buffer.from(signature, "base64url"));
  } catch {
    return false; // a signature that is not valid DER
  }
}

const KeysSchema = z.object({
  keys: z.array(z.object({ keyId: z.union([z.number(), z.string()]).transform(String), pem: z.string() })),
});

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** A key loader that keeps the network's published keys for 24 hours; a failed load is retried on the next call. */
export function createSsvKeyFetcher(fetchImpl: Fetch = (url, init) => fetch(url, init), ttlMs = KEYS_TTL_MS) {
  let cached: { url: string; expiresAt: number; keys: Promise<SsvKey[]> } | undefined;

  async function load(url: string): Promise<SsvKey[]> {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`Could not fetch the SSV keys from ${url}: HTTP ${res.status}`);
    const parsed = KeysSchema.safeParse(await res.json());
    // A plain Error, not the ZodError, so handle() answers 500 (the network retries) rather than a client 400.
    if (!parsed.success) throw new Error(`${url} is not a valid SSV keys document: ${parsed.error.message}`);
    return parsed.data.keys;
  }

  return function fetchSsvKeys(url: string, now = Date.now()): Promise<SsvKey[]> {
    if (cached?.url === url && now < cached.expiresAt) return cached.keys;
    const entry = { url, expiresAt: now + ttlMs, keys: load(url) };
    cached = entry;
    entry.keys.catch(() => {
      if (cached === entry) cached = undefined;
    });
    return entry.keys;
  };
}

export const fetchSsvKeys = createSsvKeyFetcher();
