import { expect, test } from "@playwright/test";
import { signIn, uniqueEmail } from "./helpers";

// The selfhost project (playwright.config.ts): no plans, credits or ads.

test("self-hosting shows no credits or ads, and keeps the model picker", async ({ page }) => {
  await signIn(page, uniqueEmail("selfhost"));
  await page.goto("/tailor");
  // The picker appears once the account has loaded, so the checks below are not racing it.
  await expect(page.getByLabel("Model")).toBeVisible();
  await expect(page.getByText(/^Credits: \d+$/)).toHaveCount(0);
  await expect(page.getByText(/you have \d+/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Watch an ad/ })).toHaveCount(0);

  await page.getByRole("button", { name: "Chat with Claude" }).click();
  const chat = page.getByRole("region", { name: "Chat with Claude" });
  await expect(chat.getByLabel("Message")).toBeVisible();
  await expect(chat.getByText(/per message/)).toHaveCount(0);
});
