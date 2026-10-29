import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SAMPLE_RESUME } from "./sample";

describe("SAMPLE_RESUME", () => {
  // The <img> reserves this box before the file loads; a regenerated PNG of another size would distort it.
  it("matches the size of public/sample-resume.png", async () => {
    const png = await readFile(path.resolve("public", SAMPLE_RESUME.src.slice(1)));
    // A PNG's IHDR chunk holds the width and height as big-endian integers at bytes 16 and 20.
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([SAMPLE_RESUME.width, SAMPLE_RESUME.height]);
  });
});
