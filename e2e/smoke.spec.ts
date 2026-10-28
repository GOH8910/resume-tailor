import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

const DATA = path.resolve(".e2e-data");

test.beforeAll(async () => {
  await rm(DATA, { recursive: true, force: true });
  await mkdir(DATA, { recursive: true });
  await cp(path.resolve("data/example"), path.join(DATA, "example"), { recursive: true });
});

test("bank editor adds a bullet and persists it", async ({ page }) => {
  await page.goto("/bank/experience");
  await expect(page.getByRole("heading", { name: "Experience" })).toBeVisible();
  await page.getByRole("button", { name: "Add bullet" }).first().click();
  const fresh = page.locator('textarea[placeholder="New bullet"]:placeholder-shown').first();
  await fresh.fill("Shipped the smoke test bullet");
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible({ timeout: 10_000 });
  await page.reload();
  const bullets = page.locator('textarea[placeholder="New bullet"]');
  await expect(bullets.first()).toBeVisible();
  await expect
    .poll(() => bullets.evaluateAll((els) => els.map((el) => (el as HTMLTextAreaElement).value)))
    .toContain("Shipped the smoke test bullet");
});

test("manual application compiles to a one-page PDF on its own", async ({ page }) => {
  await page.goto("/tailor");
  await page.getByLabel("Company").fill("Acme");
  await page.getByLabel("Job description").fill("We need Go engineers.");
  await page.getByRole("button", { name: "Start from full bank" }).click();
  await expect(page).toHaveURL(/\/tailor\/.+/);
  // No click: the review screen compiles as soon as it loads.
  await expect(page.getByText("1 page", { exact: true })).toBeVisible({ timeout: 60_000 });
});
