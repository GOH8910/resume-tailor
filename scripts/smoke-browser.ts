/**
 * The production-policy browser check for scripts/smoke-image.sh. The e2e suites run under `next dev`, whose policy
 * allows eval and inline styles; this walks the production image in headless Chromium, first signed out (the landing
 * and privacy pages), then signed in with the smoke script's curl cookie jar, and fails on any
 * Content-Security-Policy violation, page error or console error.
 *   npx tsx scripts/smoke-browser.ts <base url> <curl cookie jar>
 */
import { readFileSync } from "node:fs";
import { chromium, type BrowserContext, type Page } from "@playwright/test";

type JarCookie = Parameters<BrowserContext["addCookies"]>[0][number];

const HTTP_ONLY = "#HttpOnly_";

/** Cookies from a curl (Netscape format) jar: tab-separated, with HttpOnly ones prefixed by #HttpOnly_. */
function cookiesFromJar(file: string): JarCookie[] {
  return readFileSync(file, "utf8")
    .split("\n")
    .flatMap((line) => {
      const httpOnly = line.startsWith(HTTP_ONLY);
      if (!httpOnly && (line.startsWith("#") || line.trim() === "")) return [];
      const [domain, , path, secure, expires, name, value] = line.slice(httpOnly ? HTTP_ONLY.length : 0).split("\t");
      // curl writes 0 for a session cookie; Playwright wants -1.
      return [{ name, value, domain, path, httpOnly, secure: secure === "TRUE", expires: Number(expires) || -1 }];
    });
}

/** Signed out: the pages anyone can open. */
async function walkPublic(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("heading", { level: 1, name: /^Job hunting is hard\./ }).waitFor();
  // The sample resume comes from public/, which the image must ship.
  await page.waitForFunction(() => {
    const sample = document.querySelector<HTMLImageElement>("main img");
    return sample !== null && sample.naturalWidth > 0;
  });
  await page.goto("/privacy");
  await page.getByRole("heading", { level: 1, name: "Privacy" }).waitFor();
}

async function walk(page: Page): Promise<void> {
  // A signed-in visit to the landing page goes to the dashboard.
  await page.goto("/");
  await page.waitForURL(/\/dashboard$/);
  await page.getByRole("heading", { name: "Tailored resumes" }).waitFor();
  await page.goto("/bank/experience");
  await page.getByRole("heading", { name: "Experience" }).waitFor();
  await page.goto("/tailor");
  await page.getByLabel("Company").fill("Smoke Browser Ltd");
  await page.getByLabel("Job description").fill("Build reliable backend services in TypeScript.");
  await page.getByRole("button", { name: /^Start from full bank/ }).click();
  await page.waitForURL(/\/tailor\/[^/]+$/);
  // The review screen compiles on its own once its scripts run, and shows the page count of the preview.
  await page.getByText("1 page", { exact: true }).waitFor({ timeout: 60_000 });
  await page.locator('iframe[title="Resume PDF preview"][src^="blob:"]').waitFor();
  const missing = await page.goto("/no-such-page");
  if (missing?.status() !== 404) throw new Error(`/no-such-page answered ${missing?.status()}, not 404`);
  await page.getByRole("heading", { name: "Page not found" }).waitFor();
}

async function main(): Promise<void> {
  const [baseURL, jar] = process.argv.slice(2);
  if (!baseURL || !jar) throw new Error("Usage: smoke-browser.ts <base url> <curl cookie jar>");
  const problems: string[] = [];
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ baseURL });
    await context.exposeBinding("__reportCspViolation", ({ page }, text: string) => {
      problems.push(`CSP violation on ${page.url()}: ${text}`);
    });
    await context.addInitScript(() => {
      document.addEventListener("securitypolicyviolation", (event) => {
        const { __reportCspViolation: report } = window as unknown as { __reportCspViolation: (text: string) => void };
        report(`${event.effectiveDirective} blocked ${event.blockedURI} (${event.sourceFile}:${event.lineNumber})`);
      });
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => problems.push(`page error on ${page.url()}: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      // The browser logs the 404 page's own status as a failed resource: that one is the point of visiting it.
      const own404 = message.location().url.endsWith("/no-such-page") && message.text().includes("status of 404");
      if (!own404) problems.push(`console error on ${page.url()}: ${message.text()}`);
    });
    await walkPublic(page);
    await context.addCookies(cookiesFromJar(jar));
    await walk(page);
    // A round trip delivers any violation report still on its way.
    await page.evaluate(() => 0);
  } finally {
    await browser.close();
  }
  for (const problem of problems) console.error(problem);
  if (problems.length > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
