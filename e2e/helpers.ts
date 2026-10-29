import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";

/** The running project's data folder (playwright.config.ts), where its server writes sign-in links. */
function dataDir(): string {
  const dir: unknown = test.info().project.metadata.dataDir;
  if (typeof dir !== "string") throw new Error("The Playwright project sets no metadata.dataDir");
  return dir;
}

/** A fresh address per call, so no test shares an account or a sign-in link with another. */
export function uniqueEmail(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

/** Signs in through the magic link that EMAIL_TRANSPORT=file writes to disk; lands on the dashboard. */
export async function signIn(page: Page, email: string): Promise<void> {
  await page.goto("/signin");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Email me a link" }).click();
  await expect(page.getByText("Check your email")).toBeVisible();
  const file = path.join(dataDir(), "magic-links", `${email.toLowerCase()}.txt`);
  let link = "";
  await expect
    .poll(async () => (link = (await readFile(file, "utf8").catch(() => "")).trim()), { message: `sign-in link in ${file}` })
    .not.toBe("");
  await page.goto(link);
  await expect(page).toHaveURL(/\/$/);
}

/** Replaces the signed-in user's bank with data/example/bank.json. */
export async function seedExampleBank(page: Page): Promise<void> {
  const bank: unknown = JSON.parse(await readFile(path.resolve("data/example/bank.json"), "utf8"));
  // The request context carries the page's session cookie and sends no Origin header, so the proxy lets it through.
  const response = await page.request.put("/api/bank", { data: bank });
  expect(response.status()).toBe(200);
}
