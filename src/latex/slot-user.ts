import type { TexIdentity } from "./compile";

/**
 * Each compile slot runs TeX as its own user, so a compile cannot reach another slot's folder even if LaTeX
 * escaping ever failed. With the prefix `tex`, slot 0 is user `tex1` with group `texrun1`, slot 1 is `tex2` with
 * `texrun2`, and so on; the server is in every group, each user only in its own (see the Dockerfile).
 * Without a prefix TeX runs as the server's own user.
 */
const userName = (prefix: string, slot: number) => `${prefix}${slot + 1}`;
const groupName = (prefix: string, slot: number) => `${prefix}run${slot + 1}`;

export function slotUser(prefix: string | undefined, slot: number): string | undefined {
  return prefix ? userName(prefix, slot) : undefined;
}

/** The group a slot's compile folder is handed to: only that slot's user and the server are in it. */
export function slotGroup(prefix: string | undefined, slot: number): string | undefined {
  return prefix ? groupName(prefix, slot) : undefined;
}

/** The compileTex options for a slot: its user and group, or neither without a prefix. */
export function slotIdentity(prefix: string | undefined, slot: number): TexIdentity | { runAs?: undefined; group?: undefined } {
  return prefix ? { runAs: userName(prefix, slot), group: groupName(prefix, slot) } : {};
}
