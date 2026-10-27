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
  throw new ApiError(message, res.status, details);
}

export const api = {
  get<T>(url: string): Promise<T> {
    return fetch(url).then((res) => parseResponse<T>(res));
  },
  send<T>(url: string, method: "POST" | "PUT" | "DELETE", body?: unknown): Promise<T> {
    return fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then((res) => parseResponse<T>(res));
  },
};

/** Appends ?profile=<slug> to an API path, encoding the slug and keeping any existing query. */
export function withProfile(path: string, profile: string): string {
  const url = new URL(path, "http://localhost");
  url.searchParams.set("profile", profile);
  return `${url.pathname}${url.search}`;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong";
}

export type CompiledPdf = { blob: Blob; pages: number };

/** Compiles the resume state to a PDF. Throws ApiError (details = LaTeX log) on failure. */
export async function compilePdf(profile: string, resume: ResumeState, applicationId?: string): Promise<CompiledPdf> {
  const res = await fetch("/api/compile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profile, resume, applicationId }),
  });
  if (!res.ok) await parseResponse<never>(res);
  const pages = Number.parseInt(res.headers.get("X-Page-Count") ?? "", 10);
  return { blob: await res.blob(), pages: Number.isNaN(pages) ? 0 : pages };
}
