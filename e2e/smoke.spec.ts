import { expect, seedExampleBank, signIn, test, uniqueEmail } from "./helpers";

// The data folder starts empty on every run: playwright.config.ts clears it before starting the server.

test("signed-out visitor is sent to sign in", async ({ page }) => {
  await page.goto("/bank/experience");
  await expect(page).toHaveURL(/\/signin\?next=%2Fbank%2Fexperience$/);
  expect((await page.request.get("/api/bank")).status()).toBe(401);
});

test("the content security policy refuses injected inline code, and the e2e check sees it", async ({ page, cspViolations }) => {
  const response = await page.goto("/signin");
  expect(response?.headers()["content-security-policy"]).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
  // Markup injected the way an XSS payload arrives: an inline handler, which no nonce covers.
  const ran = await page.evaluate(() => {
    document.body.insertAdjacentHTML("beforeend", '<button id="injected" onclick="window.injectedRan = true">x</button>');
    document.getElementById("injected")?.click();
    return (window as unknown as { injectedRan?: boolean }).injectedRan === true;
  });
  expect(ran).toBe(false);
  await expect.poll(() => cspViolations.length).toBe(1);
  // Taken out, so the fixture's own check at the end of the test passes.
  expect(cspViolations.splice(0)).toEqual([expect.stringContaining("script-src-attr blocked inline")]);
});

test("bank editor adds a bullet and persists it", async ({ page }) => {
  await signIn(page, uniqueEmail("bank"));
  await seedExampleBank(page);
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
  await signIn(page, uniqueEmail("compile"));
  await seedExampleBank(page);
  await page.goto("/tailor");
  await page.getByLabel("Company").fill("Acme");
  await page.getByLabel("Job description").fill("We need Go engineers.");
  await page.getByRole("button", { name: "Start from full bank" }).click();
  await expect(page).toHaveURL(/\/tailor\/[^/]+$/);
  // No click: the review screen compiles as soon as it loads.
  await expect(page.getByText("1 page", { exact: true })).toBeVisible({ timeout: 60_000 });
});

test("sign out ends the session", async ({ page, request }) => {
  await signIn(page, uniqueEmail("signout"));
  const session = (await page.context().cookies()).find((cookie) => cookie.name.endsWith("session_token"));
  if (!session) throw new Error("No session cookie after signing in");
  // `request` shares no cookies with the browser, so these calls carry only the copied session cookie.
  const withOldCookie = () => request.get("/api/bank", { headers: { cookie: `${session.name}=${session.value}` } });
  expect((await withOldCookie()).status()).toBe(200);

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/signin$/);
  await page.goto("/bank/experience");
  await expect(page).toHaveURL(/\/signin/);
  // Sign-out must end the session on the server, not just drop the cookie from this browser.
  expect((await withOldCookie()).status()).toBe(401);
});

test("tenant isolation: one account cannot see another's applications", async ({ page, browser, baseURL }) => {
  await signIn(page, uniqueEmail("tenant-a"));
  const created = await page.request.post("/api/applications", {
    data: { company: "Acme", jobDescription: "We need Go engineers." },
  });
  expect(created.status()).toBe(201);
  const { application } = (await created.json()) as { application: { id: string } };
  expect((await page.request.get(`/api/applications/${application.id}`)).status()).toBe(200);

  const other = await browser.newContext({ baseURL });
  try {
    const pageB = await other.newPage();
    await signIn(pageB, uniqueEmail("tenant-b"));
    expect((await pageB.request.get(`/api/applications/${application.id}`)).status()).toBe(404);
    // Deleting is idempotent, so it answers 200 for any id; what matters is that A's application survives it.
    expect((await pageB.request.delete(`/api/applications/${application.id}`)).ok()).toBe(true);
    const list = await pageB.request.get("/api/applications");
    expect(list.status()).toBe(200);
    expect(((await list.json()) as { applications: unknown[] }).applications).toEqual([]);
  } finally {
    await other.close();
  }
  // B's delete matched none of A's rows.
  expect((await page.request.get(`/api/applications/${application.id}`)).status()).toBe(200);
});
