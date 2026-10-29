import type { ResumeState } from "@/applications/schema";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// Set while this tab signs out or deletes its account: requests still in flight then come back 401, and their
// redirect to /signin?next=… would race the page's own navigation away.
let signingOut = false;

/** Tells the client this tab is ending its session, so a 401 no longer sends the browser to sign in. */
export function setSigningOut(value: boolean): void {
  signingOut = value;
}

/** An expired or revoked session: send the browser to sign in, then back to this page. */
function redirectToSignIn(): void {
  if (typeof window === "undefined") return;
  const here = window.location.pathname + window.location.search;
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a full load drops the signed-out state
  window.location.assign(`/signin?next=${encodeURIComponent(here)}`);
}

async function parseResponse<T>(res: Response): Promise<T> {
  if (res.ok) {
    if (res.status === 204 || res.headers.get("content-length") === "0") return undefined as T;
    return (await res.json()) as T;
  }
  let message = `${res.status} ${res.statusText}`;
  let details: unknown;
  try {
    const body = (await res.json()) as { error?: unknown; details?: unknown; log?: unknown };
    if (typeof body.error === "string") message = body.error;
    details = body.details ?? body.log;
  } catch {
    // Non-JSON error body: keep the status text.
  }
  // Only the data routes' session check answers 401, so it always means "signed out".
  if (res.status === 401 && !signingOut) redirectToSignIn();
  throw new ApiError(message, res.status, details);
}

export const api = {
  get<T>(url: string): Promise<T> {
    return fetch(url).then((res) => parseResponse<T>(res));
  },
  /** A file the server sends (a download); an error answer throws like any other call's. */
  async blob(url: string): Promise<Blob> {
    const res = await fetch(url);
    if (!res.ok) await parseResponse<never>(res);
    return res.blob();
  },
  send<T>(url: string, method: "POST" | "PUT" | "DELETE", body?: unknown): Promise<T> {
    return fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then((res) => parseResponse<T>(res));
  },
};

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong";
}

/** The seconds a 429 (rate limit) or 503 (server busy) asks the client to wait, from details.retryAfter, or null. */
export function retryAfterOf(err: unknown): number | null {
  if (!(err instanceof ApiError) || (err.status !== 429 && err.status !== 503)) return null;
  const value = (err.details as { retryAfter?: unknown } | null | undefined)?.retryAfter;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.ceil(value) : null;
}

export type CompiledPdf = { blob: Blob; pages: number };

/** Compiles the resume state to a PDF. Throws ApiError (details = LaTeX log) on failure. */
export async function compilePdf(resume: ResumeState, applicationId?: string): Promise<CompiledPdf> {
  const res = await fetch("/api/compile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ resume, applicationId }),
  });
  if (!res.ok) await parseResponse<never>(res);
  const pages = Number.parseInt(res.headers.get("X-Page-Count") ?? "", 10);
  return { blob: await res.blob(), pages: Number.isNaN(pages) ? 0 : pages };
}
