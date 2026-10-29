# Resume Tailor

Job hunting is hard, so I built this for myself while applying. You keep one bank of every bullet you've ever
written. Paste a job description and Claude picks the bullets that fit and lightly rewords them. You review every
change and download a one-page PDF, compiled with LaTeX from `templates/resume.tex`. The hosted copy (link coming
once it's live) is free to use: short ads pay for the AI once they are switched on, and I cover it until then. The
code is open source, so you can also run it yourself.

<img src="src/ui/landing/sample-resume.png" alt="A one-page resume made with Resume Tailor from the example bank" width="360">

Running a copy for yourself is covered below in [Self-host](#self-host). Working on the code is covered in
[Develop](#develop), and running the public service in [Operate the hosted service](#operate-the-hosted-service).

## Using it

1. **Bank**: fill in Profile, Experience, Projects, Education and Skills, with every bullet you have ever written.
   Pin the bullets that must always appear. Edits save automatically.
2. **Tailor**: paste a job description and a company name, then "Tailor with Claude". "Start from full bank" lets
   you prune by hand without the AI.
3. **Review**: Claude's edits show as a word diff against your bank. Revert, edit, reorder or add bullets back. The
   PDF preview recompiles after each edit and always fills exactly one A4 page; **Layout** sets a fixed font size
   and margins. **Download PDF** when happy.
4. **Dashboard**: every tailored resume is kept with its job description and PDF.
5. **Chat with Claude** (bottom right): describe an experience and it becomes bullets in your bank, or ask for
   changes to the resume you are reviewing. Claude only uses facts you give it.
6. **Account**: **Download my data** saves everything stored about you as one JSON file; **Delete my account**
   removes it for good.

## Self-host

Self-host mode (`APP_MODE=selfhost`) is a private tool for you and the people you invite. It has no ads, credits
or usage limits, and it uses your own Anthropic API key.

### Requirements

- An Anthropic API key from https://platform.claude.com/. Set a monthly spend limit there: nothing else caps
  what a self-hosted server spends.
- Either Docker, or Node.js 24 with MacTeX (TeX Live on Linux) to run from source.

### Quickest: Docker

The image includes TeX Live and runs TeX as separate users. It needs a Postgres database; this starts one in a
second container, with its data in a Docker volume.

```bash
docker build -t resume-tailor .
docker network create resume-tailor
docker run -d --name resume-tailor-db --network resume-tailor --restart unless-stopped \
  -e POSTGRES_PASSWORD=change-me -v resume-tailor-db:/var/lib/postgresql/data postgres:16-alpine
```

Write the settings to `.env.selfhost`, which git and the Docker build both ignore, then start the app:

```bash
cat > .env.selfhost <<EOF
APP_MODE=selfhost
DATABASE_URL=postgres://postgres:change-me@resume-tailor-db:5432/postgres
BETTER_AUTH_SECRET=$(openssl rand -base64 32)
BETTER_AUTH_URL=http://localhost:3000
EMAIL_TRANSPORT=file
EMAIL_FROM=signin@localhost
ANTHROPIC_API_KEY=sk-ant-...
EOF

docker run -d --name resume-tailor --network resume-tailor --init --restart unless-stopped \
  -p 3000:3000 --env-file .env.selfhost resume-tailor

curl -s 'http://localhost:3000/api/health?deep=1'   # {"ok":true,"db":"ok","latexmk":"ok"} once it has started
```

Open http://localhost:3000, choose "Sign in" and enter your email. With `EMAIL_TRANSPORT=file` no email is sent:
the sign-in link is printed in the server's log, so only someone who can read the log can sign in.

```bash
docker logs resume-tailor 2>&1 | grep 'magic link'
```

Things to know:

- **`BETTER_AUTH_URL` must be the address you open in the browser**, because sign-in links and cookies are issued
  for it. To use the app from other machines on your network, set it to that address, such as
  `http://192.168.1.20:3000`. Plain http works: the security policy upgrades requests to https only when
  `BETTER_AUTH_URL` starts with `https://`.
- **To serve it publicly over https**, put it behind a TLS proxy and set `BETTER_AUTH_URL=https://…`. Sign-in links
  then go by email through Resend: drop `EMAIL_TRANSPORT=file` and set `RESEND_API_KEY` and an `EMAIL_FROM` on a
  domain verified in Resend. The server refuses `EMAIL_TRANSPORT=file` with an https address.
- **Sign-up**: anyone who gets a sign-in link can create an account, unless `SIGNUP_EMAILS` lists the addresses
  that may (comma-separated). Self-host mode neither opens nor closes sign-up.
- **Upgrading**: `git pull`, build the image again, then `docker rm -f resume-tailor` and run it again. Migrations
  run at boot.
- Do not run the container with `--security-opt no-new-privileges`: TeX runs through `sudo`, so every compile and
  the health check would fail.

`.env.example` documents every setting, including Google sign-in.

### From source

```bash
npm ci
cp .env.example .env.local   # set ANTHROPIC_API_KEY in it
npm run dev                  # open http://localhost:3000
```

Outside production the mode defaults to `selfhost`. The database is PGlite, in `data/pglite` (set
`RESUME_DATA_DIR` to move `data/`), and sign-in links are printed in the terminal and written to
`data/magic-links/<email>.txt`. Open `localhost`, not `127.0.0.1`: links and cookies are issued for
`BETTER_AUTH_URL`, which defaults to `http://localhost:3000`. `npm run dev` listens on all interfaces; use
`npm run dev -- -H 127.0.0.1` to keep it to this machine.

### What self-host mode changes

- No ads and no credits: every account can tailor and chat without limit, and the free-usage budget and caps do not
  apply.
- No rate limits. The size limits on requests still apply.
- The tailor form and the chat show a model picker. Without a pick, the model is `UNLIMITED_MODEL`.
- The privacy, terms and cookies pages show a short notice instead of the hosted service's texts: whoever runs the
  server is responsible for its data and sets their own terms. The landing page says there are no ads or credits.

### TeX users outside Docker

`LATEX_RUN_AS` is unset by default, and TeX then runs as the server's own user. The Docker image sets it to `tex`,
a user-name prefix: compile slot 1 runs TeX as `tex1` in a folder of group `texrun1`, slot 2 as `tex2` with
`texrun2`, and so on up to `COMPILE_CONCURRENCY`. To do the same outside Docker, create each `texN` user with its
own `texrunN` group, add the server's user to every `texrunN`, let it run `/usr/bin/timeout` as each `texN`
through sudo (see `docker/sudoers-latex`), and set `COMPILE_ROOT`.

### The licence, in one sentence

If you run a modified version for other people, the AGPL-3.0-only licence asks you to offer them its source: publish your changes
and set `SOURCE_CODE_URL` to them, which the public pages link.

## Develop

### Tests

```bash
npm test                     # unit tests, plus a real LaTeX compile (skipped if latexmk is missing)
npm run test:e2e             # Playwright, both modes
npm run lint
npx tsc --noEmit
bash scripts/smoke-image.sh  # builds the production image and checks it against a throwaway Postgres (Docker)
```

`npm run test:e2e` starts two dev servers with emptied `.e2e-data/` folders: a self-hosted one on port 3123 and a
hosted one on port 3124 with the test ad provider. It signs in through magic-link files and compiles real PDFs, so it
needs `npx playwright install chromium` and MacTeX (TeX Live on Linux). To try hosted mode by hand, run
`APP_MODE=hosted AD_PROVIDER=test AD_MIN_WATCH_SECONDS=1 npm run dev`.

See `CONTRIBUTING.md` before sending a change.

### Layout of the code

- `src/app`: Next.js pages (`(public)` landing, legal pages and sign-in; `(app)` signed-in) and API routes
- `src/ui`: React components; `src/ui/landing` the landing page, `src/ui/public` the public header and footer
- `src/proxy.ts`: the same-origin check on the API, the redirect to sign-in, and the per-request CSP nonce
- `src/lib`: settings (`env.ts`), Better Auth (`auth.ts`), rate limits, request size caps, HTTP helpers
- `src/db`: Drizzle schema and the Postgres or PGlite client; migrations live in `drizzle/` and run at boot
- `src/bank`: the bank schema and repository
- `src/applications`: saved tailored resumes and the editable review state
- `src/tailor`, `src/chat`: the prompts, Claude client and orchestration for tailoring and chat
- `src/latex`: escaping, the tex builder, latexmk compiles, the compile queue and per-slot TeX users
- `src/billing`: plans and what each allows, Claude costs per model, the usage ledger and the daily budget
- `src/credits`: the credits ledger, ad sessions, the daily ad caps and the IP purge
- `src/ads`: the ad provider contract, server-side verification and the content security policy
- `src/account`: data export and account deletion
- `src/admin`: the figures on the admin page
- `src/legal`: the privacy, terms and cookies texts, as data
- `src/import`: import from the local app's `data/<slug>/` folders
- `scripts/`: seed, import, migrate, the sample image render and the image smoke test
- `templates/resume.tex`: the LaTeX template (swap in your own, keep `%%CONTENT%%`)
- `Dockerfile`, `docker/`, `fly.toml`: the image and its Fly.io configuration
- `e2e/`: Playwright tests
- `docs/`: the design specs and plans, and the operator's runbook

### Seed a bank from old resumes

Sign in once so your account exists, stop `npm run dev` (PGlite is single-process), then:

```bash
npm run seed -- --email you@example.com "/path/to/CV one.pdf" "/path/to/CV two.pdf"
```

Each PDF is extracted with `pdftotext` (`brew install poppler`), structured by Claude and merged into the bank
without duplicating bullets. Don't edit the bank in the browser while it runs.

### Import from the local app

An earlier version kept each profile in `data/<slug>/` (`bank.json` plus `applications/`). To move one into an
account, sign in once, stop `npm run dev`, then:

```bash
npm run import:local -- --email you@example.com --from data/<slug> --dry-run
npm run import:local -- --email you@example.com --from data/<slug>
```

A re-run is safe. A bank that already has content is kept unless you pass `--replace`. Both scripts target
`DATABASE_URL` when it is set; `docs/runbook.md` has the steps for production.

## Operate the hosted service

`docs/runbook.md` covers the hosted deployment on Fly.io with Neon, Resend and Anthropic. It starts with the launch
checklist and goes on to secrets, deploys, limits, the admin page and the legal pages.

## Licence

Copyright (C) 2026 Edward Goh. Licensed under the GNU Affero General Public License v3.0 only (AGPL-3.0-only).

The full text is in `LICENSE`. Contributions are accepted under the same licence (`CONTRIBUTING.md`). To report a
security problem, see `SECURITY.md`.
