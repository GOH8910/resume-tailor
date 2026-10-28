# Resume Tailor

A hosted web app you sign in to. Each account has one bank: every experience
and project bullet you have ever written. Paste a job description and Claude
picks the bullets that fit (and lightly rewords them). You review every
change, and the app compiles a one-page LaTeX resume from
`templates/resume.tex`.

Design spec: `docs/superpowers/specs/2026-10-28-hosted-resume-tailor-design.md`

## Requirements

- Node.js 24 (`nvm use 24`)
- MacTeX for compiling locally (gives `latexmk` and `pdflatex`): https://www.tug.org/mactex/
- For seeding from PDFs: `brew install poppler` (gives `pdftotext`)
- An Anthropic API key: https://platform.claude.com/
- Docker, only for the image smoke test

## Setup

```bash
npm install
cp .env.example .env.local
```

In `.env.local`, set `ANTHROPIC_API_KEY` and
`BETTER_AUTH_SECRET` (generate one with `openssl rand -base64 32`; without it
development falls back to a fixed dev-only secret). Then:

```bash
npm run dev     # open http://localhost:3000
```

Use the `localhost` name, not `127.0.0.1`: sign-in links and cookies are issued
for `BETTER_AUTH_URL`, which defaults to `http://localhost:3000`.

`npm run dev` listens on all interfaces. Every page but sign-in needs an
account, but if other machines on your network should not reach it at all, use
a firewall or `npm run dev -- -H 127.0.0.1`.

To sign in, enter any email. Outside production the link is not emailed: it is
printed in the terminal and written to `data/magic-links/<email>.txt`. Opening
it creates the account (with an empty bank) on first use. Set `SIGNUP_EMAILS`
(comma-separated) to restrict who can create an account. `.env.example`
documents every variable, including Google sign-in.

## Using it

1. **Bank**: fill in Profile, Experience, Projects, Education and Skills. Put
   *every* bullet you have ever written in here. Pin the bullets that must
   always appear with their entry. Edits save automatically.
2. **Tailor**: paste a job description and a company name, then "Tailor with
   Claude". Without an API key, "Start from full bank" lets you prune by hand.
3. **Review**: Claude's edits show as a word diff against your bank wording.
   Revert, edit, reorder, add bullets back from the bank. The PDF preview
   compiles on its own: once when the page opens and again a moment after
   each edit is saved (the previous page stays up until the new one is ready;
   **Recompile** forces a fresh one). The PDF always fills exactly one A4
   page: by default the font scales between 8.5pt and 12pt to fit, and any
   leftover space is spread between sections. The **Layout** box sets a fixed
   font size and the four margins (inches) for that resume; "Use for new
   resumes" makes them your bank's default. The badge warns if the resume
   spills past one page. **Download PDF** when happy.
4. **Dashboard**: every tailored resume is kept with its job description and PDF.

### Chat with Claude

The "Chat with Claude" button (bottom right) is on every page. Paste or
describe an experience ("I also interned at X, built Y") and it turns it into
bullets in your bank; on a review screen you can also say "add my Kafka work to
this resume", "shorten the summary" or "drop the second project" and the
changes land on that resume. Claude only ever uses facts you give it.

## Where your data lives

Locally, in a PGlite database under `data/pglite` (set `RESUME_DATA_DIR` to
move `data/`). PGlite is single-process: stop `npm run dev` before running a
script against it. In production, in Postgres (`DATABASE_URL`). Nothing under
`data/` is committed except `data/example/`.

## Seeding a bank from old resumes

Sign in on the site once so your account exists, stop `npm run dev` (the local
database is single-process), then:

```bash
npm run seed -- --email you@example.com "/path/to/CV one.pdf" "/path/to/CV two.pdf"
```

Each PDF is extracted with `pdftotext`, structured by Claude, and merged into
your account's bank without duplicating bullets you already have. Don't edit the
bank in the browser while it runs: the script reads the bank, calls Claude, then
writes the whole bank back.

## Importing a bank from the local app

The local app kept each profile in `data/<slug>/` (`bank.json` plus
`applications/`). To move one into an account, sign in once, stop `npm run dev`,
and run:

```bash
npm run import:local -- --email you@example.com --from data/<slug> --dry-run
npm run import:local -- --email you@example.com --from data/<slug>
```

`--dry-run` validates, counts and says what would happen to the bank, without
writing. Applications and their PDFs are upserted, so a re-run is safe; a file
that fails validation, or whose id does not match its file name, is skipped and
listed. A bank that already has content is kept unless you pass `--replace`.
Use an absolute `--from` path when the data lives in another checkout.

To import into production, sign in on the production site first, then set
`DATABASE_URL` to Neon's direct (unpooled) connection string, changing
`sslmode=require` to `sslmode=verify-full` in it. Migrations run on every
invocation, `--dry-run` included, so run it from the same commit as the
deployed app. `docs/runbook.md` has the exact steps.

## Tests

```bash
npm test                     # unit + a real LaTeX compile (skipped if latexmk is missing)
npm run test:e2e             # Playwright, see below
npm run lint
bash scripts/smoke-image.sh  # builds the production image and checks it against a throwaway Postgres (Docker)
```

`npm run test:e2e` starts its own dev server on port 3123 with an emptied
`.e2e-data/` folder, signs in through magic-link files, and compiles a real
PDF. It needs `npx playwright install chromium` and MacTeX.

## Deploying

See `docs/runbook.md`.

## Layout of the code

- `src/app` Next.js pages (`(public)` sign-in, `(app)` signed-in) and API routes; `src/ui` React components
- `src/proxy.ts` same-origin check on the API, and the redirect to sign-in
- `src/lib/auth.ts` Better Auth: magic links, optional Google, the sign-up allowlist; `src/lib/env.ts` checks the environment
- `src/db` Drizzle schema and the Postgres or PGlite client; migrations live in `drizzle/` and run at boot
- `src/bank` bank schema and repository
- `src/applications` saved tailored resumes and the editable review state
- `src/tailor` prompt, Claude structured-output client, validator, orchestrator
- `src/chat` the chat with Claude
- `src/latex` escaping, tex builder, latexmk compile and the compile queue
- `src/import` import from the local app's `data/<profile>/` folders
- `scripts/` seed, import, migrate, and the image smoke test
- `templates/resume.tex` the LaTeX template (swap in your own, keep `%%CONTENT%%`)
- `Dockerfile`, `docker/` (TeX Live profile, sudoers rule for the `tex` user), `fly.toml`
- `e2e/` Playwright tests
