import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, seedExampleBank, signIn, test, uniqueEmail, watchTestAd } from "./helpers";

// The hosted project (playwright.config.ts): the test ad provider, no sign-up grant, and ADMIN_EMAILS naming
// ADMIN below, which only the admin test signs in as.

const ADMIN = "admin-e2e@example.com";

test("the account page shows the balance and the ledger after an ad", async ({ page }) => {
  const email = uniqueEmail("account-ledger");
  await signIn(page, email);
  await page.goto("/tailor");
  await watchTestAd(page);

  // The top bar's balance links to the account page.
  await page.getByRole("link", { name: "Credits: 1" }).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole("link", { name: "Account" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("link", { name: "Admin" })).toHaveCount(0);

  const profile = page.getByRole("region", { name: "Your account" });
  await expect(profile.getByText(email)).toBeVisible();
  await expect(profile.getByText("Free", { exact: true })).toBeVisible();

  const credits = page.getByRole("region", { name: "Credits" });
  await expect(credits.getByText("1", { exact: true })).toBeVisible();
  await expect(credits.getByRole("row", { name: /Ad watched/ })).toContainText("+1");
  await expect(credits.getByRole("row")).toHaveCount(2); // the header and the one ad
});

test("export downloads the account's data as JSON, with the seeded bank", async ({ page }) => {
  const email = uniqueEmail("account-export");
  await signIn(page, email);
  await seedExampleBank(page);
  await page.goto("/account");

  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download my data" }).click();
  const download = await downloading;

  expect(download.suggestedFilename()).toBe("resume-tailor-export.json");
  const exported = JSON.parse(await readFile(await download.path(), "utf8")) as {
    email: string;
    bank: { summary: string };
    applications: unknown[];
    credits: unknown[];
  };
  const seeded = JSON.parse(await readFile(path.resolve("data/example/bank.json"), "utf8")) as { summary: string };
  expect(exported.email).toBe(email);
  expect(exported.bank.summary).toBe(seeded.summary);
  expect(exported.applications).toEqual([]);
  expect(exported.credits).toEqual([]);
});

test("deleting the account signs out everywhere, and the same email starts afresh", async ({ page, request }) => {
  const email = uniqueEmail("account-delete");
  await signIn(page, email);
  await seedExampleBank(page);
  await page.goto("/tailor");
  await watchTestAd(page);
  const session = (await page.context().cookies()).find((cookie) => cookie.name.endsWith("session_token"));
  if (!session) throw new Error("No session cookie after signing in");
  // `request` shares no cookies with the browser, so these calls carry only the copied session cookie.
  const withOldCookie = () => request.get("/api/bank", { headers: { cookie: `${session.name}=${session.value}` } });

  await page.goto("/account");
  const confirm = page.getByLabel("Type your email to confirm");
  const deleteButton = page.getByRole("button", { name: "Delete my account" });
  await confirm.fill("someone-else@example.com");
  await expect(deleteButton).toBeDisabled();
  await confirm.fill(email.toUpperCase());
  await deleteButton.click();

  await expect(page).toHaveURL(/\/signin/);
  await page.goto("/bank/experience");
  await expect(page).toHaveURL(/\/signin/);
  expect((await withOldCookie()).status()).toBe(401);

  await signIn(page, email);
  const bank = (await (await page.request.get("/api/bank")).json()) as { summary: string; experience: unknown[] };
  expect(bank.summary).toBe("");
  expect(bank.experience).toEqual([]);
  const ledger = (await (await page.request.get("/api/account/credits")).json()) as { credits: number; events: unknown[] };
  expect(ledger).toEqual({ credits: 0, events: [] });
});

test("an admin pauses and resumes free usage and sets a plan; anyone else gets a 404", async ({ page, browser, baseURL }) => {
  const other = await browser.newContext({ baseURL });
  try {
    const otherPage = await other.newPage();
    const otherEmail = uniqueEmail("account-not-admin");
    await signIn(otherPage, otherEmail);
    const response = await otherPage.goto("/admin");
    expect(response?.status()).toBe(404);
    await expect(otherPage.getByRole("heading", { name: "Page not found" })).toBeVisible();
    expect((await otherPage.request.get("/api/admin/summary")).status()).toBe(404);
    expect((await otherPage.request.post("/api/admin/pause", { data: { paused: true } })).status()).toBe(404);

    await signIn(page, ADMIN);
    await page.getByRole("link", { name: "Admin" }).click();
    await expect(page).toHaveURL(/\/admin$/);
    const freeUsage = page.getByRole("region", { name: "Free usage" });
    await expect(freeUsage.getByRole("status")).toContainText("Running");

    await freeUsage.getByRole("button", { name: "Pause free usage" }).click();
    await expect(freeUsage.getByRole("status")).toContainText("Paused by you");
    await freeUsage.getByRole("button", { name: "Resume free usage" }).click();
    await expect(freeUsage.getByRole("status")).toContainText("Running");

    const setPlan = page.getByRole("form", { name: "Set a plan" });
    await setPlan.getByLabel("Account email").fill(otherEmail);
    await setPlan.getByLabel("Plan").selectOption("unlimited");
    await setPlan.getByRole("button", { name: "Set plan" }).click();
    await expect(setPlan.getByText(`${otherEmail} is now on the Unlimited plan.`)).toBeVisible();
    const me = (await (await otherPage.request.get("/api/me")).json()) as { plan: string; isAdmin: boolean };
    expect(me).toMatchObject({ plan: "unlimited", isAdmin: false });
  } finally {
    await other.close();
  }
});
