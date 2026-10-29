import { readFile } from "node:fs/promises";
import path from "node:path";
import { test as base, expect, type Page } from "@playwright/test";

/**
 * Playwright's `test`, failing any test in which the browser reported a Content-Security-Policy violation.
 * `cspViolations` lists them; a test that provokes one on purpose takes it out with `cspViolations.splice(0)`.
 * The listener runs in every page and frame of the test's browser context and reports to Node, so a navigation does
 * not lose what came before it. Contexts a test opens itself (`browser.newContext()`) are not watched.
 */
export const test = base.extend<{ cspViolations: string[] }>({
  cspViolations: [
    async ({ context }, use) => {
      const violations: string[] = [];
      await context.exposeBinding("__reportCspViolation", ({ page }, text: string) => {
        violations.push(`${page.url()}: ${text}`);
      });
      await context.addInitScript(() => {
        document.addEventListener("securitypolicyviolation", (event) => {
          const { __reportCspViolation: report } = window as unknown as { __reportCspViolation: (text: string) => void };
          // blockedURI is a URL, or "inline" or "eval".
          report(`${event.effectiveDirective} blocked ${event.blockedURI} (${event.sourceFile}:${event.lineNumber})`);
        });
      });
      await use(violations);
      expect(violations, "Content-Security-Policy violations").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

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
