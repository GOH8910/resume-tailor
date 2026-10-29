// Mirrors Better Auth's isSafeRelativeURL (not exported), which vets callbackURL: a `next` that passes here is
// one Better Auth also accepts, and none of them can point the browser at another host.
const ENCODED_SEPARATOR = /%2f|%5c/i;
const PARSE_ORIGIN = "http://x";

function hasControlCharacter(value: string): boolean {
  return [...value].some((char) => {
    const code = char.charCodeAt(0);
    return code < 0x20 || (code >= 0x7f && code <= 0x9f);
  });
}

function isSafeRelativePath(value: string): boolean {
  if (!value.startsWith("/") || value.startsWith("//")) return false;
  // Browsers read "\" as "/" and drop tabs and newlines, so "/\host" and "/\t/host" become "//host".
  if (value.includes("\\") || hasControlCharacter(value)) return false;
  const path = value.split(/[?#]/, 1)[0];
  if (ENCODED_SEPARATOR.test(path)) return false;
  try {
    return new URL(value, PARSE_ORIGIN).origin === PARSE_ORIGIN;
  } catch {
    return false;
  }
}

/** Where to go after signing in: a path on this site, else the dashboard. */
export function safeNextPath(next: string | string[] | undefined): string {
  return typeof next === "string" && isSafeRelativePath(next) ? next : "/dashboard";
}
