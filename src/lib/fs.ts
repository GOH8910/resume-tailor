import { access, mkdir, open, rename, rm } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";

export function isEnoent(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "ENOENT";
}

export async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch (err) {
    if (isEnoent(err)) return false;
    throw err;
  }
}

/** Write JSON to a temp file in the same directory, then rename over the target. */
export async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    const handle = await open(tmp, "w");
    try {
      await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tmp, file);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}
