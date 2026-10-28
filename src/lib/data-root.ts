import path from "node:path";

export function dataRoot(): string {
  return process.env.RESUME_DATA_DIR ?? path.join(process.cwd(), "data");
}
