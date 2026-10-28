# Runbook: phase 1

Placeholders: `<domain>` is the public host name (e.g. `resume.example.com`), `<you>` your email address,
`<app>` the Fly app name (`resume-tailor` in `fly.toml`).

## 1. One-time accounts

1. **Fly.io**: sign up and add a card.
2. **Neon**: create a project in AWS Europe West 2 (London), `aws-eu-west-2`. In **Connect**, switch
   connection pooling off to get the direct string (its host has no `-pooler`). In that string, change
   `sslmode=require` to `sslmode=verify-full`. The result is `DATABASE_URL`.
3. **Resend**: add your domain, create the DNS records it lists, and wait until it shows Verified. Create
   an API key with sending access.
4. **Google sign-in** (optional): in Google Cloud, set up the OAuth consent screen (External), then
   Credentials, Create OAuth client ID, Web application, with the authorized redirect URI
   `https://<domain>/api/auth/callback/google`. Keep the client ID and secret. While the consent screen is
   in Testing, only its listed test users can use Google.
5. **Anthropic console**: create an API key, and set a monthly spend limit (Settings, Limits).
6. **Domain**: you need to be able to edit its DNS records.

## 2. Create the Fly app

```bash
brew install flyctl
fly auth login
fly launch --no-deploy        # copy the existing fly.toml's configuration; add no database or extras
git diff fly.toml             # keep the committed settings; only `app` may change
fly ips allocate-v4 --shared
fly ips allocate-v6
fly certs add <domain>        # create the A and AAAA records it prints
fly certs show <domain>       # repeat until the certificate is issued
```

Fly app names are global. If `resume-tailor` is taken, pick another name, set `app` in `fly.toml` to it
and commit that change. Never keep a name that belongs to someone else's app.

## 3. Secrets

```bash
fly secrets set \
  DATABASE_URL='postgresql://<user>:<password>@<endpoint>.eu-west-2.aws.neon.tech/neondb?sslmode=verify-full' \
  BETTER_AUTH_SECRET="$(openssl rand -base64 32)" \
  BETTER_AUTH_URL='https://<domain>' \
  EMAIL_FROM='Resume Tailor <signin@<domain>>' \
  RESEND_API_KEY='re_...' \
  ANTHROPIC_API_KEY='sk-ant-...' \
  SIGNUP_EMAILS='<you>,friend@example.com'
# Optional, both or neither:
fly secrets set GOOGLE_CLIENT_ID='...' GOOGLE_CLIENT_SECRET='...'
```

- `DATABASE_URL` is Neon's **direct** (unpooled) string with `sslmode=verify-full`. The app runs its
  migrations on boot and keeps its own pool of 5 connections.
- `SIGNUP_EMAILS` is the private-beta allowlist (comma-separated, case-insensitive). **Unset means open
  sign-up**: anyone who finds the site can create an account and spend Anthropic credit. Accounts that
  already exist can always sign in.
- `EMAIL_FROM` must be on the domain verified in Resend.
- `fly.toml` already sets `PORT`, `HOSTNAME`, `COMPILE_CONCURRENCY`, `EMAIL_TRANSPORT=resend`,
  `LATEX_RUN_AS` and `COMPILE_ROOT`. Do not set them as secrets.
- A missing or invalid required value stops the server at boot (`[env] invalid configuration` in
  `fly logs`), so the deploy fails rather than serving errors.
- Values typed on the command line end up in shell history. `fly secrets import < file` reads `NAME=value`
  lines instead; keep that file outside the repo and delete it afterwards.

## 4. Before the first deploy: test the image

```bash
bash scripts/smoke-image.sh                                     # builds for this machine (arm64 on Apple silicon)
docker build --platform linux/amd64 -t resume-tailor:amd64 .    # once: Fly's remote builder builds amd64
```

The smoke script prints PASS or FAIL per check and exits non-zero on any failure. The amd64 build is slow
under emulation, but it is the only proof of the x86_64 TeX Live path before Fly builds it.

## 5. Deploy and sign in

```bash
fly deploy
curl -sS 'https://<domain>/api/health?deep=1'
# must print {"ok":true,"db":"ok","latexmk":"ok"}
```

Fly's own check calls the shallow `/api/health`, which does not touch the database on purpose so Neon can
scale to zero.

Then sign in on the live site once. This proves Resend delivers, and creates your account with an empty
bank. Do not edit the bank yet: the import in step 6 only fills a bank that is still empty.

## 6. Import the local bank, then compile

1. On the laptop, check out the commit that is deployed (migrations run on every invocation, `--dry-run`
   included), then:

   ```bash
   npm ci
   read -rs DATABASE_URL && export DATABASE_URL   # paste the direct URL with sslmode=verify-full; nothing echoes
   npm run import:local -- --email <you> --from /absolute/path/to/data/<slug> --dry-run
   npm run import:local -- --email <you> --from /absolute/path/to/data/<slug>
   unset DATABASE_URL
   ```

   The dry run should print `Bank: would-import`. If it prints `Bank: would-keep`, the bank was edited
   after sign-up; pass `--replace` to overwrite it with the imported one.
2. Reload the dashboard. It should list the imported applications with their PDFs.
3. Compile once on the live site: open an imported application, or go to Tailor, fill in Company and Job
   description, and choose "Start from full bank". The review screen compiles on its own; wait for the
   "1 page" badge.

## 7. Operations

- **Logs**: `fly logs`. Machine state and checks: `fly status`, `fly checks list`.
- **Roll back**: `fly releases --image` lists releases with their images; redeploy one with
  `fly deploy --image registry.fly.io/<app>:deployment-<id>`. Older code then runs against the current
  schema, which is only safe across additive migrations.
- **Rotate a secret**: `fly secrets set NAME='new value'` restarts the machine with it. For API keys, create
  the new key, set it, then revoke the old one. A new `BETTER_AUTH_SECRET` signs everyone out.
- **Health**: `/api/health` (Fly, every 30 s) checks that the process answers and latexmk runs. latexmk runs
  the way compiles do, through sudo as `tex`, so a broken sudo rule shows as `"latexmk":"error: …"` with a
  503. `?deep=1` also runs `select 1` against the database.
- **Deploys during a compile**: `kill_timeout = 65` lets a stopping machine finish a compile (up to 60 s).
- **Migrations** run at boot through the pool, so every statement is bounded by its 10 s `query_timeout`.
  `npm run db:migrate` uses the same pool and limit. A future migration that needs longer must be applied
  by hand first: run its SQL with `psql` against the direct URL, then insert its row into
  `drizzle.__drizzle_migrations` (`hash` is the SQL file's sha256, `created_at` its `when` in
  `drizzle/meta/_journal.json`) so the boot run skips it. Then deploy.
- **Slow compiles**: the shared CPU is throttled under sustained load. If compiles approach 60 s, move to a
  dedicated CPU with `fly scale vm performance-1x` (check Fly's pricing first).
- **Cost**: about $6/month for the always-on machine, plus Neon's free tier, Resend's free tier and the
  domain. Anthropic usage is on top, capped by the spend limit.

## 8. Image notes

- Never remove `data` from `.dockerignore`. Next's standalone output traces the files the server reads and
  would copy personal data from `data/` into the image.
- TeX Live installs from the live tlnet mirror, so builds are not reproducible and can fail around TeX
  Live's yearly release in spring. If that happens, pin the previous year's frozen repository, e.g.
  `https://ftp.math.utah.edu/pub/tex/historic/systems/texlive/2026/tlnet-final`: fetch `install-tl` from it,
  pass it to `install-tl -repository`, and run `tlmgr option repository <same url>` before `tlmgr install`.
  The build compiles the template after installing, so a broken TeX fails the build instead of shipping.
- The image runs TeX through setuid `sudo`. Never run it with `no-new-privileges`
  (`--security-opt no-new-privileges` in Docker), or every compile and the health check fail.
- There is no `ps` in the image. Read `/proc` instead, e.g. in `fly ssh console`:
  `for f in /proc/[0-9]*/cmdline; do tr '\0' ' ' < "$f"; echo; done`.

## 9. Residual risks

- Both compile slots run as the same `tex` user. If LaTeX escaping ever failed, one compile could read a
  concurrent compile's folder through `/proc`. Per-slot users are planned before public launch.
- With `SIGNUP_EMAILS` unset, sign-up is open to anyone.
- The magic-link throttle (5 links per address per hour) is in memory: per process, and reset by every
  restart and deploy.

## 10. Phase 2 reminders

- Before Lemon Squeezy webhooks go live, add `/api/webhooks/` to the `PUBLIC` list in `src/proxy.ts`:
  webhook calls carry no session cookie.
- `/` becomes public when the landing page lands. Add it to `PUBLIC` as an exact match (`/^\/$/`), so it
  does not open every path.
