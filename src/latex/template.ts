import { readFile } from "node:fs/promises";
import path from "node:path";

export function templatePath(): string {
  return process.env.RESUME_TEMPLATE ?? path.join(process.cwd(), "templates", "resume.tex");
}

export async function loadTemplate(): Promise<string> {
  // The path is computed at runtime (env override), so Turbopack would otherwise trace the whole project.
  return readFile(/*turbopackIgnore: true*/ templatePath(), "utf8");
}
