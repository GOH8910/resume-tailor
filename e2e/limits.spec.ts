import { expect, type Page, test } from "@playwright/test";
import { seedExampleBank, signIn, uniqueEmail } from "./helpers";

// Stand-ins for the hosted limits' answers: the shape the routes send (details.retryAfter), with short waits.

const tooMany = (retryAfter: number) => ({
  status: 429,
  headers: { "Retry-After": String(retryAfter) },
  json: { error: `Too many requests, try again in ${retryAfter} s`, details: { retryAfter } },
});

test("a rate-limited tailor counts down and holds its button until the wait is over", async ({ page }) => {
  await signIn(page, uniqueEmail("limits-tailor"));
  await page.goto("/tailor");
  await page.getByLabel("Company").fill("Acme");
  await page.getByLabel("Job description").fill("We need Go engineers.");
  await page.route("**/api/tailor", (route) => route.fulfill(tooMany(2)));

  const tailor = page.getByRole("button", { name: "Tailor with Claude" });
  await tailor.click();
  const notice = page.getByRole("status").filter({ hasText: "Too many requests" });
  await expect(notice).toContainText(/Too many requests, try again in [12] s/);
  await expect(tailor).toBeDisabled();
  // The other way to start is a different limit, so it stays available.
  await expect(page.getByRole("button", { name: "Start from full bank (no AI)" })).toBeEnabled();

  await expect(notice).toBeHidden({ timeout: 5_000 });
  await expect(tailor).toBeEnabled();
});

test("a rate-limited chat message goes back in the box until the countdown ends", async ({ page }) => {
  await signIn(page, uniqueEmail("limits-chat"));
  await page.getByRole("button", { name: "Chat with Claude" }).click();
  const chat = page.getByRole("region", { name: "Chat with Claude" });
  await page.route("**/api/chat", (route) => route.fulfill(tooMany(2)));

  const message = chat.getByLabel("Message");
  await message.fill("Shorten the summary");
  await chat.getByRole("button", { name: "Send" }).click();
  // Anchored: the screen-reader copy ("… in 2 seconds.") contains the same words.
  const countdown = chat.getByText(/^Too many requests, try again in \d s$/);
  await expect(countdown).toHaveText(/in [12] s$/);
  await expect(message).toHaveValue("Shorten the summary");
  await expect(chat.getByRole("button", { name: "Send" })).toBeDisabled();

  await expect(countdown).toBeHidden({ timeout: 5_000 });
  await expect(chat.getByRole("button", { name: "Send" })).toBeEnabled();
});

async function startFromFullBank(page: Page): Promise<void> {
  await page.goto("/tailor");
  await page.getByLabel("Company").fill("Acme");
  await page.getByLabel("Job description").fill("We need Go engineers.");
  await page.getByRole("button", { name: "Start from full bank" }).click();
  await expect(page).toHaveURL(/\/tailor\/[^/]+$/);
}

test("a busy compile queue retries the preview once on its own", async ({ page }) => {
  await signIn(page, uniqueEmail("limits-compile"));
  await seedExampleBank(page);
  let calls = 0;
  await page.route("**/api/compile", (route) => {
    calls++;
    if (calls > 1) return route.continue();
    return route.fulfill({
      status: 503,
      headers: { "Retry-After": "1" },
      json: { error: "Server busy, try again in a moment", details: { retryAfter: 1 } },
    });
  });
  await page.goto("/tailor");
  await page.getByLabel("Company").fill("Acme");
  await page.getByLabel("Job description").fill("We need Go engineers.");
  await page.getByRole("button", { name: "Start from full bank" }).click();
  await expect(page).toHaveURL(/\/tailor\/[^/]+$/);

  await expect(page.getByText("Server busy, retrying in 1 s")).toBeVisible();
  await expect(page.getByText("1 page", { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Server busy, retrying in 1 s")).toBeHidden();
  expect(calls).toBe(2);
});

test("a rate-limited compile retries the preview once after the wait", async ({ page }) => {
  await signIn(page, uniqueEmail("limits-compile-429"));
  await seedExampleBank(page);
  let calls = 0;
  await page.route("**/api/compile", (route) => {
    calls++;
    return calls > 1 ? route.continue() : route.fulfill(tooMany(1));
  });
  await startFromFullBank(page);

  await expect(page.getByText("Too many compiles, retrying in 1 s")).toBeVisible();
  await expect(page.getByText("1 page", { exact: true })).toBeVisible({ timeout: 60_000 });
  expect(calls).toBe(2);
});

test("a rate-limited bank save keeps the edit and saves it again after the wait", async ({ page }) => {
  await signIn(page, uniqueEmail("limits-bank-save"));
  await seedExampleBank(page);
  await page.goto("/bank/profile");
  let refused = false;
  await page.route("**/api/bank", (route) => {
    if (route.request().method() !== "PUT" || refused) return route.continue();
    refused = true;
    return route.fulfill(tooMany(2));
  });

  await page.getByLabel("Master summary").fill("Rate-limited summary, saved later.");
  const status = page.getByRole("status").filter({ hasText: /Saving again|Saved/ });
  await expect(status).toContainText(/Saving again in [12] s/);
  await expect(status).toHaveText("Saved", { timeout: 10_000 });

  await page.reload();
  await expect(page.getByLabel("Master summary")).toHaveValue("Rate-limited summary, saved later.");
});

test("a rate-limited resume save keeps the edit and saves it again after the wait", async ({ page }) => {
  await signIn(page, uniqueEmail("limits-resume-save"));
  await seedExampleBank(page);
  await startFromFullBank(page);
  await expect(page.getByText("1 page", { exact: true })).toBeVisible({ timeout: 60_000 });
  let refused = false;
  await page.route("**/api/applications/*", (route) => {
    if (route.request().method() !== "PUT" || refused) return route.continue();
    refused = true;
    return route.fulfill(tooMany(2));
  });

  await page.getByLabel("Summary paragraph").fill("Rate-limited resume summary.");
  await expect(page.getByText(/^Saving again in [12] s$/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Saved" })).toBeVisible({ timeout: 10_000 });

  await page.reload();
  await expect(page.getByLabel("Summary paragraph")).toHaveValue("Rate-limited resume summary.");
});
