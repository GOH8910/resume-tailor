# Phase 2 — ad-funded credits, public launch, open source

Date: 2026-10-29. Builds on `2026-10-28-hosted-resume-tailor-design.md` (phase 1, merged in PR #2).
Phase 1 left a hosted, signed-in app on Fly.io with an invite-only sign-up. This phase makes it
safe to open to everyone, funds free usage with rewarded ads, and publishes the code under AGPL-3.0-only
so anyone can self-host.

## Goals

- Anyone can sign up and tailor resumes without paying money: they watch a rewarded ad per credit
  and spend credits on tailoring and chat.
- The operator cannot lose money by accident: every Claude call is costed, free usage runs on the
  cheapest model, abuse is bounded per account, per IP and per day, and a global daily budget pauses
  free usage when exceeded.
- Lawful public operation: privacy and terms pages, cookie consent for ads, account export and
  deletion, security headers.
- The same code runs as a self-hosted single-user tool with no ads, credits or limits.

Not in this phase: the paid Pro tier and Lemon Squeezy (deferred until there are users; the code keeps
a `plan` column so it can be added without a migration of user data), analytics, email receipts.

## Decisions

| Question | Decision |
| --- | --- |
| Free usage | Earned with rewarded ads: 1 completed ad = 1 credit. A tailor costs `CREDITS_PER_TAILOR` (default 2), a chat message `CREDITS_PER_CHAT_MESSAGE` (default 1). Both are settings, not code. |
| Model for free usage | Claude Haiku 5.5 (`claude-haiku-5-5`), chosen server-side. Users do not pick a model. |
| Pro | Deferred. `user_plans.plan` is `free` or `unlimited`; `unlimited` is set by hand for `ADMIN_EMAILS` (the operator) and later by payments. |
| Ad network | Google Ad Manager rewarded ads for web through the Google Publisher Tag, behind an `AdProvider` interface with `none` and `test` providers. Google confirms rewarded web ads on desktop, mobile and tablet, reward after 7 s in view or video completion, and offers server-side verification (SSV) for web. |
| Consent | Google's Privacy & messaging (a certified consent tool) for UK/EEA users; without consent, non-personalised ads. |
| Launch gap | `SIGNUP_GRANT_CREDITS` (default 0). Recommended 4 at launch until the ad unit is approved, then back to 0. |
| Licence | AGPL-3.0-only. |
| Self-host | `APP_MODE=selfhost`: no ads, no credits, no limits, open sign-up, operator picks the model. Default in development. |

## Economics

Per tailor: ~10k input + ~2.5k output tokens. Costs (Oct 2026 list prices): Haiku 5.5 $0.10/$0.50
per million → about $0.0023 (0.2p); Sonnet 5.5 $2/$10 → about $0.045 (3.5p); Opus 5.5 $4/$20 →
about $0.09 (7p). A completed rewarded ad view on the web nets roughly $0.004–$0.010 (0.3p–0.8p)
after the network's share and geography. With Haiku and 2 credits per tailor the margin is positive
even at the low end; with 1 credit it is roughly break-even. Chat messages cost about 0.1–0.2p each
on Haiku.

Loss bounds, all settings with these defaults:

| Setting | Default | Purpose |
| --- | --- | --- |
| `CREDITS_PER_TAILOR` | 2 | ads per tailor |
| `CREDITS_PER_CHAT_MESSAGE` | 1 | ads per chat message |
| `AD_CREDITS_PER_ACCOUNT_PER_DAY` | 10 | cap on ad-earned credits per account per UTC day |
| `AD_CREDITS_PER_IP_PER_DAY` | 30 | cap per client IP per day |
| `AD_MIN_WATCH_SECONDS` | 7 | server-side minimum between ad start and grant |
| `SIGNUP_GRANT_CREDITS` | 0 | credits a new account starts with |
| `FREE_DAILY_BUDGET_GBP` | 2.00 | when the day's costed free usage reaches (>=) this, free tailoring and chat pause until the next UTC day |
| `FREE_DAILY_COST_PER_ACCOUNT_GBP` | 0.10 | the same per account: once one account's costed free usage today reaches this, its free calls answer 402 (`reason: "account"`) until the next UTC day |
| `FREE_CALLS_IN_FLIGHT` | 4 | free Claude calls running at once across the server (in memory); beyond it a free call answers 503 `{ retryAfter: 5 }` |
| `FREE_MODEL` | `claude-haiku-5-5` | model for free accounts |
| `UNLIMITED_MODEL` | `claude-sonnet-5-5` | model for unlimited accounts (the operator can still pick Opus) |

Worst case for an account that fakes every ad view: 10 credits/day = 5 Haiku tailors ≈ 1p/day.
Worst case for an IP farm: 30 credits/day per IP. The daily budget caps the total regardless.

The budget and the per-account cap are checked before each call, not atomically with it, so calls already running
can overshoot them; `FREE_CALLS_IN_FLIGHT` bounds by how much. The largest free call (about 1 MB of prompt, some
250k tokens at Haiku's long-context rate, plus 16k output tokens) costs about £0.13, so a day's free spend stays under
about £2 + 4 × £0.13 ≈ £2.52, and one account's under about £0.10 + 4 × £0.13. Unlimited accounts are bounded only by
the rate limits and the Anthropic console's monthly spend limit, which the operator must set.

## Modes and plans

`APP_MODE` is `hosted` or `selfhost` (`src/lib/env.ts`; default `selfhost` outside production,
`hosted` in production unless set). In `selfhost` mode: the ad provider is `none`, credits are never
checked or charged, limits are off, sign-up follows `SIGNUP_EMAILS` as in hosted mode, the tailor form shows
the model picker as today.
In `hosted` mode: credits apply to `free` accounts, limits apply to everyone, the model is set by plan.

`user_plans` holds each account's plan (`free` | `unlimited`) and cached credit balance, one row per account. On
sign-up, an email listed in `ADMIN_EMAILS` gets `unlimited`; everyone else `free` and `SIGNUP_GRANT_CREDITS`. An
account from before plans existed gets the same on its first request (`accountPlan` in `src/lib/http.ts`: its plan,
and the sign-up grant when free, once). `src/billing/plan.ts` is the single table of what a plan allows: model,
whether credits are charged, whether ads show.

## Credits ledger

Tables (Drizzle, migration added to `drizzle/`):

| Table | Columns | Notes |
| --- | --- | --- |
| `credit_events` | id (uuid), user_id (fk set null), kind (`ad` / `signup` / `tailor` / `chat` / `admin` / `refund`), amount (int, signed), ref (text, null: ad session id, application id, or the refunded charge's row id), created_at | Append-only ledger. The balance is `sum(amount)`; `user_plans.credits` caches it and is updated in the same transaction. Kept anonymised when the account is deleted. |
| `ad_sessions` | id (uuid), user_id (fk set null), ip (text), provider (text), started_at, granted_at (null), status (`started` / `granted` / `rejected`), reject_reason (text, null), transaction_id (text, null, unique) | One row per ad attempt. SSV callbacks name the session in `custom_data`; the unique transaction_id stops a replayed callback. Kept when the account is deleted, so the per-IP cap still counts it. `ip` is blanked (`''`) once the row is 48 hours old, at boot, every hour and at each ad start (in batches that skip rows another transaction holds); the cap only counts today. A session can be granted only within an hour of starting, or a day for a verified (SSV) callback (later: rejected "expired", 409 "not pending"), so a grant never counts against the blanked IP. |
| `usage_events` | id, user_id (fk), kind (`tailor` / `chat` / `seed`), model, input_tokens, output_tokens, cost_gbp (numeric), created_at | Every Claude call. Feeds the budget and the admin page. |

Flow for a free account:

1. The tailor form shows the balance and "Watch an ad (+1 credit)" when the balance is below the
   cost. `POST /api/ads/start` creates an `ad_sessions` row (checks the per-account and per-IP daily
   caps first → 429 with the reset time) and returns `{ sessionId }`. The client shows the ad through
   the provider.
2. On the provider's granted event the client calls `POST /api/ads/grant { sessionId }`. The server
   checks: session belongs to the user, status `started`, `now - started_at ≥ AD_MIN_WATCH_SECONDS`,
   caps still hold; then in one transaction marks it `granted`, inserts a `credit_events` row (+1) and
   bumps `user_plans.credits`. Otherwise `rejected` with a reason and 409.
3. When SSV is configured (`AD_SSV_ENABLED`), `POST /api/ads/ssv` receives Google's callback,
   verifies the signature against Google's published keys, and is the only path that grants; the
   client's `grant` then just polls the session status. Until then, step 2 grants directly, bounded by
   the caps.
4. `POST /api/tailor` for a free account: refuse with 402 when free usage is paused for everyone (daily budget,
   operator) or for the account (`FREE_DAILY_COST_PER_ACCOUNT_GBP`), then with 503 when `FREE_CALLS_IN_FLIGHT`
   free calls are already running, then with 402 `{ error, credits, needed }` when the balance is short;
   otherwise charge the credits in a transaction, run the tailor on `FREE_MODEL`, record `usage_events`; if
   Claude fails the charge is refunded in the same request. Chat works the same per message. A chat about an open
   resume names its application (`applicationId`, a well-formed id), which is read from the account before
   anything is charged, so an unknown one is a free 404.

## Ad provider

`src/ads/provider.ts` defines `AdProvider` with `name`, `isConfigured()`, server options for the
client (ad unit path, SSV flag) and a client component contract: `showRewardedAd({ onGranted, onClosed,
onError })`. Implementations:

- `google` (`src/ads/google.tsx`): loads the Google Publisher Tag, defines a rewarded out-of-page slot
  (`AD_UNIT_PATH`), listens for `rewardedSlotReady` (calls `makeRewardedVisible()`),
  `rewardedSlotGranted`, `rewardedSlotClosed`; sets the ad session id as the slot's targeting/custom
  data so SSV callbacks can be matched. Only loaded on the client for `hosted` mode with Google
  configured.
- `none`: no ad button; `isConfigured()` false. Used by self-host, dev and when Google is not yet
  approved (the UI then says ads are not available yet and shows the signup-grant balance).
- `test`: a fake modal that "plays" for 8 s and then grants. Used by Playwright.

Consent: Google's Privacy & messaging script is loaded with the GPT on the pages that can show ads
(tailor, review, bank). Its consent state is what the GPT reads; we do not store consent ourselves.
The cookie notice page explains it.

Security headers (`next.config.ts` headers, every path): `Strict-Transport-Security: max-age=31536000;
includeSubDomains` (production builds only), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`.
CSP via `src/proxy.ts` with a per-request nonce (`Buffer.from(crypto.randomUUID()).toString("base64")`), set on the
response and on the request (`Content-Security-Policy` and `x-nonce`) so Next puts it on its scripts; the root
layout calls `connection()` so every page renders per request and gets it. `buildCsp` in `src/ads/csp.ts` produces:

- `default-src 'self'`
- `script-src 'self' 'nonce-…' 'strict-dynamic'` (+ `'unsafe-eval'` under `next dev`)
- `style-src 'self' 'nonce-…'` in production; `'self' 'unsafe-inline'` under `next dev`, whose overlay injects
  `<style>` elements without the nonce. Production pages emit no inline styles (checked with `next build && next
  start`; Next's default 404 and error pages, which do, are replaced by `src/app/not-found.tsx`, `error.tsx` and
  `global-error.tsx`).
- `img-src 'self' blob: data:`, `font-src 'self'`, `connect-src 'self'`
- `frame-src 'self' blob:` (the PDF preview iframe)
- `object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`
- `upgrade-insecure-requests` when `BETTER_AUTH_URL` is https (`upgradeInsecure`)

With `AD_PROVIDER=google` in `hosted` mode (`env.adProvider`), one list in `src/ads/csp.ts` adds the Google hosts:
`script-src` gets `securepubads.g.doubleclick.net`, `pagead2.googlesyndication.com`,
`fundingchoicesmessages.google.com` and `www.googletagservices.com` (read only by CSP2 browsers; elsewhere
`'strict-dynamic'` trusts the tag that our nonce'd code inserts); `frame-src`, `img-src` and `connect-src` get
`*.doubleclick.net`, `*.googlesyndication.com` and `fundingchoicesmessages.google.com`. Phase 2b does not enforce
these lists at first: it enforces a loose ad policy (`https:` in `img-src`, `frame-src` and `connect-src`) and sends
the tight lists as `Content-Security-Policy-Report-Only` to a `/api/csp-report` endpoint (public, size-capped,
rate-limited, log-only), with `style-src`, `font-src` and `media-src` covered in the report-only policy too, then
tightens the enforced policy once the reports are clean. Zod's eval probe is switched off in the browser
(`src/instrumentation-client.ts`, `jitless`) so it does not report a violation. Next's own static 500 page
(`.next/server/app/_global-error.html`, built from its internal `app-error` component, not from `global-error.tsx`)
keeps its inline styles; it is served only when a request fails outside rendering, and then shows unstyled. A failing
root layout renders `global-error.tsx` per request, with the nonce. Read the Next CSP guide in
`node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md` before changing the policy.

## Limits and hardening (hosted mode)

- Burst limits, in-memory per machine (`src/lib/rate-limit.ts` token buckets, named in `src/lib/limits.ts`,
  keyed by user id), applied in hosted mode only: tailor 10/hour, chat 30/10 min, compile 60/10 min (the
  queue protects the CPU), bank writes 120/10 min, resume saves 120/10 min, new resumes 30/10 min, ad start
  20/hour, data exports 5/hour. Buckets start full, so a first window allows up to about 2× the figure. Magic
  links 5/hour and verifications 20/hour per IP through Better Auth's `rateLimit.customRules` (production only, replacing the
  magic-link plugin's 5/min), alongside the per-email throttle. Responses: 429 `{ error, details: { retryAfter }
  }` (seconds) plus a `Retry-After` header; the tailor form and the chat show a countdown, the bank editor and
  the review screen keep the edit and save it again after the wait ("Saving again in N s"), and the preview
  retries a compile once.
- Per-IP keys (the ad caps): IPv6 addresses count by their /64.
- Request size, in every mode: 1 MB JSON body cap in `readJson` (413, counted while reading); field caps in
  the request schemas (stored data is read uncapped): job description 20k chars, company and role title 200,
  bullet 600, summary 2k, chat message 4k (Claude's replies in the history 16k), at most 20 messages and 40k
  characters per chat request, bank 300 KB and one resume 700 KB serialised (UTF-8 bytes; 413; the resume cap
  covers saves, compiles and chat, and is 2 × the bank cap + 100 KB because a full-bank resume stores each bullet
  twice), applications per account 200 (409). A 400 names the first problem
  (`field.path: message`).
- Caps where the server writes, so the API never refuses data it stored: chat's bank and resume changes skip
  over-cap text with a warning, an over-cap tailored rewrite or summary falls back to the bank's text with a
  warning, and the seed and import scripts cut text to the caps and list each field cut.
- Compile queue: at most 8 waiting; beyond that 503 `{ details: { retryAfter: 10 } }` with `Retry-After: 10`;
  the review screen says "Server busy, retrying in 10 s" and retries once.
- One TeX uid and group per compile slot (`tex1`/`texrun1`, `tex2`/`texrun2`; `LATEX_RUN_AS` is the user-name
  prefix; `COMPILE_CONCURRENCY` ≤ the `COMPILE_SLOTS` users created in the image, asserted at build time and by
  the health probe, which runs as the last slot's user), closing the phase 1 residual risk.
- Fly runs one machine (`--ha=false`); all in-memory limits assume it.

## Account page

`/account` (every signed-in account, linked from the top bar and its credits pill): email, plan ("Free" /
"Unlimited", "Self-hosted" in selfhost mode) and model; for accounts that pay in credits, the balance, what a
tailor and a chat message cost, and the last 50 ledger rows (`GET /api/account/credits` →
`{ credits, events: [{ kind, amount, ref, createdAt }] }`, kinds in words: "Ad watched", "Welcome credits",
"Tailor", "Chat message", "Refund", "Adjustment").

- "Download my data": `GET /api/account/export` (5/hour per account in hosted mode) answers a JSON attachment,
  `resume-tailor-export.json`: `{ exportedAt, email, profile { name, image, createdAt }, plan { plan, credits },
  signIns [{ providerId, accountId, createdAt }], sessions [{ createdAt, expiresAt, ipAddress, userAgent }], credits
  (the whole ledger), adSessions [{ startedAt, grantedAt, status, rejectReason, ip }], usage [{ kind, model, tokens,
  costGbp, createdAt }], bank, applications }`, with no tokens and no PDFs (they compile again from the JSON). It is
  streamed: everything but the applications is read first (so a failure there is an ordinary error response), then
  the applications in keyset batches of 10 as the stored JSON text, never parsed. One export runs per account at a
  time (409 "An export is already running") and two across the server (503 with `retryAfter: 10`). A download the
  browser stops reading for 60 s is ended (the stream errors), which gives its slot back; the server logs that once,
  without the account.
- "Delete my account": the user types the account's email; `POST /api/account/delete { email }` answers 400 on a
  mismatch. In one transaction the server locks the account's `ad_sessions` rows and then its `user_plans` row (the
  order an ad grant takes them, so a grant in flight and the deletion cannot deadlock), deletes its sessions and then
  the `user` row, which cascades to `banks`, `applications`, `user_plans` and `account`; `credit_events`,
  `ad_sessions` and `usage_events` keep their rows with `user_id` set null. Before that, in the same transaction, the
  tailor and chat ledger rows lose their `ref` (application ids carry the company's name) and the account's ad
  sessions their IP, except today's grants, which the per-IP cap counts until midnight UTC. A call that finishes after
  the deletion books its usage with no account (a foreign-key failure is retried with `user_id` null). The response
  expires the session cookies through Next's cookie store (Better Auth's names and attributes, `Max-Age=0` and an
  `Expires` in 1970); the client forgets its chats and loads `/?deleted=1`, the landing page, which says the account was deleted. Signing in again with the same email creates
  a fresh, empty account (the sign-up grant again: the per-IP ad cap still counts the old account's ads).

`/admin` is for accounts whose email is in `ADMIN_EMAILS`, whatever their plan (`requireAdmin`); any other signed-in
account gets a 404, from the page and from `/api/admin/*`, so the pages are not advertised. It shows today's and this
month's costed usage (UTC; totals, the part paid with free credits, by model and by kind), credits granted and spent
today (spent net of refunds), today's ad sessions by status, the budget (`FREE_DAILY_BUDGET_GBP`, today's free spend,
whether free usage is paused and why), a Pause/Resume switch for free usage (`POST /api/admin/pause { paused }` →
`settings('free_paused')`), and a "Set a plan" form (`POST /api/admin/plan { email, plan }`, 404 when no account uses
the email): `ADMIN_EMAILS` only picks an account's plan at its first use, so this is how the operator promotes or
demotes an account later.

## Public pages

- `/` landing page (public): the pitch in the operator's words ("job hunting is hard; I built this for
  myself; it's free, ads pay for it; you can self-host it"), how it works in three steps, a sample
  PDF image, the ads explanation ("one ad ≈ one credit, two credits per tailored resume"), sign-in
  button, links to GitHub, privacy, terms and cookies. In selfhost mode the credits explanation is one line
  ("This instance is self-hosted: no ads, no credits."). The dashboard moves to `/dashboard`: signed-in visitors
  to `/` (and `/signin`) are redirected there, and it is where signing in goes by default. `/?deleted=1` says
  the account was just deleted.
- `/privacy`, `/terms`, `/cookies` (static, template-grade, naming Anthropic, Neon, Fly.io, Resend,
  Google Ad Manager as processors, the credits/ads mechanics, the ledger retention, and the right to
  export/delete). Not legal advice. The text is data in `src/legal/*.ts`, rendered by
  `src/ui/legal/LegalPage.tsx`; the contact address is `PRIVACY_CONTACT_EMAIL` (required in hosted production,
  elsewhere defaulting to the address in `EMAIL_FROM`). A self-hosted server shows a short notice on each page
  instead: its operator is responsible for the data and sets their own terms. The public pages link the source code
  at `SOURCE_CODE_URL` (default: the upstream repository).
- `src/proxy.ts` PUBLIC gains `/` (an exact match), `/cookies`, `/api/ads/ssv`.

## Open source

- `LICENSE` (AGPL-3.0-only), `README.md` with a "Self-host" section (`APP_MODE=selfhost`, own Anthropic
  key, Docker image or `npm run dev`, no ads), `CONTRIBUTING.md` (short), `SECURITY.md` (how to report;
  no bounty). `docs/` keeps the specs and runbook; personal data paths become
  `data/<slug>`.
- Nothing in the repo may depend on the operator's identity except through environment variables.

## Error handling

Every error body is `{ error, details }` (`handle()` in `src/lib/http.ts`), so the 402s are
`{ error: "Not enough credits", details: { credits, needed } }` when credits are short and
`{ error, details: { paused: true, reason, resumesAt } }` while free usage is paused (checked before any
charge; `reason` is `budget`, `manual`, or `account` for the per-account daily cap, whose message is "You've reached
today's free AI limit for this account; it resets at …"). With `FREE_CALLS_IN_FLIGHT` free calls running, another
free call gets 503 `{ error: "The free AI is busy, try again in a moment", details: { retryAfter: 5 } }`. Limits → 429 `{ error, details: { retryAfter } }` with a `Retry-After` header; the daily ad cap → 429 `{ error, details: { reason: "account" | "ip",
resetsAt } }`; ad grant rejected → 409 with a reason the UI can show ("ad closed too early" →
`details.reason: "watched too briefly"`, or "Ad session is not pending"). Claude failure after charging → the
charge is refunded in the same request, any usage Anthropic billed is still recorded, and the client gets the
original error (502 for a refused or unparseable reply). Usage and token counts never appear in `details`.
Account deletion with an email that is not the account's → 400; `/api/admin/*` for a signed-in non-admin → 404.
All existing phase 1 error semantics stay.

## Testing

- Unit: plan table, credits service (grant/charge/refund in transactions on PGlite, caps per account
  and IP, minimum watch time, day boundaries in UTC), budget calculation from `usage_events`, cost
  estimation per model, rate limiter, request size caps, SSV signature verification against a fixed
  key pair, CSP builder, provider selection by mode.
- Route tests: tailor/chat 402 paths and refund on failure; ads start/grant; account export/delete.
- E2E (hosted mode, test provider): sign up → zero credits → watch test ad → +1 → second ad → tailor
  succeeds → balance 0 → tailor refused with the ad prompt; self-host mode: no ad UI and tailor works
  with no credits.
- Docker smoke: per-slot TeX users; CSP headers present; landing page public; health unchanged.

## Phases

- **2a (this plan):** modes and plans, credits ledger and ads API with `none`/`test` providers, usage
  costing and budget, limits and hardening, account page, admin page, public pages, security headers
  and CSP (with the Google allowances behind a flag), open-source files, README. Exit: a stranger can
  sign up on the live site, receive the signup grant, tailor, hit the credit wall, export and delete
  their account; the test provider proves the earn flow end to end.
  - [x] Built on `feat/phase-2-ads-launch`, with the licence, self-host guide, contributing guide and security
    policy in the repository.
  - [x] Proven by the tests: the sign-up grant, charging and refunds, the credit wall and the daily budget (unit and
    route tests), the test provider's earn flow, export, deletion and the admin page (the hosted e2e project), and
    a self-hosted server with no credits or ads (the selfhost e2e project).
  - [ ] On the live site: a stranger's full run, following the runbook's "Phase 2a launch checklist".
- **2b:** Google Ad Manager provider, Privacy & messaging consent, SSV; switch `SIGNUP_GRANT_CREDITS`
  to 0. Needs the operator's Ad Manager account approved and an ad unit created. Moved here from 2a:
  - the Google provider (`src/ads/google.tsx`) and Privacy & messaging consent. Until then a production server
    refuses to boot with `AD_PROVIDER=google` ("AD_PROVIDER=google is not available yet"); 2b lifts that and requires
    `AD_UNIT_PATH` and `AD_SSV_ENABLED` with it;
  - SSV: checking that a callback names our rewarded ad unit, refetching the key list when a callback names a
    `key_id` the cached list lacks, and granting verified rewards without the minimum watch time (the network has
    verified the view);
  - the CSP rollout for ads: enforce the loose ad policy, send the tight host lists as
    `Content-Security-Policy-Report-Only` to a `/api/csp-report` endpoint, then tighten once the reports are clean.

## Things only the operator can do

- Apply for Google Ad Manager (needs an AdSense account and the live site with the landing, privacy
  and terms pages up); create the rewarded ad unit; set up Privacy & messaging; copy the ad unit path
  and, if used, the SSV key configuration.
- Decide `SIGNUP_GRANT_CREDITS` at launch and `FREE_DAILY_BUDGET_GBP`.
- Add `LICENSE` acceptance to the repository settings if desired; write the landing copy in their own
  words (a draft is provided).

## Risks

- Rewarded web demand may be thin for a resume tool (most networks target games); revenue could be
  near zero for a while. The budget and caps make that a bounded loss, and the signup grant can be set
  to 0 to stop all free spend.
- Google may reject the site or disable the ad unit; the `none` provider keeps the site working.
- SSV details for web are documented behind a section we could not fetch; the design tolerates no
  SSV (caps) and adopts it when available.
- Consent refusal (common in the UK) lowers ad rates; already assumed in the low-end numbers.
