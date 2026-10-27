import { newId } from "@/bank/ids";
import { AppError } from "@/lib/errors";

export const APPLICATION_ID = /^[a-z0-9][a-z0-9-]{0,79}$/;

export function slugify(text: string, max = 30): string {
  const slug = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/, "");
  return slug || "application";
}

export function newApplicationId(company: string, now: Date = new Date()): string {
  // Local date, so the id matches the day the dashboard shows.
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const date = `${now.getFullYear()}-${month}-${day}`;
  const random = newId("a").slice(2);
  return `${date}-${slugify(company)}-${random}`;
}

export function assertApplicationId(id: string): string {
  if (!APPLICATION_ID.test(id)) throw new AppError(`Invalid application id "${id}"`, 400);
  return id;
}
