import { expect, signIn, test, uniqueEmail } from "./helpers";

// Runs in both projects (playwright.config.ts): the landing page explains credits only in hosted mode.

const HEADLINE = "Job hunting is hard. Tailor your resume to every job in minutes.";
const SELF_HOSTED = "This instance is self-hosted: no ads, no credits.";

test("the landing page is public, with the pitch, the sample and a way to sign in", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1, name: HEADLINE })).toBeVisible();
  const sample = page.getByRole("img", { name: "A one-page tailored resume produced by Resume Tailor" });
  await expect(sample).toBeVisible();
  // Served from public/ without a session, not a broken image.
  await expect.poll(() => sample.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await expect(page.getByRole("heading", { name: "How it works" })).toBeVisible();
  const footer = page.getByRole("navigation", { name: "Footer" });
  await expect(footer.getByRole("link", { name: "GitHub" })).toHaveAttribute("href", "https://github.com/GOH8910/resume-tailor");
  for (const name of ["Privacy", "Terms", "Cookies"]) await expect(footer.getByRole("link", { name })).toBeVisible();

  await page.getByRole("link", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/signin$/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  // The header's sign-in link is left out on the sign-in page.
  await expect(page.getByRole("link", { name: "Sign in", exact: true })).toHaveCount(0);
});

test("the landing page explains credits when hosted, and says there are none when self-hosted", async ({ page }) => {
  await page.goto("/");
  const credits = page.getByRole("region", { name: "How credits work" });
  if (test.info().project.name === "hosted") {
    // playwright.config.ts sets CREDITS_PER_TAILOR=2; a chat message costs the default, 1.
    await expect(credits.getByText("2 credits", { exact: true })).toBeVisible();
    await expect(credits.getByText("1 credit", { exact: true })).toBeVisible();
    await expect(credits).toContainText("Free accounts run on Claude Haiku 5.5.");
    await expect(page.getByText(SELF_HOSTED)).toHaveCount(0);
  } else {
    await expect(page.getByText(SELF_HOSTED)).toBeVisible();
    await expect(credits).toHaveCount(0);
  }
});

test("the landing page says when an account was just deleted", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Your account has been deleted.")).toHaveCount(0);
  await page.goto("/?deleted=1");
  await expect(page.getByRole("status").filter({ hasText: "Your account has been deleted." })).toBeVisible();
});

for (const [path, heading] of [
  ["/privacy", "Privacy"],
  ["/terms", "Terms"],
  ["/cookies", "Cookies"],
]) {
  test(`${path} is public and renders its heading`, async ({ page }) => {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expect(page.getByText(/^This is not legal advice; last updated \d{1,2} [A-Z][a-z]+ \d{4}\.$/)).toBeVisible();
  });
}

test("the public pages fit a 320 px screen without scrolling sideways", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  for (const path of ["/", "/privacy", "/signin"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `horizontal overflow on ${path}`).toBe(0);
  }
});

test("a signed-in visit to / or /signin goes to the dashboard", async ({ page }) => {
  await signIn(page, uniqueEmail("landing"));
  await page.goto("/");
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Tailored resumes" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");
  await page.goto("/signin");
  await expect(page).toHaveURL(/\/dashboard$/);
});
