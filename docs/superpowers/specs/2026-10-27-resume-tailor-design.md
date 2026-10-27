# Resume Tailor — Design

Date: 2026-10-27
Status: approved by Edward 2026-10-27

## Goal

A personal, locally-run web app that keeps a complete bank of a person's
experience and project bullets, and, given a pasted job description (JD),
uses Claude to **choose** the most relevant bullets, lightly reword them to
fit the JD, and produce a one-page LaTeX resume in the same visual style as
`CV_Edward.pdf`.

Users: Edward, and possibly one other person (separate profile). No public
hosting, no accounts.

## Non-goals

- No hosted deployment, auth, or multi-tenant database.
- No invention of new experience. Claude may only pick from existing bullets
  and lightly edit wording. Facts must be preserved.
- No cover letters, no job tracking beyond saving what was generated.
- No drag-and-drop between sections (only reorder within an entry).

## Decisions already made

| Question | Decision |
|---|---|
| Matching | Claude picks and lightly rewords (Anthropic API). |
| Hosting | Local only, `npm run dev`, data in JSON files in the repo folder. |
| Output | Review screen, then PDF compiled from LaTeX via local `latexmk`. |
| Template | Reproduce `CV_Edward.pdf` look (Crimson serif, measured A4 margins, FontAwesome icons, ruled headings). If the Overleaf `.tex` is supplied later, adapt it for exact match. |
| Stack | Next.js App Router, TypeScript, Tailwind, `@anthropic-ai/sdk`, Vitest. No database. |
| Profiles | One folder per person under `data/`, switcher in the UI. |
| Git | Private GitHub repo, work on a feature branch, user opens PRs manually. |

## 1. Data model (the bank)

Stored at `data/<profileSlug>/bank.json`. Validated with zod on read and write.

```ts
type Bullet = {
  id: string;            // stable short id, e.g. "b_8f3k2a"
  text: string;
  pinned?: boolean;      // always include when the parent entry is included
};

type Entry = {            // used for education, experience, projects
  id: string;
  title: string;         // "Software Engineer Intern" | "AI Travel Planner" | "Imperial College London"
  org?: string;          // "Tencent" | "MEng Biomedical Engineering" | undefined for projects
  location?: string;     // "London, UK"
  start: string;         // "Jul 2026"  (free text, shown verbatim)
  end: string;           // "Present"
  link?: string;         // optional URL for projects
  bullets: Bullet[];
};

type SkillCategory = { id: string; name: string; items: string[] };

type Bank = {
  version: 1;
  profile: {
    name: string; email: string; phone: string;
    linkedin?: string; github?: string; website?: string;
  };
  summary: string;                // master summary paragraph
  education: Entry[];
  experience: Entry[];
  projects: Entry[];
  skills: SkillCategory[];
};
```

Order of entries in the bank is the default chronological order. Claude may
reorder experience and projects for relevance but education stays in bank order.

## 2. Tailoring flow

### Input
`POST /api/tailor` with `{ profile, jobDescription, company, roleTitle?, model? }`.
JD must be non-empty; company is required (used for the saved application name).

### Prompt
System prompt states the rules; the user turn contains the JD and the bank
serialised as compact JSON with ids. Rules given to Claude:

1. Select bullets **only by id**. Never write a bullet that has no source id.
2. For each selected bullet you may return `edited` text. Edits must keep every
   fact, number, tool and outcome. You may reorder clauses, swap synonyms to
   mirror JD vocabulary, tighten length. Never add claims.
3. Pinned bullets must be included when their entry is included.
4. Limits (configurable, defaults): experience up to 5 bullets per entry,
   projects up to 3 entries and 5 bullets each, education up to 2 bullets.
   Target one page.
5. Rewrite the summary in 2–3 sentences for this JD, using only facts from the
   bank or the master summary.
6. Return skills categories reordered and items reordered by relevance; you may
   drop items but not add any.
7. Give a one-line `rationale` per included entry (shown in the UI).

### Output schema (structured output, enforced with a tool/JSON schema)

```ts
type TailorResult = {
  summary: string;
  education: SelectedEntry[];
  experience: SelectedEntry[];   // ordered
  projects: SelectedEntry[];     // ordered
  skills: SkillCategory[];       // reordered / filtered copy
  notes?: string;                // anything Claude wants to flag
};
type SelectedEntry = {
  entryId: string;
  rationale: string;
  bullets: { bulletId: string; edited?: string }[];   // ordered
};
```

### Server-side validation
`validateTailorResult(bank, result)`:
- Drop any `entryId` / `bulletId` not present in the bank, recording a warning.
- Drop skill items not present in the bank.
- Ensure pinned bullets are present for included entries (add if missing).
- Enforce the bullet-count limits by truncating.
- Return `{ result, warnings[] }`; warnings are surfaced in the review screen.

### Model
Default `claude-opus-5-5` (the current default Claude model); the tailor page
lets you pick `claude-sonnet-5-5` instead. API key read from
`ANTHROPIC_API_KEY` in `.env.local`. A missing key returns a 400 with a clear
message that the UI shows.

## 3. Review screen

Route: `/tailor/[applicationId]`. Two-pane layout: JD (read-only) on the left,
resume state on the right.

Per entry on the right:
- Header (title, org, dates) with include/exclude toggle and the rationale.
- Selected bullets in order, each showing the current text, and, when
  `edited` differs from the original, an inline word-level diff and a
  **Revert** button.
- Inline text editing for any bullet.
- Up/down reorder of bullets within the entry, and of entries within a section.
- Collapsed list of unselected bullets ("Show 7 more") each with an Add toggle.

Summary and skills are editable text areas / lists in the same pane.

Actions: **Compile** (renders PDF into a preview `<iframe>`, shows page count,
warns when > 1), **Save** (persists the application), **Download PDF**.

State lives in the application record (see §5), so leaving and returning
restores the review.

## 4. PDF generation

- `templates/resume.tex` reproduces `CV_Edward.pdf` (measured: A4, 0.75in side and
  0.8in top/bottom margins; embedded font Amiri, whose Latin glyphs derive from
  Crimson): `article`, Crimson (`crimson` package, pdflatex), `titlesec` for section
  headings with a rule, `enumitem` for tight bullets, `fontawesome5` for the
  contact icons, `hyperref` for links, `tabularx` or `\hfill` for right-aligned
  date/location.
- `src/latex/escape.ts`: escapes `& % $ # _ { } ~ ^ \` for user text.
- `src/latex/build.ts`: pure function `(bank, resumeState) => texString`.
- `src/latex/compile.ts`: writes the tex into a fresh OS temp dir (`fs.mkdtemp`),
  runs `latexmk -pdf -interaction=nonstopmode -halt-on-error` there,
  reads page count from the PDF (via `pdfinfo` if present, else parse
  `/Type /Page` count), returns `{ pdf: Buffer, pages, log }`. On failure
  returns the log; the UI shows it in a collapsible panel.
- `POST /api/compile` takes `{ profile, applicationId }` or an inline resume
  state and returns the PDF.

If the user later supplies their Overleaf `.tex`, the only change is
`templates/resume.tex` and the builder's placeholder mapping.

## 5. Applications (saved tailored versions)

`data/<profileSlug>/applications/<yyyy-mm-dd>-<company-slug>-<shortid>.json`
containing `{ id, createdAt, company, roleTitle, jobDescription, model,
warnings, resume: ResumeState }` where `ResumeState` is the editable review
state (summary, ordered entries with ordered bullets and their current text,
skills). The compiled PDF is written next to it with the same base name.

Dashboard lists applications newest first with Open / Download / Delete.

## 6. Bank editor

Routes under `/bank`: `profile`, `experience`, `projects`, `education`,
`skills`. Each page lists entries, allows add / edit / delete of entries and
bullets, and a pin toggle per bullet. Saves through `PUT /api/bank` with the
whole validated bank (file is small; whole-document writes keep it simple).
Writes go to a temp file then rename, so a crash never truncates `bank.json`.

Profile switcher in the top bar lists folders in `data/`; a "New profile"
action creates a folder with an empty bank.

## 7. Seeding

One-off script `scripts/seed-from-pdfs.ts`: runs `pdftotext -layout` on the
CVs in Edward's Resumes folder, and Claude extracts entries and bullets into
the bank schema, deduplicating near-identical bullets. Output is written to
`data/edward/bank.json` for Edward to clean up in the editor. The script is
run once by hand; it is not part of the app.

## 8. Error handling

| Situation | Behaviour |
|---|---|
| `ANTHROPIC_API_KEY` missing | 400 from `/api/tailor`, banner in UI explaining where to put it. |
| Claude returns ids not in bank | Dropped by validator; warning shown. |
| Claude call fails / times out | 502 with message; UI offers Retry. |
| `latexmk` missing | 422 with install hint (same path as a compile failure). |
| LaTeX compile error | 422 with log; UI shows log panel. |
| Bank JSON invalid on disk | Editor shows the zod error and refuses to overwrite. |
| Empty JD or company | Client-side validation, button disabled. |

## 9. Testing

Vitest, co-located `*.test.ts`.
- `escape.test.ts`: every special character, nested braces, unicode passthrough.
- `build.test.ts`: snapshot of the generated tex for a fixture bank.
- `validate.test.ts`: unknown ids dropped, pinned enforced, limits applied, warnings produced.
- `bank-repository.test.ts`: round-trip write/read in a temp dir, atomic write, invalid file rejected.
- `compile.integration.test.ts`: compiles the fixture to a real PDF and asserts 1 page (skipped when `latexmk` is absent).
- Claude client is behind an interface so tests use a fake.
- One Playwright smoke test: load dashboard, open bank editor, add a bullet, see it persisted. Run manually, not in the default `npm test`.

## 10. Project layout

```
src/app/                Next.js routes and pages (thin, call into src/)
  page.tsx              dashboard
  bank/[section]/       editor pages
  tailor/page.tsx       paste JD
  tailor/[id]/page.tsx  review screen
  api/bank, api/tailor, api/compile, api/applications, api/profiles
src/
  bank/                 schema.ts, repository.ts, ids.ts, merge.ts
  tailor/               prompt.ts, schema.ts, validate.ts, claude.ts
  latex/                escape.ts, build.ts, compile.ts
  applications/         repository.ts, resume-state.ts
  ui/                   shared components (diff view, bullet row, pdf preview)
templates/resume.tex
data/<profile>/         bank.json, applications/   (git-ignored except an example)
scripts/seed-from-pdfs.ts
docs/superpowers/specs/ this file
```

`data/` is git-ignored except `data/example/bank.json`, so personal content
stays local while the repo is still runnable.

## 11. Open items

- Overleaf `.tex` source: not available locally. Template will be rebuilt from
  the PDF; swap in the original later if Edward downloads it.
- Anthropic API key: Edward to add to `.env.local` before using the tailor step.
