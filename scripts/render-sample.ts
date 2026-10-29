/**
 * Renders public/sample-resume.png, the landing page's sample: every entry of data/example/bank.json through the real
 * template (as "Start from full bank" would), page 1 converted to PNG at 110 dpi. Commit the PNG; if its size in
 * pixels changes, update SAMPLE_RESUME in src/ui/landing/sample.ts (its test compares the two).
 *   npx tsx scripts/render-sample.ts
 * Needs latexmk on PATH (MacTeX or TeX Live; LATEXMK_PATH overrides) and pdftoppm (brew install poppler).
 */
import { execFileSync } from "node:child_process";
import { copyFile, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fullStateFromBank, resolveResume } from "@/applications/resume-state";
import { BankSchema } from "@/bank/schema";
import { buildTex } from "@/latex/build";
import { compileTex } from "@/latex/compile";
import { loadTemplate } from "@/latex/template";

const BANK = path.resolve("data/example/bank.json");
const OUTPUT = path.resolve("public/sample-resume.png");
const DPI = "110";

async function main(): Promise<void> {
  const bank = BankSchema.parse(JSON.parse(await readFile(BANK, "utf8")));
  const tex = buildTex(resolveResume(bank, fullStateFromBank(bank)), await loadTemplate());
  const result = await compileTex(tex);
  if (!result.ok) throw new Error(`${result.message}\n${result.log.slice(-2000)}`);
  // The landing page promises a one-page resume.
  if (result.pages !== 1) throw new Error(`The sample compiled to ${result.pages} pages, not 1`);
  const dir = await mkdtemp(path.join(os.tmpdir(), "sample-resume-"));
  try {
    const pdf = path.join(dir, "sample.pdf");
    await writeFile(pdf, result.pdf);
    // -singlefile writes <prefix>.png, without a page-number suffix.
    execFileSync("pdftoppm", ["-png", "-r", DPI, "-f", "1", "-l", "1", "-singlefile", pdf, path.join(dir, "sample")]);
    await copyFile(path.join(dir, "sample.png"), OUTPUT);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  const png = await readFile(OUTPUT);
  // A PNG's IHDR chunk holds the width and height as big-endian integers at bytes 16 and 20.
  const [width, height] = [png.readUInt32BE(16), png.readUInt32BE(20)];
  console.log(`Wrote ${OUTPUT}: ${width}x${height} px, ${Math.round((await stat(OUTPUT)).size / 1024)} KB`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
