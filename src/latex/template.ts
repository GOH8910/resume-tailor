import { readFile } from "node:fs/promises";
import path from "node:path";

export function templatePath(): string {
  return process.env.RESUME_TEMPLATE ?? path.join(process.cwd(), "templates", "resume.tex");
}

export async function loadTemplate(): Promise<string> {
  return readFile(templatePath(), "utf8");
}
