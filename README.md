# Resume Tailor

A local web app for one or two people. It keeps a complete bank of your
experience and project bullets, asks Claude to pick the ones that fit a pasted
job description (and lightly reword them), lets you review every change, and
compiles a one-page LaTeX resume in the style of `CV_Edward.pdf`.

Design spec: `docs/superpowers/specs/2026-10-27-resume-tailor-design.md`

## Requirements

- Node.js 24 (`nvm use 24`)
- MacTeX (gives you `latexmk` and `pdflatex`): https://www.tug.org/mactex/
- For seeding from PDFs: `brew install poppler` (gives `pdftotext`)
- An Anthropic API key: https://platform.claude.com/

## Setup

```bash
npm install
cp .env.example .env.local      # then paste your ANTHROPIC_API_KEY
npm run dev                     # open http://localhost:3000 (use the localhost name, not 127.0.0.1)
```

## Using it

1. **Profile**: pick one in the top bar or create one with "+ New".
2. **Bank**: fill in Profile, Experience, Projects, Education and Skills. Put
   *every* bullet you have ever written in here. Pin the bullets that must
   always appear with their entry. Edits save automatically.
3. **Tailor**: paste a job description and a company name, then "Tailor with
   Claude". Without an API key, "Start from full bank" lets you prune by hand.
4. **Review**: Claude's edits show as a word diff against your bank wording.
   Revert, edit, reorder, add bullets back from the bank, then **Compile PDF**.
   The badge tells you if it spilled past one page. **Download PDF** when happy.
5. **Dashboard**: every tailored resume is kept with its JD and PDF.

## Chat with Claude

The "Chat with Claude" button (bottom right) is on every page. Paste or
describe an experience ("I also interned at X, built Y") and it turns it into
bullets in your bank; on a review screen you can also say "add my Kafka work to
this resume", "shorten the summary" or "drop the second project" and the
changes land on that resume. Claude only ever uses facts you give it.

## Seeding a bank from old resumes

```bash
npm run seed -- --profile edward "/path/to/CV one.pdf" "/path/to/CV two.pdf"
```
Each PDF is extracted with `pdftotext`, structured by Claude, and merged into
`data/<profile>/bank.json` without duplicating bullets you already have.

## Where your data lives

`data/<profile>/bank.json` and `data/<profile>/applications/`. The whole
`data/` folder is git-ignored except `data/example/`, so personal details never
reach GitHub. Back it up however you like.

## Only you can reach it

The dev server binds to `127.0.0.1` only, so nothing on your Wi-Fi can read
your bank or trigger Claude calls, and `src/proxy.ts` refuses API requests that
arrive under another hostname or from another website's origin.

## Tests

```bash
npm test            # unit + a real LaTeX compile (skipped if latexmk is missing)
npm run test:e2e    # Playwright smoke test (needs: npx playwright install chromium)
npm run lint
```

## Layout

- `src/bank` bank schema and JSON repository
- `src/tailor` prompt, Claude structured-output client, validator, orchestrator
- `src/latex` escaping, tex builder, latexmk compile
- `src/applications` saved tailored resumes and the editable review state
- `src/app` Next.js pages and API routes; `src/ui` React components
- `templates/resume.tex` the LaTeX template (swap in your own, keep `%%CONTENT%%`)
