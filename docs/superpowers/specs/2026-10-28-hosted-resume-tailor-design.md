# Hosted Resume Tailor — design

Date: 2026-10-28. Builds on `2026-10-27-resume-tailor-design.md` (the local app), which stays
accurate for the tailoring, review and LaTeX pieces. This spec covers turning that app into a public,
paid web service run by one person from the UK.

## Goals

- Anyone can sign up, build a bullet bank, tailor resumes with Claude and download one-page PDFs.
- A free tier limited enough that Claude usage cannot outrun income, and a Pro subscription that pays
  for everything.
- One deployable unit, cheap to run (about £5/month before Claude usage), with no manual operations
  beyond watching a dashboard.
- Handle other people's resumes lawfully: UK GDPR rights (export, delete), clear privacy terms, data
  kept in the UK.

Not in scope now: ads (an empty, plan-gated slot is built so they can be switched on later), teams,
multiple banks per user, any template other than the Crimson one.

## Decisions already taken

| Question | Decision |
| --- | --- |
| Pricing | Free: 3 tailors/month. Pro: £6/month or £48/year, unlimited tailoring (fair use 300/month) + chat drawer. |
| Payments | Lemon Squeezy as merchant of record (collects UK/EU VAT, issues invoices). |
| Hosting | One Docker image (Next.js + trimmed TeX Live) on Fly.io, London region. |
| Database | Postgres on Neon, London region. PDFs stored in the database (they are ~100 KB each). |
| Sign-in | Google OAuth and email magic links (Resend). No passwords. |
| Ads | Phase 3 only, free tier only, behind a consent banner. |

## What carries over unchanged

- `src/bank`, `src/tailor`, `src/chat`, `src/latex` and `src/applications` schemas, edit helpers,
  prompts, validation and the LaTeX template. The zod schemas become the shape of the `jsonb` columns.
- The review screen, bank editor, tailor form, chat drawer and layout controls.
- `compileTex` (`src/latex/compile.ts`): latexmk with `-norc -no-shell-escape`, 60 s timeout,
  process-group kill.

## What changes

### Identity replaces profiles

Today every API call carries `?profile=<slug>` and the repositories are keyed by slug. In the hosted
app the key is the signed-in user's id, taken from the session on the server. Concretely:

- `requireProfile(request)` in `src/lib/http.ts` becomes `requireUser(request)`, which reads the
  Better Auth session and returns `{ id, email, plan }` or throws a 401 `AppError`.
- `withProfile()` and `ProfileProvider` in `src/ui` are deleted. `TopBar` shows the user's email,
  an Account link and Sign out instead of the profile picker.
- `/api/profiles` is deleted. `scripts/seed-from-pdfs.ts` takes `--email` instead of `--profile`.
- A one-off `scripts/import-local.ts` copies `data/<slug>/bank.json` and its applications into the
  database for a given email, so the owner's existing bank moves over.

### Storage

`src/lib/deps.ts` keeps exporting `banks` and `applications`, now backed by Postgres through Drizzle.
The file-based repositories are deleted; their tests move to the Postgres ones and run against
PGlite (an in-process Postgres), so the test suite still needs no services.

Tables (Drizzle schema in `src/db/schema.ts`, migrations in `drizzle/`):

| Table | Columns | Notes |
| --- | --- | --- |
| `user` | id (text), email (unique), name, image, created_at, plan (`free`/`pro`), plan_until (timestamp, null), ls_customer_id | Better Auth user table plus billing columns. `plan` is derived from subscriptions by the webhook handler; `plan_until` lets a cancelled Pro run to period end. |
| `session`, `account`, `verification` | Better Auth standard | Database sessions so deleting an account signs it out everywhere. |
| `banks` | user_id (pk, fk cascade), data (jsonb, `Bank`), updated_at | One bank per user, created empty on first sign-in. |
| `applications` | user_id (fk cascade), id (text), data (jsonb, `Application`), pdf (bytea, null), pdf_pages (int, null), created_at, updated_at | pk (user_id, id). The dashboard list reads only id/company/role/created_at/`pdf is not null`. |
| `usage` | user_id (fk cascade), month (`YYYY-MM`), tailors (int), chat_messages (int) | pk (user_id, month). Incremented in the same transaction that records the result. |
| `subscriptions` | user_id (fk cascade), ls_subscription_id (unique), status, variant_id, renews_at, ends_at, portal_url, updated_at | Mirror of the Lemon Squeezy subscription object. |
| `webhook_events` | id (Lemon Squeezy event id, pk), received_at, processed_at, payload (jsonb) | Idempotency: an event id seen before is acknowledged and skipped. |

Local development without Neon: when `DATABASE_URL` is unset, `deps.ts` opens PGlite on disk at
`data/pglite/`, so `npm run dev` works with zero setup as it does today. The same switch makes tests
fast.

### Authentication and request guarding

- Better Auth 1.x with its Drizzle adapter (Auth.js v5 is still a beta on npm). Providers: Google,
  Resend magic link. With `EMAIL_TRANSPORT=file` (the default outside production) the magic link is
  written to `data/magic-links/<email>.txt` and printed, so local work and Playwright need no mail service.
- First sign-in creates the user's empty bank.
- `src/proxy.ts` is rewritten: keep the same-origin check on `/api/*` mutations (CSRF), drop the
  loopback hostname check, and require a session for every page and API route except `/`,
  `/signin`, `/privacy`, `/terms`, `/api/auth/*`, `/api/webhooks/*` and `/api/health`. Signed-out
  visitors to `/bank`, `/tailor/*` are sent to `/signin?next=...`.
- `/` renders the landing page when signed out and the dashboard when signed in.
- Security headers via `next.config.ts`: HSTS, nosniff, `X-Frame-Options: DENY` (the PDF preview
  iframe is same-origin, which is allowed), `Referrer-Policy: strict-origin-when-cross-origin`,
  `Permissions-Policy` denying camera/microphone/geolocation, and a CSP with a per-request nonce for
  scripts (`frame-src 'self'` for the preview, `img-src 'self' data:`, `connect-src 'self'`). Ads in
  phase 3 will need their own CSP additions.
- `npm run dev`/`start` drop `-H 127.0.0.1`; inside the container Next binds to all interfaces and
  Fly's proxy terminates TLS.

### Plans, limits and usage

`src/billing/plans.ts` is the single table of what each plan allows:

| | Free | Pro |
| --- | --- | --- |
| Tailors per calendar month | 3 | 300 (fair use) |
| Chat drawer | no | yes, 200 messages/day |
| Compile | 30 per 10 minutes | 120 per 10 minutes |
| Price | £0 | £6/month or £48/year |

- `/api/tailor` and `/api/chat` check the monthly counter before calling Claude and increment it
  after a successful result. A `429` with `{ error, limit, used, resetsAt, upgrade: true }` is shown
  on the tailor form and in the chat drawer with an Upgrade button.
- Burst limits are an in-memory token bucket per user id (`src/lib/rate-limit.ts`). The app runs as
  one machine, so no shared store is needed; if it ever scales out this moves to Redis. One machine is
  not Fly's default for a new app: it must be enforced by deploying with `fly deploy --ha=false`.
  Magic-link requests are limited per IP by Better Auth's own limiter (5 per minute, on in production
  only) and per email by ours (5 links per hour, `src/lib/magic-link-limit.ts`), to stop spam.
- Compiles are queued with concurrency 2 (`src/latex/queue.ts`) so a burst cannot starve the
  container; the existing 60 s timeout stays. TeX runs with `openout_any=p` in its environment,
  which confines writes to its own temp folder. TeX Live 2026 ignores `openin_any`, so reads are
  confined by escaping every user field and by running TeX as a separate unprivileged user in the
  container.
- Claude calls get a 90 s timeout and one retry on a 5xx/overloaded response (the SDK's default
  retries cover this). A monthly spend cap is set by hand in the Anthropic console (runbook item).

### Payments (Lemon Squeezy)

- One product "Resume Tailor Pro" with two variants (monthly, yearly). Variant ids live in env vars.
- Upgrade button → `POST /api/billing/checkout` creates a checkout via the Lemon Squeezy API with
  `checkout_data.custom.user_id` and the user's email prefilled, and returns the URL; the browser is
  sent there. Return URL is `/account?upgraded=1`.
- `POST /api/webhooks/lemonsqueezy` verifies the `X-Signature` HMAC-SHA256 over the raw body,
  records the event id (skipping duplicates), upserts `subscriptions`, and sets `users.plan` and
  `plan_until`:
  - `subscription_created` / `subscription_updated` / `subscription_resumed` / `subscription_unpaused`
    with status `active`, `on_trial` or `past_due` → `pro`, `plan_until = renews_at`.
  - `subscription_cancelled` → stays `pro` until `ends_at`, then free (`plan_until = ends_at`).
  - `subscription_expired` / `subscription_paused` → `free`.
  - A user is Pro when `plan = 'pro' and (plan_until is null or plan_until > now())`.
- The account page shows plan, renewal date, the Lemon Squeezy customer portal link (change card,
  cancel) and this month's usage.
- Webhook handler is the only writer of `plan`; a `scripts/sync-subscriptions.ts` re-reads all
  subscriptions from the API for recovery.

### Account page and GDPR

- `/account`: email, plan and usage, Upgrade / Manage subscription, "Download my data" (JSON of bank
  and applications without PDFs, from `GET /api/account/export`), "Delete my account".
- Delete: confirm by typing the email; the server cancels any active Lemon Squeezy subscription,
  deletes the `users` row (cascades to everything) and ends all sessions. No soft delete; the
  `webhook_events` log keeps only event ids and payloads, which contain the customer email, and is
  pruned after 90 days by a weekly job (`scripts/prune.ts` run from a Fly cron machine).
- Resume content never goes into logs. Errors log user id and route only.
- `/privacy` and `/terms` are static pages written from standard templates and name the
  sub-processors: Anthropic (tailoring and chat; API inputs are not used for training), Neon
  (database, London), Fly.io (hosting, London), Resend (email), Lemon Squeezy (payments). They are
  not legal advice and should be checked once by someone qualified before launch.
- No analytics or ad cookies in phases 1–2, so no cookie banner. Session cookies are strictly
  necessary.

### Landing page

`/` for signed-out visitors: headline, three-step how-it-works, a rendered sample PDF (static image
built from `data/example`), pricing table, short FAQ (what Claude sees, where data lives, cancelling),
sign-in button. Pages `/signin` (Google button, email field) and `/signin/check-email`.

### Deployment

- `Dockerfile`: stage 1 builds Next in standalone mode; stage 2 is `node:24-bookworm-slim` plus
  `perl`, a minimal TeX Live (`install-tl` with `scheme-infraonly`) and
  `tlmgr install latexmk latex-bin latex geometry titlesec enumitem hyperref fontawesome5 crimson
  fontenc inputenc` plus whatever the build's compile smoke test proves missing. Target image ≤ 700 MB.
- `fly.toml`: region `lhr`, one `shared-cpu-1x` machine with 1 GB RAM that never stops
  (`auto_stop_machines = "off"`; no cold starts, TeX startup is slow). Fly gives a new app two machines,
  so the first deploy must be `fly deploy --ha=false`. HTTP health check on `/api/health` (shallow by
  default: the process and latexmk; `?deep=1` adds the database). Migrations run when the server boots
  (before the first query), so there is no release command.
- Secrets (`fly secrets set`): `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GOOGLE_CLIENT_ID`,
  `GOOGLE_CLIENT_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, `ANTHROPIC_API_KEY`, `LEMONSQUEEZY_API_KEY`,
  `LEMONSQUEEZY_STORE_ID`, `LEMONSQUEEZY_WEBHOOK_SECRET`, `LEMONSQUEEZY_VARIANT_MONTHLY`,
  `LEMONSQUEEZY_VARIANT_YEARLY`. `src/lib/env.ts` validates them with zod at startup and fails fast.
- Backups: Neon point-in-time restore (7 days on the free tier). Nothing lives on the container disk.
- `docs/runbook.md`: deploy, roll back (`fly releases` / `fly deploy --image`), rotate a secret, set
  the Anthropic spend cap, re-sync subscriptions, prune, read logs (`fly logs`), and what to do when
  Lemon Squeezy or Anthropic is down (tailoring shows a "try again later" banner; nothing is charged).

### Error handling

- Every API route keeps the `handle()` envelope. New error cases: 401 not signed in,   `429` for plan limits (with `upgrade: true`), 429 for burst limits (with `retryAfter`), 503 when
  Claude is unavailable, 422 for LaTeX failures as today.
- The UI shows plan-limit errors with an Upgrade button, burst limits with a countdown, and
  everything else with the existing banners.
- Webhook handler returns 200 after recording the event even if processing fails later, and logs
  the failure; `sync-subscriptions` is the repair path.

### Testing

- Unit (vitest): plans/limits, usage counting across month boundaries, rate limiter, webhook
  signature check and status → plan mapping, account export shape, Postgres repositories on PGlite,
  `requireUser` with and without a session, proxy allow/deny matrix.
- Integration: the existing real-LaTeX compile tests, plus a queue test (3 concurrent compiles, max 2
  running).
- E2E (Playwright, dev sign-in): sign in → add bullet → manual tailor → auto compile shows "1 page" →
  download; free user hits the tailor limit and sees Upgrade; account export downloads JSON; delete
  account signs out and `/bank` redirects to sign-in.
- Docker: a `scripts/smoke-image.sh` builds the image, runs it with a Postgres sidecar and waits for
  `/api/health?deep=1`, then checks a compile of `data/example`.

## Phases

1. **Foundation (private beta for the owner).** Drizzle + PGlite/Neon, Better Auth with file-based dev magic links,
   identity replaces profiles, import script, Dockerfile, Fly.io deploy on the real domain with
   Google sign-in and magic links working. Exit: the owner tailors and downloads a resume on the live
   site from his imported bank.
2. **Launch.** Plans and usage limits, Lemon Squeezy checkout and webhooks, account page with export
   and delete, privacy and terms pages, landing page, security headers and CSP, runbook. Exit: a
   stranger can sign up, hit the free limit, pay, and cancel, with VAT invoiced by Lemon Squeezy.
3. **Growth.** Plan-gated `AdSlot` and consent banner, cookieless analytics (Plausible or Umami),
   onboarding hints, email receipt for tailors if wanted.

## Things only the owner can do

- Buy a domain and point it at Fly.io; verify it in Resend for sending.
- Create the Google OAuth client (consent screen, redirect URL).
- Open a Lemon Squeezy store, get it approved (they review new stores, usually days), create the
  product and variants, and copy the ids and webhook secret.
- Set the monthly spend cap in the Anthropic console.
- Read the privacy policy and terms before launch, ideally with a professional once.

## Running costs

| Item | Cost |
| --- | --- |
| Fly.io machine, 1 GB | about £5/month |
| Neon Postgres | free tier (0.5 GB), paid from ~£15/month if it outgrows it |
| Resend | free up to 3,000 emails/month |
| Lemon Squeezy | 5% + 50¢ per transaction |
| Domain | about £10/year |
| Claude | roughly 3–5p per tailor and 1–2p per chat message |

## Risks

- The TeX image may exceed the small machine's memory under concurrent compiles; the queue of 2 and a
  1 GB machine are the mitigation, and the next size up is a config change.
- TeX runs as a separate user, which keeps documents away from the server's environment and files but
  not from each other: both queue slots run as the same uid, so if LaTeX escaping ever failed, a
  document could read a concurrent compile's folder (and so another user's resume) through
  /proc/<pid>/cwd. Planned fix: one uid and group per queue slot.
- Lemon Squeezy store approval can take days and can be refused; Paddle is the fallback with the
  same merchant-of-record model and a similar webhook shape.
- Legal pages are template grade until reviewed.
- Google's OAuth consent screen may need verification if the app shows "unverified" warnings; magic
  links work regardless.
