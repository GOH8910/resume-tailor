import { readFile } from "node:fs/promises";

const GROUP_FILE = "/etc/group";
// Group ids do not change while the server runs; only found ids are kept, so a fixed image is picked up on retry.
const cache = new Map<string, number>();

/** The id of the group called `name` in a group(5) file, or undefined. */
export function parseGroupId(contents: string, name: string): number | undefined {
  for (const line of contents.split("\n")) {
    const [group, , id] = line.split(":");
    if (group !== name || id === undefined) continue;
    const gid = Number(id);
    return Number.isInteger(gid) && gid >= 0 ? gid : undefined;
  }
  return undefined;
}

/**
 * The id of a local group, read from /etc/group (the container's users and groups live there; there is no
 * directory service to ask). Throws when the group does not exist.
 */
export async function groupId(name: string, file = GROUP_FILE): Promise<number> {
  const key = `${file}\0${name}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const gid = parseGroupId(await readFile(file, "utf8"), name);
  if (gid === undefined) throw new Error(`Group "${name}" not found in ${file}`);
  cache.set(key, gid);
  return gid;
}
