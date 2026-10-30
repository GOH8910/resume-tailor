/** Postgres' SQLSTATE for a row that names a missing parent, e.g. a user deleted in the meantime. */
export const FOREIGN_KEY_VIOLATION = "23503";

/** The SQLSTATE of a database error: drizzle wraps the driver's error, which carries it, as `cause`. */
export function pgErrorCode(err: unknown): string | undefined {
  let current: unknown = err;
  for (let depth = 0; depth < 3 && typeof current === "object" && current !== null; depth++) {
    const { code, cause } = current as { code?: unknown; cause?: unknown };
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = cause;
  }
  return undefined;
}
