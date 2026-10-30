import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { groupId, parseGroupId } from "./group-id";

const GROUP_FILE = [
  "# comment",
  "root:x:0:",
  "node:x:1000:",
  "",
  "texrun10:x:1110:node,tex10",
  "texrun1:x:1101:node,tex1",
  "texrun2:x:1102:node,tex2",
  "broken:x:notanumber:",
].join("\n");

describe("parseGroupId", () => {
  it("finds a group's id by its exact name", () => {
    expect(parseGroupId(GROUP_FILE, "texrun1")).toBe(1101);
    expect(parseGroupId(GROUP_FILE, "texrun10")).toBe(1110);
    expect(parseGroupId(GROUP_FILE, "root")).toBe(0);
  });

  it("is undefined for a missing group or a malformed line", () => {
    expect(parseGroupId(GROUP_FILE, "texrun3")).toBeUndefined();
    expect(parseGroupId(GROUP_FILE, "texrun")).toBeUndefined();
    expect(parseGroupId(GROUP_FILE, "broken")).toBeUndefined();
  });
});

describe("groupId", () => {
  let dir: string;
  let file: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "group-id-"));
    file = path.join(dir, "group");
    await writeFile(file, GROUP_FILE);
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it("reads the id from the group file, then from its cache", async () => {
    expect(await groupId("texrun2", file)).toBe(1102);
    await writeFile(file, "texrun2:x:9999:\n");
    expect(await groupId("texrun2", file)).toBe(1102);
    await writeFile(file, GROUP_FILE);
  });

  it("throws a clear error for a group that does not exist", async () => {
    await expect(groupId("texrun9", file)).rejects.toThrow(`Group "texrun9" not found in ${file}`);
  });
});
