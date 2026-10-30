# Phase 2a — Credits, Launch Hardening, Open Source — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the hosted app safe to open to the public: free usage funded by ad-earned credits (with `none`/`test` ad providers now, Google in phase 2b), every Claude call costed against a daily budget, abuse bounded, legal pages, account export/delete, security headers, and an AGPL-3.0-only open-source, self-hostable repository.

**Architecture:** `APP_MODE` (`hosted`/`selfhost`) and `users`' plan (`free`/`unlimited`) drive a single plan table (`src/billing/plan.ts`). A credits ledger (`credit_events`, `ad_sessions`) and a usage ledger (`usage_events`) live beside the existing tables; routes charge credits in a transaction before calling Claude and refund on failure. An `AdProvider` abstraction keeps the ad network out of the app code. Limits are in-memory per machine (one Fly machine by design). CSP/nonce is added in `src/proxy.ts`.

**Tech Stack:** as phase 1 (Next.js 16.4, Drizzle 0.45, Better Auth 1.7, Vitest 5, Playwright 1.64, Docker/Fly). No new runtime dependencies expected; `@noble/curves` or Node's `crypto.verify` for SSV signature checks.

Spec: `docs/superpowers/specs/2026-10-29-ads-credits-launch-design.md`. Phase 1 context: `docs/superpowers/specs/2026-10-28-hosted-resume-tailor-design.md`, `docs/runbook.md`.

**Conventions for every task**
- Branch `feat/phase-2-ads-launch` in a separate git worktree. Never touch the owner's main checkout (their dev server on port 3000). Never `pkill`; stop only your own PIDs. Dev servers on port 3001 with `BETTER_AUTH_URL=http://localhost:3001`; PGlite is single-process.
- Commit with a plain `git commit -m "type: ..."` on its own (the pre-commit guard rejects any command containing `git commit` plus a `-n`-style flag anywhere in its text). No attribution trailers.
- Gate before each commit: `npx tsc --noEmit && npx eslint src e2e scripts && npx vitest run`; `npm run test:e2e` where the task touches UI or routes; `bash scripts/smoke-image.sh` for Task 5/6.
- TDD for logic. Keep files focused (< 400 lines). Comments only for non-obvious whys. Read `node_modules/next/dist/docs/` before using a Next API.
- Settings are read once in `src/lib/env.ts` (zod) and consumed through `env`; no `process.env` reads elsewhere.

---

## File map

| Path | Responsibility |
| --- | --- |
| `src/lib/env.ts` | + `APP_MODE`, `ADMIN_EMAILS`, `AD_PROVIDER`, `AD_UNIT_PATH`, `AD_SSV_ENABLED`, `FREE_MODEL`, `UNLIMITED_MODEL`, credit/limit/budget settings. |
| `src/billing/plan.ts` | Plan table: `planFor(user)`, `modelFor(plan)`, `chargesCredits(plan)`, `showsAds(plan)`. |
| `src/billing/costs.ts` | Price table per model, `estimateCostGbp(model, inputTokens, outputTokens)`. |
| `src/billing/usage.ts` | `recordUsage`, `freeSpendToday`, `isFreeUsagePaused`. |
| `src/credits/service.ts` | Ledger: `balance`, `grantForAd`, `grantSignup`, `charge`, `refund`, caps, `startAdSession`. |
| `src/credits/day.ts` | UTC day helpers (`startOfUtcDay`, `nextUtcDay`). |
| `src/ads/provider.ts`, `src/ads/none.ts`, `src/ads/test.ts`, `src/ads/csp.ts`, `src/ads/ssv.ts` | Ad provider contract, the two shipped providers, CSP allowances, SSV verification. |
| `src/app/api/ads/{start,grant,ssv}/route.ts` | Ads API. |
| `src/app/api/account/{export,delete}/route.ts`, `src/app/(app)/account/page.tsx` | Account page. |
| `src/app/(app)/admin/page.tsx`, `src/app/api/admin/{summary,pause}/route.ts` | Admin page. |
| `src/app/(public)/page.tsx`, `(public)/privacy`, `(public)/terms`, `(public)/cookies` | Public pages; dashboard moves to `/dashboard`. |
| `src/lib/rate-limit.ts` | Token buckets. |
| `src/db/schema.ts` | + `userPlans`, `creditEvents`, `adSessions`, `usageEvents`, `settings`. |
| `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`, `README.md`, `docs/runbook.md` | Open-source and ops docs. |

---

### Task 1: Modes, plans and the model policy

**Files:** `src/lib/env.ts` (+ test), `src/billing/plan.ts` (+ test), `src/db/schema.ts` (+ migration), `src/lib/auth.ts` (user-create hook), `src/lib/http.ts` (`requireUser` returns `plan`), `src/app/api/tailor/route.ts`, `src/app/api/chat/route.ts`, `src/ui/tailor/TailorForm.tsx`, `src/ui/chat/ChatDrawer.tsx`, `src/tailor/model.ts`, `.env.example`.

- [x] **Step 1: Settings.** Add to the env schema (all optional with defaults; tests for each rule):

```ts
APP_MODE: z.enum(["hosted", "selfhost"]).optional(),            // resolved: production → hosted, else selfhost
ADMIN_EMAILS: z.string().optional(),                             // comma-separated → adminEmails: Set<string>
AD_PROVIDER: z.enum(["none", "test", "google"]).default("none"), // selfhost forces "none"; "test" refused in production
AD_UNIT_PATH: z.string().optional(),                             // required when AD_PROVIDER=google
AD_SSV_ENABLED: z.coerce.boolean().default(false),
FREE_MODEL: z.string().default("claude-haiku-5-5"),
UNLIMITED_MODEL: z.string().default("claude-sonnet-5-5"),
CREDITS_PER_TAILOR: z.coerce.number().int().min(0).default(2),
CREDITS_PER_CHAT_MESSAGE: z.coerce.number().int().min(0).default(1),
AD_CREDITS_PER_ACCOUNT_PER_DAY: z.coerce.number().int().min(0).default(10),
AD_CREDITS_PER_IP_PER_DAY: z.coerce.number().int().min(0).default(30),
AD_MIN_WATCH_SECONDS: z.coerce.number().min(0).default(7),
SIGNUP_GRANT_CREDITS: z.coerce.number().int().min(0).default(0),
FREE_DAILY_BUDGET_GBP: z.coerce.number().min(0).default(2),
```

Export `env.appMode`, `env.adminEmails`. Rule: `hosted` in production requires `ANTHROPIC_API_KEY` (already) and, when `AD_PROVIDER=google`, `AD_UNIT_PATH`.

- [x] **Step 2: Plan table** `src/billing/plan.ts`:

```ts
export type Plan = "free" | "unlimited";
export type PlanPolicy = { model: string; chargesCredits: boolean; showsAds: boolean; limited: boolean };

export function policyFor(plan: Plan, mode: "hosted" | "selfhost", settings: { freeModel: string; unlimitedModel: string }): PlanPolicy {
  if (mode === "selfhost") return { model: settings.unlimitedModel, chargesCredits: false, showsAds: false, limited: false };
  return plan === "unlimited"
    ? { model: settings.unlimitedModel, chargesCredits: false, showsAds: false, limited: true }
    : { model: settings.freeModel, chargesCredits: true, showsAds: true, limited: true };
}
```

Add `"claude-haiku-5-5"` to `MODEL_IDS`/`MODEL_LABELS` in `src/tailor/model.ts`. In `hosted` mode the request body's `model` is ignored (schema keeps it optional for self-host); the route uses `policyFor(...).model`, except an `unlimited` user may still pass a model from `MODEL_IDS`.

- [x] **Step 3: Schema.** `userPlans` table: `user_id` pk fk cascade, `plan` text not null default 'free', `credits` integer not null default 0, `created_at`. `npm run db:generate` → one new migration. `src/billing/plans-repo.ts`: `getPlan(userId)` (creates the row with the default on miss, like banks), `setPlan`.

- [x] **Step 4: Assignment.** In `src/lib/auth.ts` `databaseHooks.user.create.after`: after `banks.createEmpty`, `plans.ensure(user.id, adminEmails.has(email) ? "unlimited" : "free")`. `requireUser` returns `{ id, email, name, plan }` (one query through `plans-repo`; cache nothing). Tests.

- [x] **Step 5: Routes and UI.** Tailor and chat routes compute `policy = policyFor(user.plan, env.appMode, …)` and build the model from `policy.model`. `TailorForm`: fetch `/api/me` (new small route returning `{ email, plan, mode, credits, policy: { chargesCredits, showsAds, model } }`) and hide the model picker when `chargesCredits || mode === "hosted" && plan === "free"`; show "Powered by Claude Haiku" text instead. ChatDrawer: same source. (Credits display is Task 4.)

- [x] **Step 6: Verify, commit** `feat: app modes, account plans and server-side model policy`.

---

### Task 2: Usage costing and the daily budget

**Files:** `src/lib/anthropic.ts` (return usage), `src/tailor/anthropic-model.ts`, `src/chat/anthropic-chat-model.ts`, `src/tailor/model.ts`/`src/chat/model.ts` (result types carry `usage`), `src/billing/costs.ts` (+ test), `src/billing/usage.ts` (+ test), `src/db/schema.ts` (`usageEvents`, `settings`), routes.

- [x] **Step 1: Usage out of the model client.** `createStructured` returns `{ value, usage: { inputTokens, outputTokens, model } }` (from `response.usage.input_tokens/output_tokens`; include cache read/write tokens if present as separate fields). The tailor/chat model wrappers pass it up: `TailorModel.tailor()` → `{ result, usage }`, `ChatModel.chat()` → `{ result, usage }`. Update `runTailor`/`runChat` to return `usage` alongside (keep their outputs otherwise unchanged) and the tests/fakes.

- [x] **Step 2: Costs** `src/billing/costs.ts`: a price table in USD per million tokens `{ "claude-haiku-5-5": { input: 0.10, output: 0.50 }, "claude-sonnet-5-5": { input: 2, output: 10 }, "claude-opus-5-5": { input: 4, output: 20 } }`, `USD_TO_GBP` setting (default 0.78, `env.USD_TO_GBP`), `estimateCostGbp(model, usage)`; unknown model → use the Opus price (conservative) and log once.

- [x] **Step 3: Ledger.** `usageEvents` table (id uuid default, user_id fk set null (as built: usage outlives the account for the budget), kind text, model text, input_tokens int, output_tokens int, cost_gbp numeric(10,6), free boolean, created_at). `settings` table (key text pk, value jsonb). `src/billing/usage.ts`: `recordUsage({ userId, kind, model, usage, free })`, `freeSpendToday()` (sum of `cost_gbp` where `free` and `created_at >= startOfUtcDay`), `isFreeUsagePaused()` = manual flag in `settings('free_paused')` OR `freeSpendToday() >= FREE_DAILY_BUDGET_GBP`, returning `{ paused, resumesAt }`. Tests on PGlite incl. the UTC day boundary.

- [x] **Step 4: Routes.** Tailor/chat: for `chargesCredits` plans check `isFreeUsagePaused()` first → 402 (as built: `{ error, details: { paused: true, reason, resumesAt } }`); after a successful call `recordUsage(..., free: policy.chargesCredits)`; also record usage for unlimited users (`free: false`). The seed script records `kind: "seed"`.

- [x] **Step 5: Commit** `feat: cost every Claude call and pause free usage over the daily budget`.

---

### Task 3: Credits ledger and the ads API

**Files:** `src/db/schema.ts` (`creditEvents`, `adSessions`), `src/credits/day.ts`, `src/credits/service.ts` (+ tests), `src/app/api/ads/start/route.ts`, `src/app/api/ads/grant/route.ts`, `src/app/api/ads/ssv/route.ts`, `src/ads/ssv.ts` (+ test), tailor/chat routes, `src/lib/auth.ts` (signup grant), `src/lib/http.ts` (`clientIp(request)` from `fly-client-ip` then `x-forwarded-for` first entry).

- [x] **Step 1: Tables.** `creditEvents` (id uuid, user_id fk set null (as built, so the ledger outlives the account), kind text, amount int, ref text null, created_at) with index (user_id, created_at); `adSessions` (id uuid, user_id fk set null (as built, so the per-IP cap still counts a deleted account's ads), ip text, provider text, started_at, granted_at null, status text, reject_reason text null, transaction_id text null unique) with index (user_id, started_at) and (ip, started_at). Migration.

- [x] **Step 2: Service (TDD on PGlite).** `src/credits/service.ts` exports a `CreditsService` built from `getDb` with:
  - `balance(userId)` → `userPlans.credits`.
  - `startAdSession({ userId, ip, provider })` → checks `grantedToday(userId) < AD_CREDITS_PER_ACCOUNT_PER_DAY` and `grantedTodayByIp(ip) < AD_CREDITS_PER_IP_PER_DAY` (count `credit_events.kind='ad'` joined to sessions, or count granted sessions) else throws `AppError(…, 429, { resetsAt })`; inserts `started`; returns `{ sessionId }`.
  - `grantAd({ userId, sessionId, now })` → transaction: lock the session row (`for update`), require owner + `started`, `now - started_at >= AD_MIN_WATCH_SECONDS` else reject `"watched too briefly"`, caps re-checked, then `granted`, `credit_events(+1, kind 'ad', ref session)`, `userPlans.credits += 1`. Returns the new balance; rejections store `reject_reason` and throw 409.
  - `charge({ userId, amount, kind, ref })` → transaction: `update user_plans set credits = credits - amount where user_id = ? and credits >= amount returning credits`; no row → `AppError("Not enough credits", 402, { credits, needed })`; insert the negative ledger row.
  - `refund({ userId, amount, kind, ref })` → positive row + increment.
  - `grantSignup(userId, amount)` → idempotent (skip if a `signup` row exists).
  - `history(userId, limit)`.
  Tests: caps per account/IP with the UTC day boundary, too-brief rejection, double grant rejection, charge below balance fails without a ledger row, charge/refund symmetry, signup idempotency, concurrency: two parallel charges of 1 against a balance of 1 → exactly one succeeds.

- [x] **Step 3: Routes.** `POST /api/ads/start` (requireUser; `policy.showsAds` else 400; rate limit comes in Task 5) → `{ sessionId }`. `POST /api/ads/grant { sessionId }` → when `AD_SSV_ENABLED` return the session status instead (`{ status }`; the client polls); else `grantAd` → `{ credits }`. `POST /api/ads/ssv` (public, no cookie): parse Google's query parameters, verify with `src/ads/ssv.ts` (`verifySsv(query, keys)`: ECDSA P-256/SHA-256 over the query string minus `signature`/`key_id`, keys fetched from the configured JSON URL and cached 24 h), match `transaction_id`/`custom_data` (session id) and grant through the service; always 200 to Google after processing; log rejections. Test the verifier with a key pair generated in the test (`crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" })`). Note in code that the exact parameter names must be checked against Ad Manager's web SSV docs during phase 2b.

- [x] **Step 4: Charging.** Tailor route: if `policy.chargesCredits` and `CREDITS_PER_TAILOR > 0`: `charge(…)` before `runTailor`, `refund` in a `catch` that rethrows. Chat: same with `CREDITS_PER_CHAT_MESSAGE`. `/api/me` returns `credits`, `creditsPerTailor`, `creditsPerChatMessage`. Signup grant in the user-create hook when `SIGNUP_GRANT_CREDITS > 0`.

- [x] **Step 5: Route tests** (mock service or PGlite): 402 shape; refund on model failure; grant flow; SSV rejects a bad signature.

- [x] **Step 6: Commit** `feat: credits ledger, ad sessions and the ads API`.

---

### Task 4: Ad provider abstraction and the credits UI

**Files:** `src/ads/provider.ts`, `src/ads/none.ts`, `src/ads/test.ts`, `src/ui/ads/RewardedAd.tsx`, `src/ui/ads/useCredits.ts`, `src/ui/TopBar.tsx` (balance pill), `src/ui/tailor/TailorForm.tsx`, `src/ui/chat/ChatDrawer.tsx`, `src/app/api/me/route.ts`, `src/app/(app)/layout.tsx` (passes `me` down or a client fetch), e2e.

- [x] **Step 1: Contract.**

```ts
export type AdProviderName = "none" | "test" | "google";
export type AdClientConfig = { provider: AdProviderName; adUnitPath?: string; ssv: boolean };
export type ShowRewardedAd = (opts: { sessionId: string; onGranted: () => void; onClosed: () => void; onError: (message: string) => void }) => void;
```

Server: `adClientConfig()` from env (never exposes secrets). Client: `src/ui/ads/providers.ts` maps the name to a `ShowRewardedAd`; `none` → never offered; `test` → renders a modal "Test ad playing… 8 s" then calls `onGranted` (the delay must exceed `AD_MIN_WATCH_SECONDS`, which the e2e sets to 1 to keep tests quick); `google` → stub that throws "not available in phase 2a" (implemented in 2b).

- [x] **Step 2: Hook and components.** `useCredits()` loads `/api/me`, exposes `{ credits, cost, refresh, watchAd() }` where `watchAd` = `POST /api/ads/start` → provider show → on granted `POST /api/ads/grant` → refresh; errors mapped to the Banner. `RewardedAd` button: "Watch an ad (+1 credit)" with the daily-cap message from a 429. TopBar shows "Credits: n" for free users in hosted mode (hidden otherwise). Tailor form: when `credits < creditsPerTailor` the Tailor button is disabled with "Needs 2 credits · you have 1" and the ad button beside it; a 402 from the API refreshes and shows the same state; the paused message when `paused`. Chat drawer: credits shown; a 402 shows "Watch an ad to keep chatting" with the button.

- [x] **Step 3: E2E** (`playwright.config.ts` env: `APP_MODE=hosted`, `AD_PROVIDER=test`, `AD_MIN_WATCH_SECONDS=1`, `CREDITS_PER_TAILOR=2`, `SIGNUP_GRANT_CREDITS=0`): new test "earns credits by watching ads and spends them": sign up → balance 0 → Tailor button disabled → watch ad twice → balance 2 → "Start from full bank" still free; a real AI tailor is not run in e2e (no key), so assert the enabled state and the 402 → disabled transition by calling `/api/tailor` with a mocked failure? Simpler: assert the button enables at 2 credits and that `POST /api/ads/grant` for a fresh session within 1 s is rejected (409). Keep the existing tests green; the self-host e2e config (a second Playwright project with `APP_MODE=selfhost`) checks no credits UI appears.

- [x] **Step 4: Commit** `feat: rewarded-ad provider abstraction and the credits UI`.

---

### Task 5: Limits and hardening

**Files:** `src/lib/rate-limit.ts` (+ test), route edits, `src/lib/http.ts` (`readJson` size cap), zod schemas (field caps), `src/latex/queue.ts` (waiting cap + test), `src/app/api/compile/route.ts`, `src/latex/compile.ts` (slot → runAs user), `Dockerfile`, `docker/sudoers-latex`, `scripts/smoke-image.sh`, `src/lib/auth.ts` (sign-in per-IP rule).

- [x] **Step 1: Rate limiter.**

```ts
export function createRateLimiter(opts: { capacity: number; refillPerSecond: number }) { /* token bucket per key, Map<string, {tokens, updatedAt}>, prune entries idle > 1 h */
  return { take(key: string, now = Date.now()): { ok: true } | { ok: false; retryAfterSeconds: number } }
}
```

Instances in `src/lib/limits.ts` (as built; the spec lists them): tailor 10/h per user, chat 30/10 min, compile 60/10 min, bank writes 120/10 min, resume saves 120/10 min, new resumes 30/10 min, adStart 20/h, data exports 5/h; magic links 5/h and verifications 20/h per IP through Better Auth. Applied only when `policy.limited` (hosted mode). 429 body `{ error, details: { retryAfter } }`; UI countdown on the tailor form and chat.

- [x] **Step 2: Sizes.** `readJson(request, maxBytes = 1_000_000)`: check `content-length` and also count while reading the text; 413 on excess. zod caps: job description 20_000, company 200, bullet text 600, summary 2_000, chat message 4_000, messages ≤ 20, bank serialised ≤ 300_000 bytes (check in the bank route), applications per account ≤ 200 (count before create; 409 with a clear message).

- [x] **Step 3: Queue cap.** `createQueue(limit, { maxWaiting = 8 })`: when `waiting.length >= maxWaiting` reject with `AppError("Server busy, try again in a moment", 503)`; compile route sets `Retry-After: 10`. `run(job)` now passes the slot index `(0..limit-1)` to the job: `queue.run((slot) => compileTex(tex, { runAs: slotUser(slot) }))` where `slotUser` = `LATEX_RUN_AS` unset → undefined; set to `tex` → `tex${slot + 1}`. Tests.

- [x] **Step 4: Per-slot users.** Dockerfile: create `tex1`, `tex2` (as many as `COMPILE_SLOTS`, default 2, build arg) each with its own group `texrun1`, `texrun2`; node in all; `/var/lib/compile` stays 2710 node:texrun1? No: compile dirs are created by node and `chgrp`'d to the slot's group (node is a member) then chmod 2770 — do that in `compileTex` when `runAs` is set (group name = `texrun` + slot number, or pass `group` alongside `runAs`). sudoers: `node ALL=(tex1,tex2) NOPASSWD: /usr/bin/timeout`. Update `env.ts` validation (`LATEX_RUN_AS` is now a prefix) and the health probe (`tex1`). Smoke script: assert `tex1` cannot read a dir owned by group `texrun2` and that two concurrent compiles succeed.

- [x] **Step 5: Sign-in limit.** Better Auth `rateLimit.customRules` for `/sign-in/magic-link`: 5 per hour per IP (check the option shape in `node_modules/better-auth`), in addition to our per-email throttle.

- [x] **Step 6: Verify** (unit, e2e, `bash scripts/smoke-image.sh`) and commit `feat: rate limits, request caps, queue cap and per-slot TeX users`.

---

### Task 6: Security headers and CSP

**Files:** `next.config.ts` (static headers), `src/proxy.ts` (nonce + CSP), `src/ads/csp.ts` (+ test), `src/app/layout.tsx` (nonce read via `headers()` for any inline scripts; none expected), `src/ui/ads/providers.ts` (Google script tags will use the nonce in 2b).

- [x] **Step 1:** `next.config.ts` `headers()`: `Strict-Transport-Security: max-age=31536000; includeSubDomains`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()` on `/(.*)`.
- [x] **Step 2:** `src/proxy.ts`: generate a nonce per request (per the Next CSP guide), set `x-nonce` on the request headers and `Content-Security-Policy` on both request and response: `default-src 'self'; script-src 'self' 'nonce-…' 'strict-dynamic' (+ 'unsafe-eval' in dev); style-src 'self' 'unsafe-inline' (Tailwind v4 injects no inline styles in prod, verify; keep `'unsafe-inline'` only if needed and say so); img-src 'self' blob: data:; font-src 'self'; connect-src 'self'; frame-src 'self' (PDF preview iframe is same-origin blob: add `blob:`); object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`. `src/ads/csp.ts` returns the extra Google sources (script-src, frame-src, img-src, connect-src) merged only when `AD_PROVIDER=google`. Verify in the browser (dev on 3001) that sign-in, bank editing, auto-compile preview and download work with no CSP violations in the console; verify `next build` + `next start` locally too (prod CSP without unsafe-eval). The PDF preview iframe uses a `blob:` URL: ensure `frame-src blob:`.
- [x] **Step 3:** Tests: a proxy test asserting the CSP header is present and contains the nonce; `csp.ts` unit test. Smoke script asserts the headers on `/signin`.
- [x] **Step 4:** Commit `feat: security headers and a nonce-based content security policy`.

---

### Task 7: Account page and admin page

**Files:** `src/app/(app)/account/page.tsx` (+ client component), `src/app/api/account/export/route.ts`, `src/app/api/account/delete/route.ts`, `src/app/(app)/admin/page.tsx`, `src/app/api/admin/summary/route.ts`, `src/app/api/admin/pause/route.ts`, `src/lib/http.ts` (`requireAdmin`), `src/ui/TopBar.tsx` (Account link; Admin link for admins), tests, e2e.

- [x] Account: shows email, plan, credits, the last 50 ledger rows (kind, amount, date), "Download my data" (JSON: bank, applications without PDFs, ledger; `Content-Disposition: attachment`), "Delete my account" (type the email to confirm → `POST /api/account/delete` → `getAuth().api` revoke sessions, delete the `user` row (cascades to the bank, resumes, plan and sign-ins; the ledgers keep their rows with `user_id` set null, see `src/account/delete.ts`), `forgetChats()`, `location.replace("/")`). Route tests: export shape; delete removes every row for that user and nothing for another user (PGlite).
- [x] Admin: `requireAdmin` (signed in and email in `ADMIN_EMAILS`; the plan does not matter); summary: today's and month's `usage_events` totals (cost by model, count by kind, free vs not), credits granted/spent today, ad sessions by status today, `paused` state and budget; a Pause/Resume button writing `settings('free_paused')`. Non-admins get 404 (not 403) for `/admin`.
- [x] E2E: export downloads JSON with the seeded bank; delete signs out and the magic link for that email creates a fresh empty account.
- [x] Commit `feat: account export and deletion, admin usage page`.

---

### Task 8: Public pages and the dashboard move

**Files:** `src/app/(public)/page.tsx` (landing), `src/app/(public)/privacy/page.tsx`, `terms`, `cookies` (markdown-ish static TSX or `.md` rendered with a tiny component), `src/app/(app)/dashboard/page.tsx` (moved from `(app)/page.tsx`), `src/proxy.ts` PUBLIC (`/`, `/cookies`, `/api/ads/ssv`), `src/ui/TopBar.tsx` links, `src/ui/signin/*` default `next` → `/dashboard`, `src/app/(public)/signin/page.tsx` redirect target, e2e expectations, `public/sample-resume.png` (render `data/example` to PNG with `pdftoppm` at build time of the task; commit the PNG, ~150 KB).

- [x] Landing content (the owner's voice; keep it short, no marketing fluff): headline "Job hunting is hard. Tailor your resume to every job in minutes."; one paragraph: built this for myself, free to use, ads pay for the AI, open source so you can self-host; "How it works" three steps; the sample image; "Credits" explainer (1 ad ≈ 1 credit, 2 credits per tailored resume, Haiku model); sign-in CTA; footer links: GitHub, Privacy, Terms, Cookies. Signed-in visitors to `/` → `redirect("/dashboard")`.
- [x] Privacy/terms/cookies: template-grade text naming the processors (Anthropic, Neon, Fly.io, Resend, Google Ad Manager), what is stored (bank, applications, PDFs, ledger, usage tokens; no resume content in logs), retention (until deletion), rights (export/delete on the account page), contact email from `env.EMAIL_FROM`'s domain (`PRIVACY_CONTACT_EMAIL` setting), ads and consent (phase 2b wording included but marked as applying when ads are enabled), UK GDPR basis. Mark clearly in the runbook that these are templates to be checked.
- [x] Commit `feat: landing, privacy, terms and cookies pages; dashboard at /dashboard`.

---

### Task 9: Open source, docs, runbook, final checks

**Files:** `LICENSE` (the verbatim AGPL-3.0 text, declared as AGPL-3.0-only; the copyright line, with the owner's name, goes in the README's Licence section), `CONTRIBUTING.md`, `SECURITY.md`, `README.md` (self-host section: `APP_MODE=selfhost`, own key, Docker one-liner, or `npm run dev`; hosted section pointing to the runbook; "why ads" paragraph), `docs/runbook.md` (new settings, launch checklist: set `SIGNUP_GRANT_CREDITS`, `FREE_DAILY_BUDGET_GBP`, `ADMIN_EMAILS`, remove `SIGNUP_EMAILS`; Ad Manager application steps for 2b; what to watch on `/admin`), `.env.example`, `scripts/smoke-image.sh` (landing public, headers, per-slot users), plan/spec touch-ups.

- [x] Replace personal `data/` folder names with `data/<slug>` across docs; grep for the owner's name outside `LICENSE` and the specs' author lines.
- [x] Full gates: unit, e2e (hosted + selfhost projects), smoke image. Push `feat/phase-2-ads-launch` and report the compare URL.
- [x] Commit `docs: AGPL-3.0 licence, self-host guide, contributing and security policy`.

Phase 2a exit: on a fresh deploy with `SIGNUP_GRANT_CREDITS=4`, `AD_PROVIDER=none`, `ADMIN_EMAILS` set, a stranger signs up, gets 4 credits, tailors twice on Haiku, hits the credit wall with an honest "ads coming soon" message, exports and deletes their account; the owner sees the spend on `/admin`; the repository carries the licence and self-host guide.

**Exit status (2026-10-29):** built on `feat/phase-2-ads-launch` and covered by the unit tests and both e2e projects
(hosted with the test ad provider, and selfhost); the repository carries the licence, self-host guide, contributing
guide and security policy. Still open: the run on the live site, which is the runbook's "Phase 2a launch checklist".
Moved to phase 2b (listed in the spec's "Phases"): the Google provider and consent, the SSV ad-unit check, refetching
the SSV keys on an unknown key id, verified grants without the minimum watch time, and the report-only CSP rollout
with a `/api/csp-report` endpoint.

**Final review fixes (2026-10-29):** the chat's `applicationId` must be a well-formed id and is read from the account
before charging (an unknown one is a free 404); free calls are capped at `FREE_CALLS_IN_FLIGHT` (default 4, 503 beyond)
and each account at `FREE_DAILY_COST_PER_ACCOUNT_GBP` of free usage a day (default £0.10, 402 `reason: "account"`);
`.dockerignore` leaves out `.next-e2e`, `coverage` and `*.tsbuildinfo`; `AD_PROVIDER=google` refuses to boot in
production until phase 2b; an account from before plans gets the sign-up grant when its plan row is created; verified
ad callbacks may grant sessions up to 24 hours old; an export left unread for 60 s is ended and gives its slot back.
