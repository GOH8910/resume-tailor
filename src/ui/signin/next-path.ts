/**
 * Where to go after signing in: a path on this site, else the dashboard. "//host" and "/\host" are rejected
 * because browsers read both as a link to another host.
 */
export function safeNextPath(next: string | string[] | undefined): string {
  if (typeof next !== "string" || !next.startsWith("/")) return "/";
  return next.startsWith("//") || next.startsWith("/\\") ? "/" : next;
}
