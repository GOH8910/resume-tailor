import { expect, type Page, test } from "@playwright/test";
import { seedExampleBank, signIn, uniqueEmail } from "./helpers";

// The hosted project (playwright.config.ts): APP_MODE=hosted, the test ad provider with a 1 s minimum watch,
// 2 credits per tailor, no sign-up grant, and no Anthropic key, so tailoring itself answers 503.

const balancePill = (page: Page) => page.getByRole("status").filter({ hasText: /^Credits: \d+$/ });
const tailorButton = (page: Page) => page.getByRole("button", { name: "Tailor with Claude" });
const adButton = (page: Page) => page.getByRole("button", { name: "Watch an ad (+1 credit)" });

async function fillJob(page: Page): Promise<void> {
  await page.getByLabel("Company").fill("Acme");
  await page.getByLabel("Job description").fill("We need Go engineers.");
}

async function watchTestAd(page: Page): Promise<void> {
  await adButton(page).click();
  const ad = page.getByRole("dialog", { name: "Test ad" });
  await expect(ad).toBeVisible();
  await expect(ad).toBeHidden({ timeout: 10_000 });
}

test("earns credits by watching test ads until a tailor is affordable", async ({ page }) => {
  await signIn(page, uniqueEmail("credits"));
  await page.goto("/tailor");
  await expect(balancePill(page)).toHaveText("Credits: 0");
  await fillJob(page);
  await expect(page.getByText("Costs 2 credits · you have 0")).toBeVisible();
  await expect(tailorButton(page)).toBeDisabled();

  await watchTestAd(page);
  await expect(balancePill(page)).toHaveText("Credits: 1");
  // The ad dialog hands focus back to the button that opened it.
  await expect(adButton(page)).toBeFocused();
  await expect(tailorButton(page)).toBeDisabled();

  await watchTestAd(page);
  await expect(balancePill(page)).toHaveText("Credits: 2");
  await expect(page.getByText("Costs 2 credits · you have 2")).toBeVisible();
  await expect(tailorButton(page)).toBeEnabled();

  // Without a key the server refuses before charging: the balance is untouched.
  await tailorButton(page).click();
  await expect(page.getByRole("alert").filter({ hasText: "The AI service is not configured on this server" })).toBeVisible();
  const me = await page.request.get("/api/me");
  expect(((await me.json()) as { credits: number }).credits).toBe(2);
});

test("a 402 from the tailor route shows the pause, or the real balance", async ({ page }) => {
  await signIn(page, uniqueEmail("credits-402"));
  await page.goto("/tailor");
  await watchTestAd(page);
  await watchTestAd(page);
  await expect(balancePill(page)).toHaveText("Credits: 2");
  await fillJob(page);

  // Stand-ins for answers this server cannot give without a key: paused, then short (spent in another tab).
  await page.route("**/api/tailor", (route) =>
    route.fulfill({
      status: 402,
      json: { error: "Free AI features are paused by the operator", details: { paused: true, reason: "manual" } },
    }),
  );
  await tailorButton(page).click();
  await expect(page.getByText("Free AI features are paused by the operator")).toBeVisible();
  await expect(balancePill(page)).toHaveText("Credits: 2");

  await page.unroute("**/api/tailor");
  await page.route("**/api/tailor", (route) =>
    route.fulfill({ status: 402, json: { error: "Not enough credits", details: { credits: 1, needed: 2 } } }),
  );
  await tailorButton(page).click();
  await expect(balancePill(page)).toHaveText("Credits: 1");
  await expect(page.getByText("Not enough credits")).toBeVisible();
  await expect(tailorButton(page)).toBeDisabled();
});

test("closing the test ad early earns nothing", async ({ page }) => {
  await signIn(page, uniqueEmail("credits-close"));
  await page.goto("/tailor");
  await expect(balancePill(page)).toHaveText("Credits: 0");
  const ad = page.getByRole("dialog", { name: "Test ad" });
  const closeAd = ad.getByRole("button", { name: "Close" });

  // Keyboard: focus starts inside, Tab cannot leave, Escape dismisses and focus goes back to the opener.
  await adButton(page).click();
  await expect(closeAd).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(closeAd).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(ad).toBeHidden();
  await expect(page.getByRole("alert").filter({ hasText: "The ad was closed too early" })).toBeVisible();
  await expect(adButton(page)).toBeFocused();

  await adButton(page).click();
  await closeAd.click();
  await expect(ad).toBeHidden();
  await expect(page.getByRole("alert").filter({ hasText: "The ad was closed too early" })).toBeVisible();
  await expect(balancePill(page)).toHaveText("Credits: 0");
});

test("the server refuses a grant that comes too soon after the ad started", async ({ page }) => {
  await signIn(page, uniqueEmail("credits-early"));
  const started = await page.request.post("/api/ads/start");
  expect(started.status()).toBe(200);
  const { sessionId } = (await started.json()) as { sessionId: string };
  const grant = await page.request.post("/api/ads/grant", { data: { sessionId } });
  expect(grant.status()).toBe(409);
  expect(await grant.json()).toMatchObject({ error: "The ad was closed too early" });
});

test("starting from the full bank stays free with no credits", async ({ page }) => {
  await signIn(page, uniqueEmail("credits-manual"));
  await seedExampleBank(page);
  await page.goto("/tailor");
  await expect(balancePill(page)).toHaveText("Credits: 0");
  await fillJob(page);
  await page.getByRole("button", { name: "Start from full bank" }).click();
  await expect(page).toHaveURL(/\/tailor\/[^/]+$/);
  await expect(balancePill(page)).toHaveText("Credits: 0");
});

test("the chat drawer shows the per-message cost and offers an ad when out of credits", async ({ page }) => {
  await signIn(page, uniqueEmail("credits-chat"));
  await page.getByRole("button", { name: "Chat with Claude" }).click();
  const chat = page.getByRole("region", { name: "Chat with Claude" });
  await expect(chat.getByText("1 credit per message · you have 0")).toBeVisible();
  await expect(chat.getByText("Watch an ad to keep chatting.")).toBeVisible();
  await chat.getByLabel("Message").fill("Hello");
  await expect(chat.getByRole("button", { name: "Send" })).toBeDisabled();

  await chat.getByRole("button", { name: "Watch an ad (+1 credit)" }).click();
  await expect(page.getByRole("dialog", { name: "Test ad" })).toBeHidden({ timeout: 10_000 });
  await expect(chat.getByText("1 credit per message · you have 1")).toBeVisible();
  await expect(chat.getByText("Watch an ad to keep chatting.")).toBeHidden();
  await expect(chat.getByLabel("Message")).toBeFocused();
  await expect(chat.getByRole("button", { name: "Send" })).toBeEnabled();

  // Stand-ins for answers this server cannot give without a key.
  const message = chat.getByLabel("Message");
  const send = chat.getByRole("button", { name: "Send" });
  await page.route("**/api/chat", (route) =>
    route.fulfill({ status: 200, json: { reply: "Hi", applied: [], warnings: [], bank: {}, bankChanged: false, resumeChanges: [] } }),
  );
  const balanceReload = page.waitForRequest((request) => request.url().endsWith("/api/me"));
  await send.click();
  await expect(chat.getByText("Hi", { exact: true })).toBeVisible();
  await balanceReload;

  await page.unroute("**/api/chat");
  await page.route("**/api/chat", (route) =>
    route.fulfill({ status: 402, json: { error: "Free AI features are paused by the operator", details: { paused: true, reason: "manual" } } }),
  );
  await message.fill("Second message");
  await send.click();
  await expect(chat.getByText("Free AI features are paused by the operator")).toBeVisible();
  // The refused message goes back in the box, ready to send again.
  await expect(message).toHaveValue("Second message");

  await page.unroute("**/api/chat");
  await page.route("**/api/chat", (route) =>
    route.fulfill({ status: 402, json: { error: "Not enough credits", details: { credits: 0, needed: 1 } } }),
  );
  await send.click();
  await expect(balancePill(page)).toHaveText("Credits: 0");
  await expect(chat.getByText("Watch an ad to keep chatting.")).toBeVisible();
  await expect(message).toHaveValue("Second message");
  await expect(send).toBeDisabled();
});
