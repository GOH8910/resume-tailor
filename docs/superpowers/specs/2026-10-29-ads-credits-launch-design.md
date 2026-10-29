# Phase 2 — ad-funded credits, public launch, open source

Date: 2026-10-29. Builds on `2026-10-28-hosted-resume-tailor-design.md` (phase 1, merged in PR #2).
Phase 1 left a hosted, signed-in app on Fly.io with an invite-only sign-up. This phase makes it
safe to open to everyone, funds free usage with rewarded ads, and publishes the code under AGPL-3.0
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
| Pro | Deferred. `users.plan` is `free` or `unlimited`; `unlimited` is set by hand for `ADMIN_EMAILS` (the operator) and later by payments. |
| Ad network | Google Ad Manager rewarded ads for web through the Google Publisher Tag, behind an `AdProvider` interface with `none` and `test` providers. Google confirms rewarded web ads on desktop, mobile and tablet, reward after 7 s in view or video completion, and offers server-side verification (SSV) for web. |
| Consent | Google's Privacy & messaging (a certified consent tool) for UK/EEA users; without consent, non-personalised ads. |
| Launch gap | `SIGNUP_GRANT_CREDITS` (default 0). Recommended 4 at launch until the ad unit is approved, then back to 0. |
| Licence | AGPL-3.0. |
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
| `FREE_MODEL` | `claude-haiku-5-5` | model for free accounts |
| `UNLIMITED_MODEL` | `claude-sonnet-5-5` | model for unlimited accounts (the operator can still pick Opus) |

Worst case for an account that fakes every ad view: 10 credits/day = 5 Haiku tailors ≈ 1p/day.
Worst case for an IP farm: 30 credits/day per IP. The daily budget caps the total regardless.

## Modes and plans

`APP_MODE` is `hosted` or `selfhost` (`src/lib/env.ts`; default `selfhost` outside production,
`hosted` in production unless set). In `selfhost` mode: the ad provider is `none`, credits are never
checked or charged, limits are off, sign-up is open, the tailor form shows the model picker as today.
In `hosted` mode: credits apply to `free` accounts, limits apply to everyone, the model is set by plan.

`users.plan` (`free` | `unlimited`). On sign-up, an email listed in `ADMIN_EMAILS` gets `unlimited`;
everyone else `free`. `src/billing/plan.ts` is the single table of what a plan allows: model, whether
credits are charged, whether ads show.

## Credits ledger

Tables (Drizzle, migration added to `drizzle/`):

| Table | Columns | Notes |
| --- | --- | --- |
| `credit_events` | id (uuid), user_id (fk set null), kind (`ad` / `signup` / `tailor` / `chat` / `admin` / `refund`), amount (int, signed), ref (text, null: ad session id, application id, or the refunded charge's row id), created_at | Append-only ledger. The balance is `sum(amount)`; `user_plans.credits` caches it and is updated in the same transaction. Kept anonymised when the account is deleted. |
| `ad_sessions` | id (uuid), user_id (fk set null), ip (text), provider (text), started_at, granted_at (null), status (`started` / `granted` / `rejected`), reject_reason (text, null), transaction_id (text, null, unique) | One row per ad attempt. SSV callbacks name the session in `custom_data`; the unique transaction_id stops a replayed callback. Kept when the account is deleted, so the per-IP cap still counts it. |
| `usage_events` | id, user_id (fk), kind (`tailor` / `chat` / `seed`), model, input_tokens, output_tokens, cost_gbp (numeric), created_at | Every Claude call. Feeds the budget and the admin page. |

Flow for a free account:

1. The tailor form shows the balance and "Watch an ad (+1 credit)" when the balance is below the
   cost. `POST /api/ads/start` creates an `ad_sessions` row (checks the per-account and per-IP daily
   caps first → 429 with the reset time) and returns `{ sessionId }`. The client shows the ad through
   the provider.
2. On the provider's granted event the client calls `POST /api/ads/grant { sessionId }`. The server
   checks: session belongs to the user, status `started`, `now - started_at ≥ AD_MIN_WATCH_SECONDS`,
   caps still hold; then in one transaction marks it `granted`, inserts a `credit_events` row (+1) and
   bumps `users.credits`. Otherwise `rejected` with a reason and 409.
3. When SSV is configured (`AD_SSV_ENABLED`), `POST /api/ads/ssv` receives Google's callback,
   verifies the signature against Google's published keys, and is the only path that grants; the
   client's `grant` then just polls the session status. Until then, step 2 grants directly, bounded by
   the caps.
4. `POST /api/tailor` for a free account: refuse with 402 `{ error, credits, needed }` when the
   balance is short or the daily budget is exhausted (`{ paused: true, resumesAt }`); otherwise charge
   the credits in a transaction, run the tailor on `FREE_MODEL`, record `usage_events`; if Claude fails
   the charge is refunded in the same request. Chat works the same per message.

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

Security headers (`next.config.ts` headers): HSTS, nosniff, `X-Frame-Options: DENY`, Referrer-Policy,
Permissions-Policy. CSP via `src/proxy.ts` with a per-request nonce for our scripts; the Google
allowances (`securepubads.g.doubleclick.net`, `pagead2.googlesyndication.com`,
`fundingchoicesmessages.google.com`, `tpc.googlesyndication.com`, `*.googlesyndication.com`,
`*.doubleclick.net`, `www.googletagservices.com`, `frame-src` for the ad iframes) are added only in
`hosted` mode with Google configured, from one list in `src/ads/csp.ts`. Read the Next CSP guide in
`node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md` before implementing.

## Limits and hardening (hosted mode)

- Burst limits, in-memory per machine (`src/lib/rate-limit.ts`, token buckets keyed by user id or
  IP): tailor 10/hour, chat 30/10 min, compile 30/10 min, bank writes 60/10 min, ad start 20/hour,
  magic link 5/hour per IP (spec'd in phase 1, not yet enforced beyond Better Auth's 5/min).
  Responses: 429 with `retryAfter` seconds; the UI shows a countdown.
- Request size: 1 MB JSON body cap in `readJson`; field caps in the zod schemas: job description
  20k chars, bullet 600, summary 2k, bank 300 KB serialised, applications per account 200.
- Compile queue: at most 8 waiting; beyond that 503 with `Retry-After: 10`.
- One TeX uid and group per compile slot (`tex1`, `tex2`; `COMPILE_CONCURRENCY` ≤ number of users
  created in the image), closing the phase 1 residual risk.
- Fly runs one machine (`--ha=false`); all in-memory limits assume it.

## Account page

`/account`: email, plan, credits balance and the last 50 ledger entries, "Download my data"
(`GET /api/account/export`: bank + applications without PDFs + ledger), "Delete my account" (type the
email; cascades through all tables; sessions revoked; sign-out). Admin accounts also see `/admin`:
today's and this month's costed usage, credits granted/spent, ad sessions by status, the budget state,
and a manual "pause free usage" toggle (`settings` table, one row).

## Public pages

- `/` landing page (public): the pitch in Edward's words ("job hunting is hard; I built this for
  myself; it's free, ads pay for it; you can self-host it"), how it works in three steps, a sample
  PDF image, the ads explanation ("one ad ≈ one credit, two credits per tailored resume"), sign-in
  button, links to GitHub, privacy and terms. Signed-in visitors see the dashboard at `/` as now.
- `/privacy`, `/terms`, `/cookies` (static, template-grade, naming Anthropic, Neon, Fly.io, Resend,
  Google Ad Manager as processors, the credits/ads mechanics, the ledger retention, and the right to
  export/delete). Not legal advice.
- `src/proxy.ts` PUBLIC gains `/`, `/cookies`, `/api/ads/ssv`.

## Open source

- `LICENSE` (AGPL-3.0), `README.md` with a "Self-host" section (`APP_MODE=selfhost`, own Anthropic
  key, Docker image or `npm run dev`, no ads), `CONTRIBUTING.md` (short), `SECURITY.md` (how to report;
  no bounty). `docs/` keeps the specs and runbook; personal paths like `data/edward` become
  `data/<slug>`.
- Nothing in the repo may depend on the operator's identity except through environment variables.

## Error handling

Every error body is `{ error, details }` (`handle()` in `src/lib/http.ts`), so the 402s are
`{ error: "Not enough credits", details: { credits, needed } }` when credits are short and
`{ error, details: { paused: true, reason, resumesAt } }` while free usage is paused (checked before any
charge). Limits → 429 with `retryAfter`; the daily ad cap → 429 `{ error, details: { reason: "account" | "ip",
resetsAt } }`; ad grant rejected → 409 with a reason the UI can show ("ad closed too early" →
`details.reason: "watched too briefly"`, or "Ad session is not pending"). Claude failure after charging → the
charge is refunded in the same request, any usage Anthropic billed is still recorded, and the client gets the
original error (502 for a refused or unparseable reply). Usage and token counts never appear in `details`.
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
- **2b:** Google Ad Manager provider, Privacy & messaging consent, SSV; switch `SIGNUP_GRANT_CREDITS`
  to 0. Needs Edward's Ad Manager account approved and an ad unit created.

## Things only Edward can do

- Apply for Google Ad Manager (needs an AdSense account and the live site with the landing, privacy
  and terms pages up); create the rewarded ad unit; set up Privacy & messaging; copy the ad unit path
  and, if used, the SSV key configuration.
- Decide `SIGNUP_GRANT_CREDITS` at launch and `FREE_DAILY_BUDGET_GBP`.
- Add `LICENSE` acceptance to the repository settings if desired; write the landing copy in his own
  words (a draft is provided).

## Risks

- Rewarded web demand may be thin for a resume tool (most networks target games); revenue could be
  near zero for a while. The budget and caps make that a bounded loss, and the signup grant can be set
  to 0 to stop all free spend.
- Google may reject the site or disable the ad unit; the `none` provider keeps the site working.
- SSV details for web are documented behind a section we could not fetch; the design tolerates no
  SSV (caps) and adopts it when available.
- Consent refusal (common in the UK) lowers ad rates; already assumed in the low-end numbers.
