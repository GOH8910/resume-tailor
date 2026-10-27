# Resume Tailor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local Next.js app that stores a complete bank of resume bullets per person, asks Claude to pick and lightly reword the bullets that fit a pasted job description, lets the user review and edit the picks, and compiles a one-page LaTeX PDF in the style of `CV_Edward.pdf`.

**Architecture:** Thin Next.js App Router route handlers call pure TypeScript modules under `src/` (bank, tailor, latex, applications). Data lives in JSON files under `data/<profile>/`. Claude is called through the official SDK with a zod structured-output schema; its answer is validated against the bank before anything is saved. PDFs are produced by filling `templates/resume.tex` and running local `latexmk`.

**Tech Stack:** Next.js 16 (App Router, `src/` dir), React 19, TypeScript, Tailwind CSS v4, zod 4, `@anthropic-ai/sdk` 1.x, `diff` 9, Vitest 5, Playwright, MacTeX (`latexmk`, `pdflatex`), `pdftotext` (poppler) for seeding.

**Spec:** `docs/superpowers/specs/2026-10-27-resume-tailor-design.md`. Two deviations from the spec, both reflected in it: the default model is `claude-opus-5-5` (the Claude API reference says to default to Opus unless the user names another model) with `claude-sonnet-5-5` selectable; and the Next.js routes live under `src/app/` (create-next-app's `--src-dir` layout) rather than a root `app/` folder.

**Conventions for every task:**
- Work on branch `feat/resume-tailor`. Never commit to `main`.
- Commit messages: `type: short description` (feat, fix, test, docs, chore). No attribution trailers (the user disables them globally).
- `data/` is git-ignored except `data/example/`. Never `git add` anything else under `data/`.
- Run `npm test` before each commit that touches `src/`.
- Immutability: every state helper returns a new object. Never mutate inputs.
- Paths below are relative to `/Users/edwardgoh/Desktop/resume`.

---

## File structure

```
package.json, tsconfig.json, next.config.ts, eslint.config.mjs   (scaffolded)
vitest.config.ts                 Vitest: node env, @/ alias -> src/
playwright.config.ts             starts dev server on port 3123 with RESUME_DATA_DIR=.e2e-data
.env.example                     ANTHROPIC_API_KEY placeholder
templates/resume.tex             LaTeX preamble + macros, %%CONTENT%% marker
data/example/bank.json           fictional bank used by tests and e2e

src/lib/errors.ts                AppError(status) used by every layer
src/lib/fs.ts                    exists(), isEnoent(), writeJsonAtomic()
src/lib/http.ts                  handle() wrapper mapping errors -> JSON responses, requireProfile()
src/lib/deps.ts                  dataRoot(), repository singletons for route handlers

src/bank/schema.ts               zod schemas + types: Bullet, Entry, SkillCategory, Profile, Bank
src/bank/ids.ts                  newId(prefix) (works in browser and Node)
src/bank/repository.ts           BankRepository: listProfiles/createProfile/read/write, slug validation
src/bank/merge.ts                mergeBank(existing, extracted) for the seed script

src/latex/escape.ts              escapeLatex()
src/latex/page-count.ts          countPdfPages(buffer)
src/latex/document.ts            ResumeDocument / DocEntry types (fully resolved resume)
src/latex/build.ts               buildTex(doc, template) -> tex string
src/latex/template.ts            loadTemplate()
src/latex/compile.ts             compileTex(tex) -> pdf + page count, or log
src/latex/fixture.ts             exampleDocument used by tests

src/applications/schema.ts       ResumeState, ResumeEntry, ResumeBullet, Application, ApplicationSummary
src/applications/ids.ts          slugify(), newApplicationId(), assertApplicationId()
src/applications/repository.ts   ApplicationRepository: list/get/save/delete/savePdf/readPdf
src/applications/resume-state.ts fromTailorResult(), fullStateFromBank(), resolveResume()
src/applications/edit.ts         pure ResumeState editing helpers used by the review UI

src/tailor/schema.ts             TailorResult zod schema (Claude's structured output)
src/tailor/limits.ts             TailorLimits + DEFAULT_LIMITS
src/tailor/validate.ts           validateTailorResult(bank, result) -> {result, warnings}
src/tailor/prompt.ts             buildSystemPrompt(), buildUserMessage(), bankForPrompt()
src/tailor/model.ts              TailorModel interface, ModelId, DEFAULT_MODEL_ID
src/tailor/anthropic-model.ts    AnthropicTailorModel (messages.parse + zodOutputFormat), hasApiKey()
src/tailor/tailor.ts             runTailor(), createManualApplication()

src/app/layout.tsx, globals.css, page.tsx
src/app/bank/page.tsx            redirect -> /bank/experience
src/app/bank/[section]/page.tsx  bank editor
src/app/tailor/page.tsx          paste JD
src/app/tailor/[id]/page.tsx     review screen
src/app/api/profiles/route.ts
src/app/api/bank/route.ts
src/app/api/applications/route.ts
src/app/api/applications/[id]/route.ts
src/app/api/applications/[id]/pdf/route.ts
src/app/api/tailor/route.ts
src/app/api/compile/route.ts

src/ui/api.ts                    fetch helpers (api.get/api.send/compilePdf)
src/ui/ProfileProvider.tsx       profile context (localStorage + /api/profiles)
src/ui/TopBar.tsx, Button.tsx, Banner.tsx, Field.tsx
src/ui/dashboard/ApplicationList.tsx
src/ui/bank/BankEditor.tsx, ProfileForm.tsx, EntryEditor.tsx, SkillsEditor.tsx
src/ui/review/ReviewScreen.tsx, SectionReview.tsx, EntryReview.tsx, BulletDiff.tsx, SkillsReview.tsx, PdfPreview.tsx

scripts/seed-from-pdfs.ts        pdftotext + Claude extraction -> mergeBank -> data/<profile>/bank.json
e2e/smoke.spec.ts                Playwright smoke test (manual run)
```

---

### Task 1: Scaffold the project

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `src/app/*` (via create-next-app; Next 16.4 wires Tailwind via a turbopack rule, so there is no postcss config)
- Create: `vitest.config.ts`, `.env.example`, `data/example/bank.json`
- Modify: `.gitignore`, `src/app/globals.css`

- [ ] **Step 1: Scaffold into a scratch folder, then copy in (the project folder already has README.md, which create-next-app refuses to overwrite)**

```bash
cd /private/tmp/claude-501/-Users-edwardgoh-Desktop-resume/2331e7e3-6c35-48e8-bcce-e37c4d03d7de/scratchpad
rm -rf scaffold
npx -y create-next-app@latest scaffold --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --disable-git --no-agent-feedback --skip-install --yes
rsync -a --exclude README.md --exclude .gitignore --exclude node_modules scaffold/ /Users/edwardgoh/Desktop/resume/
cd /Users/edwardgoh/Desktop/resume && ls
```
Expected: `package.json`, `src/app/`, `next.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `postcss.config.mjs` now exist next to `README.md`, `docs/`, `.gitignore`.

- [ ] **Step 2: Install dependencies**

```bash
cd /Users/edwardgoh/Desktop/resume
npm install
npm install @anthropic-ai/sdk zod diff
npm install -D vitest tsx @playwright/test
```
Expected: no errors; `package.json` lists `next` 16.x, `react` 19.x, `zod` 4.x, `@anthropic-ai/sdk` 1.x, `diff` 9.x.

- [ ] **Step 3: Name the package and add scripts to `package.json`**

```bash
npm pkg set name=resume-tailor
```
Then edit the `"scripts"` block so it reads:

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "eslint",
  "test": "vitest run",
  "test:watch": "vitest",
  "test:e2e": "playwright test",
  "seed": "tsx scripts/seed-from-pdfs.ts"
}
```

- [ ] **Step 4: Append project-specific ignores to `.gitignore`**

```bash
cat >> /Users/edwardgoh/Desktop/resume/.gitignore <<'EOF'

# next.js generated
next-env.d.ts
*.tsbuildinfo

# e2e scratch data
.e2e-data/
EOF
```

- [ ] **Step 5: Create `vitest.config.ts`**

```ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 6: Create `.env.example`**

```
# Copy to .env.local and fill in. Never commit .env.local.
ANTHROPIC_API_KEY=sk-ant-...
# Optional: where profiles live (default: ./data)
# RESUME_DATA_DIR=/absolute/path
```

- [ ] **Step 7: Replace `src/app/globals.css` with the design tokens**

```css
@import "tailwindcss";

@theme {
  --color-paper: #f6f2ea;
  --color-paper-deep: #ebe5d8;
  --color-card: #fffdf8;
  --color-ink: #1d1b17;
  --color-ink-soft: #5e5849;
  --color-ink-faint: #9a9382;
  --color-rule: #d8d0bf;
  --color-accent: #8a2f2f;
  --color-accent-deep: #6e2323;
  --color-accent-soft: #f4e4e1;
  --color-ok: #2f6b45;
  --color-ok-soft: #e2efe5;
  --color-warn: #8a5a12;
  --color-warn-soft: #f7ead2;
  --color-danger: #a12d2d;
  --font-serif: "Charter", "Iowan Old Style", "Palatino", Georgia, serif;
  --font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif;
  --font-mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  --shadow-card: 0 1px 2px rgb(29 27 23 / 0.06), 0 8px 24px -12px rgb(29 27 23 / 0.25);
}

html {
  color-scheme: light;
}

body {
  background: var(--color-paper);
  color: var(--color-ink);
  font-family: var(--font-sans);
  -webkit-font-smoothing: antialiased;
}

h1,
h2,
h3 {
  font-family: var(--font-serif);
}

textarea,
input,
select,
button {
  font: inherit;
}
```

- [ ] **Step 8: Create `data/example/bank.json`**

```json
{
  "version": 1,
  "profile": {
    "name": "Alex Example",
    "email": "alex@example.com",
    "phone": "+44 7700 900000",
    "linkedin": "https://linkedin.com/in/alex-example",
    "github": "https://github.com/alex-example"
  },
  "summary": "Software engineer who builds backend services and developer tools. Comfortable in TypeScript, Python and Go, with experience taking features from prototype to production.",
  "education": [
    {
      "id": "e_edu1",
      "title": "Example University",
      "org": "BSc Computer Science",
      "location": "London, UK",
      "start": "Sep 2020",
      "end": "Jun 2024",
      "bullets": [
        { "id": "b_edu1a", "text": "Modules: Distributed Systems, Databases, Machine Learning." },
        { "id": "b_edu1b", "text": "Final-year project: a query planner for a toy SQL engine, 1st class." }
      ]
    }
  ],
  "experience": [
    {
      "id": "e_exp1",
      "title": "Software Engineer Intern",
      "org": "Acme Corp",
      "location": "London, UK",
      "start": "Jul 2024",
      "end": "Jan 2025",
      "bullets": [
        { "id": "b_exp1a", "text": "Built a Go service that ingests 2M events/day from Kafka into PostgreSQL with exactly-once semantics.", "pinned": true },
        { "id": "b_exp1b", "text": "Cut p95 API latency from 800ms to 120ms by adding Redis caching and fixing N+1 queries." },
        { "id": "b_exp1c", "text": "Wrote Playwright end-to-end tests covering the checkout flow, catching 3 regressions before release." },
        { "id": "b_exp1d", "text": "Led the migration of CI from Jenkins to GitHub Actions, halving build time." }
      ]
    },
    {
      "id": "e_exp2",
      "title": "Teaching Assistant",
      "org": "Example University",
      "location": "London, UK",
      "start": "Oct 2022",
      "end": "Jun 2023",
      "bullets": [
        { "id": "b_exp2a", "text": "Ran weekly labs for 40 students on data structures & algorithms in C++." },
        { "id": "b_exp2b", "text": "Marked coursework and gave written feedback within 48 hours." }
      ]
    }
  ],
  "projects": [
    {
      "id": "e_prj1",
      "title": "Trail Planner",
      "start": "Jan 2024",
      "end": "Present",
      "link": "https://github.com/alex-example/trail-planner",
      "bullets": [
        { "id": "b_prj1a", "text": "Built a Next.js + TypeScript app that turns GPX files into day-by-day hiking plans with 15 API endpoints." },
        { "id": "b_prj1b", "text": "Deployed on a $5/month VPS with Docker Compose; ~90% of requests served from cache." }
      ]
    }
  ],
  "skills": [
    { "id": "s_lang", "name": "Programming", "items": ["TypeScript", "Python", "Go", "C++", "SQL"] },
    { "id": "s_infra", "name": "Systems & Infrastructure", "items": ["Linux", "Docker", "Kubernetes", "Kafka", "Redis", "PostgreSQL"] },
    { "id": "s_tools", "name": "Frameworks", "items": ["Next.js", "React", "Node.js", "Playwright", "PyTest"] }
  ]
}
```

- [ ] **Step 9: Verify the app boots and the test runner runs**

```bash
cd /Users/edwardgoh/Desktop/resume
npx tsc --noEmit
npm test
```
Expected: `tsc` exits 0. Vitest prints `No test files found` and exits 0 (or 1 with the "no tests" message; both are fine at this stage).

- [ ] **Step 10: Commit**

```bash
cd /Users/edwardgoh/Desktop/resume
git add -A
git status --short
git commit -m "chore: scaffold next.js app with vitest, tokens and example bank"
```
Before committing, confirm the status shows nothing under `data/` other than `data/example/bank.json` (the `.gitignore` from Step 4 guarantees this).

---

### Task 2: Errors, bank schema, ids

**Files:**
- Create: `src/lib/errors.ts`, `src/bank/schema.ts`, `src/bank/ids.ts`
- Test: `src/bank/schema.test.ts`, `src/bank/ids.test.ts`

- [ ] **Step 1: Write the failing tests**

`src/bank/schema.test.ts`:
```ts
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { BankSchema, emptyBank } from "./schema";

describe("BankSchema", () => {
  it("parses the example bank", async () => {
    const raw = JSON.parse(await readFile("data/example/bank.json", "utf8"));
    const bank = BankSchema.parse(raw);
    expect(bank.experience[0].bullets[0].pinned).toBe(true);
    expect(bank.projects[0].org).toBeUndefined();
  });

  it("rejects a bank without a version", () => {
    const result = BankSchema.safeParse({ profile: {}, summary: "" });
    expect(result.success).toBe(false);
  });

  it("accepts an empty draft bullet and entry (the editor creates these while typing)", () => {
    const bank = emptyBank("A");
    const draft = {
      ...bank,
      experience: [{ id: "e1", title: "", start: "", end: "", bullets: [{ id: "b1", text: "" }] }],
      skills: [{ id: "s1", name: "", items: [] }],
    };
    expect(BankSchema.safeParse(draft).success).toBe(true);
  });

  it("emptyBank is valid and carries the name", () => {
    const bank = emptyBank("Sam");
    expect(BankSchema.parse(bank).profile.name).toBe("Sam");
  });
});
```

`src/bank/ids.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { newId } from "./ids";

describe("newId", () => {
  it("prefixes and uses 8 hex chars", () => {
    expect(newId("b")).toMatch(/^b_[0-9a-f]{8}$/);
  });
  it("is different each call", () => {
    expect(newId("e")).not.toBe(newId("e"));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test
```
Expected: FAIL, "Cannot find module './schema'" / "'./ids'".

- [ ] **Step 3: Implement**

`src/lib/errors.ts`:
```ts
/** Error that carries an HTTP status so route handlers can map it directly. */
export class AppError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}
```

`src/bank/schema.ts`:
```ts
import { z } from "zod";

// Empty text/title/category names are allowed: the editor creates drafts while the user types.
// The LaTeX builder and the prompt skip blank bullets, untitled entries and unnamed categories.
export const BulletSchema = z.object({
  id: z.string().min(1),
  text: z.string(),
  pinned: z.boolean().optional(),
});

export const EntrySchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  org: z.string().optional(),
  location: z.string().optional(),
  start: z.string().default(""),
  end: z.string().default(""),
  link: z.string().optional(),
  bullets: z.array(BulletSchema),
});

export const SkillCategorySchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  items: z.array(z.string()),
});

export const ProfileSchema = z.object({
  name: z.string(),
  email: z.string(),
  phone: z.string(),
  linkedin: z.string().optional(),
  github: z.string().optional(),
  website: z.string().optional(),
});

export const BankSchema = z.object({
  version: z.literal(1),
  profile: ProfileSchema,
  summary: z.string(),
  education: z.array(EntrySchema),
  experience: z.array(EntrySchema),
  projects: z.array(EntrySchema),
  skills: z.array(SkillCategorySchema),
});

export type Bullet = z.infer<typeof BulletSchema>;
export type Entry = z.infer<typeof EntrySchema>;
export type SkillCategory = z.infer<typeof SkillCategorySchema>;
export type Profile = z.infer<typeof ProfileSchema>;
export type Bank = z.infer<typeof BankSchema>;

export const SECTION_KEYS = ["education", "experience", "projects"] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

export const SECTION_LABELS: Record<SectionKey, string> = {
  education: "Education",
  experience: "Experience",
  projects: "Projects",
};

export function emptyBank(name = ""): Bank {
  return {
    version: 1,
    profile: { name, email: "", phone: "" },
    summary: "",
    education: [],
    experience: [],
    projects: [],
    skills: [],
  };
}
```

`src/bank/ids.ts`:
```ts
/** Short random id, e.g. "b_3fa91c20". Uses Web Crypto so it works in the browser and Node. */
export function newId(prefix: string): string {
  const bytes = new Uint8Array(4);
  globalThis.crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${prefix}_${hex}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test
```
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/errors.ts src/bank/schema.ts src/bank/ids.ts src/bank/schema.test.ts src/bank/ids.test.ts
git commit -m "feat: add bank schema, ids and AppError"
```

---

### Task 3: Bank repository (JSON files per profile)

**Files:**
- Create: `src/lib/fs.ts`, `src/bank/repository.ts`
- Test: `src/bank/repository.test.ts`

- [ ] **Step 1: Write the failing test**

`src/bank/repository.test.ts`:
```ts
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { BankRepository } from "./repository";
import { emptyBank } from "./schema";

let root: string;
let repo: BankRepository;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "bank-repo-"));
  repo = new BankRepository(root);
});
afterEach(() => rm(root, { recursive: true, force: true }));

describe("BankRepository", () => {
  it("lists no profiles when the data dir does not exist", async () => {
    expect(await new BankRepository(path.join(root, "missing")).listProfiles()).toEqual([]);
  });

  it("creates a profile, then reads it back and lists it", async () => {
    const created = await repo.createProfile("sam", "Sam Smith");
    expect(created.profile.name).toBe("Sam Smith");
    expect(await repo.listProfiles()).toEqual(["sam"]);
    const read = await repo.read("sam");
    expect(read).toEqual(created);
  });

  it("refuses to create a profile twice", async () => {
    await repo.createProfile("sam", "");
    await expect(repo.createProfile("sam", "")).rejects.toMatchObject({ status: 409 });
  });

  it("rejects invalid slugs", async () => {
    await expect(repo.read("../etc")).rejects.toBeInstanceOf(AppError);
    await expect(repo.read("Bad Slug")).rejects.toMatchObject({ status: 400 });
  });

  it("404s on an unknown profile", async () => {
    await expect(repo.read("nobody")).rejects.toMatchObject({ status: 404 });
  });

  it("writes atomically and validates", async () => {
    await repo.createProfile("sam", "");
    const bank = { ...emptyBank("Sam"), summary: "hello" };
    await repo.write("sam", bank);
    expect((await repo.read("sam")).summary).toBe("hello");
    await expect(repo.write("sam", { nope: true })).rejects.toMatchObject({ status: 400 });
    expect((await readFile(path.join(root, "sam", "bank.json"), "utf8")).endsWith("\n")).toBe(true);
  });

  it("refuses to read a corrupt bank file", async () => {
    await mkdir(path.join(root, "sam"), { recursive: true });
    await writeFile(path.join(root, "sam", "bank.json"), "{ not json", "utf8");
    await expect(repo.read("sam")).rejects.toMatchObject({ status: 500 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- src/bank/repository.test.ts
```
Expected: FAIL, cannot find module './repository'.

- [ ] **Step 3: Implement**

`src/lib/fs.ts`:
```ts
import { access, mkdir, rename, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";

export function isEnoent(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "ENOENT";
}

export async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch (err) {
    if (isEnoent(err)) return false;
    throw err;
  }
}

/** Write JSON to a temp file in the same directory, then rename over the target. */
export async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tmp, file);
}
```

`src/bank/repository.ts`:
```ts
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { AppError } from "@/lib/errors";
import { exists, isEnoent, writeJsonAtomic } from "@/lib/fs";
import { type Bank, BankSchema, emptyBank } from "./schema";

export const PROFILE_SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;

export function assertProfileSlug(slug: string): string {
  if (!PROFILE_SLUG.test(slug)) {
    throw new AppError(`Invalid profile "${slug}": use lowercase letters, digits and dashes`, 400);
  }
  return slug;
}

export class BankRepository {
  constructor(readonly root: string) {}

  bankPath(slug: string): string {
    return path.join(this.root, assertProfileSlug(slug), "bank.json");
  }

  async listProfiles(): Promise<string[]> {
    let entries;
    try {
      entries = await readdir(this.root, { withFileTypes: true });
    } catch (err) {
      if (isEnoent(err)) return [];
      throw err;
    }
    const candidates = entries.filter((e) => e.isDirectory() && PROFILE_SLUG.test(e.name)).map((e) => e.name);
    const checks = await Promise.all(candidates.map(async (slug) => ((await exists(this.bankPath(slug))) ? slug : null)));
    return checks.filter((slug): slug is string => slug !== null).sort();
  }

  async createProfile(slug: string, name: string): Promise<Bank> {
    const file = this.bankPath(slug);
    if (await exists(file)) throw new AppError(`Profile "${slug}" already exists`, 409);
    const bank = emptyBank(name);
    await writeJsonAtomic(file, bank);
    return bank;
  }

  async read(slug: string): Promise<Bank> {
    const file = this.bankPath(slug);
    let raw: string;
    try {
      raw = await readFile(file, "utf8");
    } catch (err) {
      if (isEnoent(err)) throw new AppError(`Profile "${slug}" not found`, 404);
      throw err;
    }
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new AppError(`${file} is not valid JSON`, 500);
    }
    const parsed = BankSchema.safeParse(json);
    if (!parsed.success) throw new AppError(`${file} does not match the bank schema`, 500, parsed.error.issues);
    return parsed.data;
  }

  async write(slug: string, bank: unknown): Promise<Bank> {
    const parsed = BankSchema.safeParse(bank);
    if (!parsed.success) throw new AppError("Bank does not match the schema", 400, parsed.error.issues);
    await writeJsonAtomic(this.bankPath(slug), parsed.data);
    return parsed.data;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test
```
Expected: all pass (13 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/fs.ts src/bank/repository.ts src/bank/repository.test.ts
git commit -m "feat: add file-based bank repository with atomic writes"
```

---

### Task 4: LaTeX escaping and PDF page counting

> Updated during execution (commit f48abe9): `escapeLatex` also NFC-normalises, strips control and zero-width characters, maps typographic spaces to plain spaces, and maps `< > ≈ ≤ ≥ − ′ μ µ` to LaTeX commands, because a pdflatex probe showed those break the compile. The code below is the original; the repo is the source of truth.

**Files:**
- Create: `src/latex/escape.ts`, `src/latex/page-count.ts`
- Test: `src/latex/escape.test.ts`, `src/latex/page-count.test.ts`

- [ ] **Step 1: Write the failing tests**

`src/latex/escape.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { escapeLatex } from "./escape";

describe("escapeLatex", () => {
  it.each([
    ["&", "\\&"],
    ["%", "\\%"],
    ["$", "\\$"],
    ["#", "\\#"],
    ["_", "\\_"],
    ["{", "\\{"],
    ["}", "\\}"],
    ["~", "\\textasciitilde{}"],
    ["^", "\\textasciicircum{}"],
    ["\\", "\\textbackslash{}"],
  ])("escapes %s", (input, expected) => {
    expect(escapeLatex(input)).toBe(expected);
  });

  it("escapes a realistic bullet in one pass", () => {
    expect(escapeLatex("Cut costs by ~90% using C# & {Go}")).toBe(
      "Cut costs by \\textasciitilde{}90\\% using C\\# \\& \\{Go\\}",
    );
  });

  it("does not double-escape the braces it inserts", () => {
    expect(escapeLatex("a\\b")).toBe("a\\textbackslash{}b");
  });

  it("passes unicode and punctuation through", () => {
    expect(escapeLatex("naïve – café’s “quote”")).toBe("naïve – café’s “quote”");
  });

  it("handles empty strings", () => {
    expect(escapeLatex("")).toBe("");
  });
});
```

`src/latex/page-count.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { countPdfPages } from "./page-count";

describe("countPdfPages", () => {
  it("counts /Type /Page objects but not the /Pages tree", () => {
    const pdf = Buffer.from("%PDF-1.5\n1 0 obj << /Type /Pages >>\n2 0 obj << /Type /Page >>\n3 0 obj <</Type/Page>>\n");
    expect(countPdfPages(pdf)).toBe(2);
  });
  it("returns 0 when nothing matches", () => {
    expect(countPdfPages(Buffer.from("%PDF-1.5\n"))).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- src/latex
```
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`src/latex/escape.ts`:
```ts
const REPLACEMENTS: Record<string, string> = {
  "\\": "\\textbackslash{}",
  "&": "\\&",
  "%": "\\%",
  $: "\\$",
  "#": "\\#",
  _: "\\_",
  "{": "\\{",
  "}": "\\}",
  "~": "\\textasciitilde{}",
  "^": "\\textasciicircum{}",
};

/** Escape user text for inclusion in LaTeX. Single pass so inserted braces are never re-escaped. */
export function escapeLatex(text: string): string {
  return text.replace(/[\\&%$#_{}~^]/g, (ch) => REPLACEMENTS[ch]);
}
```

`src/latex/page-count.ts`:
```ts
/**
 * Counts page objects in a PDF. Relies on page objects being uncompressed,
 * which templates/resume.tex guarantees with \pdfobjcompresslevel=0.
 */
export function countPdfPages(pdf: Uint8Array): number {
  const text = Buffer.from(pdf).toString("latin1");
  const matches = text.match(/\/Type\s*\/Page(?![s\w])/g);
  return matches ? matches.length : 0;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- src/latex
```
Expected: 16 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/latex/escape.ts src/latex/escape.test.ts src/latex/page-count.ts src/latex/page-count.test.ts
git commit -m "feat: add latex escaping and pdf page counting"
```

---

### Task 5: LaTeX template and tex builder

> Updated during execution (review of commit 4f02c6a): the template now uses Crimson and the reference CV's measured margins, the `\resumeEntry` macro uses the right-flush form, `safeUrl` escapes `%`/`#` instead of deleting them, whitespace-only contact fields and links are omitted, skill items are normalised before the emptiness check, bullets go through `oneLine` and marker stripping before the blank filter, and regression tests were added. The repo is the source of truth for the final code.

**Files:**
- Create: `templates/resume.tex`, `src/latex/document.ts`, `src/latex/build.ts`, `src/latex/template.ts`, `src/latex/fixture.ts`
- Test: `src/latex/build.test.ts`

- [ ] **Step 1: Write the failing test**

`src/latex/fixture.ts` (shared by build and compile tests):
```ts
import type { ResumeDocument } from "./document";

export const exampleDocument: ResumeDocument = {
  profile: {
    name: "Alex Example",
    email: "alex@example.com",
    phone: "+44 7700 900000",
    linkedin: "https://linkedin.com/in/alex-example",
    github: "https://github.com/alex-example",
  },
  summary: "Software engineer who builds backend services & developer tools.",
  education: [
    {
      title: "Example University",
      org: "BSc Computer Science",
      location: "London, UK",
      start: "Sep 2020",
      end: "Jun 2024",
      bullets: ["Modules: Distributed Systems, Databases, Machine Learning."],
    },
  ],
  experience: [
    {
      title: "Software Engineer Intern",
      org: "Acme Corp",
      location: "London, UK",
      start: "Jul 2024",
      end: "Jan 2025",
      bullets: [
        "Built a Go service that ingests 2M events/day from Kafka into PostgreSQL.",
        "Cut p95 API latency from 800ms to 120ms by adding Redis caching and fixing N+1 queries.",
      ],
    },
  ],
  projects: [
    {
      title: "Trail Planner",
      start: "Jan 2024",
      end: "Present",
      link: "https://github.com/alex-example/trail-planner",
      bullets: ["Built a Next.js app with 15 API endpoints; ~90% of requests served from cache."],
    },
  ],
  skills: [
    { id: "s_lang", name: "Programming", items: ["TypeScript", "Python", "C++"] },
    { id: "s_infra", name: "Systems & Infrastructure", items: ["Linux", "Docker"] },
  ],
};
```

`src/latex/build.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { buildTex, CONTENT_MARKER, renderContent } from "./build";
import { exampleDocument } from "./fixture";
import { loadTemplate } from "./template";

describe("renderContent", () => {
  const tex = renderContent(exampleDocument);

  it("renders the header with escaped name and contact icons", () => {
    expect(tex).toContain("\\resumeName{Alex Example}");
    expect(tex).toContain("\\faEnvelope\\ \\href{mailto:alex@example.com}{alex@example.com}");
    expect(tex).toContain("\\faLinkedin\\ \\href{https://linkedin.com/in/alex-example}{LinkedIn}");
  });

  it("escapes special characters in text", () => {
    expect(tex).toContain("backend services \\& developer tools");
    expect(tex).toContain("\\textasciitilde{}90\\%");
    expect(tex).toContain("Systems \\& Infrastructure");
  });

  it("renders entries with dates and location on the right", () => {
    expect(tex).toContain("\\resumeEntry{\\textbf{Software Engineer Intern}, Acme Corp}{Jul 2024 -- Jan 2025 ~|~ London, UK}");
  });

  it("links a project title when a link is present and omits the location", () => {
    expect(tex).toContain("\\resumeEntry{\\href{https://github.com/alex-example/trail-planner}{\\textbf{Trail Planner}}}{Jan 2024 -- Present}");
  });

  it("omits empty sections", () => {
    const tex2 = renderContent({ ...exampleDocument, projects: [], skills: [] });
    expect(tex2).not.toContain("\\section{Projects}");
    expect(tex2).not.toContain("\\section{Skills}");
  });

  it("skips untitled draft entries and blank bullets", () => {
    const tex3 = renderContent({
      ...exampleDocument,
      projects: [
        { title: "  ", start: "", end: "", bullets: ["ghost"] },
        { title: "Real", start: "", end: "", bullets: ["", "  ", "kept"] },
      ],
      skills: [...exampleDocument.skills, { id: "s_draft", name: "  ", items: ["phantom"] }],
    });
    expect(tex3).not.toContain("ghost");
    expect(tex3).not.toContain("phantom");
    expect(tex3).toContain("\\resumeEntry{\\textbf{Real}}{}");
    expect(tex3.match(/\\item\{\} /g)?.length).toBe(
      exampleDocument.education[0].bullets.length + exampleDocument.experience[0].bullets.length + 1 + exampleDocument.skills.length,
    );
  });

  it("uses \\item{} so bullets starting with [ keep their bullet glyph", () => {
    const tex4 = renderContent({ ...exampleDocument, projects: [{ title: "P", start: "", end: "", bullets: ["[WIP] tool"] }] });
    expect(tex4).toContain("\\item{} [WIP] tool");
  });

  it("drops a pasted bullet glyph at the start of a bullet", () => {
    const tex6 = renderContent({ ...exampleDocument, projects: [{ title: "P", start: "", end: "", bullets: ["• pasted", "- dashed", "plain"] }] });
    expect(tex6).toContain("\\item{} pasted");
    expect(tex6).toContain("\\item{} dashed");
    expect(tex6).toContain("\\item{} plain");
  });

  it("collapses blank lines in single-line fields", () => {
    const tex5 = renderContent({ ...exampleDocument, experience: [{ ...exampleDocument.experience[0], title: "Lead\n\nEngineer", org: " Acme \n Corp " }] });
    expect(tex5).toContain("\\resumeEntry{\\textbf{Lead Engineer}, Acme Corp}");
  });

  it("matches the snapshot", () => {
    expect(tex).toMatchSnapshot();
  });
});

describe("buildTex", () => {
  it("fills the template marker", async () => {
    const template = await loadTemplate();
    const out = buildTex(exampleDocument, template);
    expect(out).not.toContain(CONTENT_MARKER);
    expect(out).toContain("\\begin{document}");
    expect(out).toContain("\\resumeName{Alex Example}");
  });
  it("throws when the marker is missing", () => {
    expect(() => buildTex(exampleDocument, "\\documentclass{article}")).toThrow(/marker/);
  });
  it("ignores a marker mentioned inside a comment and fills the marker line", () => {
    const template = "%% uses %%CONTENT%%\n\\begin{document}\n%%CONTENT%%\n\\end{document}\n";
    const out = buildTex(exampleDocument, template);
    expect(out.startsWith("%% uses %%CONTENT%%\n\\begin{document}\n\\resumeName")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- src/latex/build.test.ts
```
Expected: FAIL, modules not found.

- [ ] **Step 3: Create the template `templates/resume.tex`**

```latex
%% Resume Tailor template. Reproduces the look of CV_Edward.pdf (measured: A4, 0.75in sides,
%% 0.8in top/bottom, Amiri whose Latin derives from Crimson): Crimson serif, ruled section
%% headings, right-aligned dates, FontAwesome contact icons.
%% src/latex/build.ts replaces the marker line just after \begin{document} with the generated body.
%% (The marker is deliberately not mentioned here, so a replace never matches this comment.)
\documentclass[a4paper,10pt]{article}
\usepackage[a4paper,top=0.8in,bottom=0.8in,left=0.75in,right=0.75in]{geometry}
\usepackage[T1]{fontenc}
\usepackage[utf8]{inputenc}
\usepackage{crimson}
\usepackage{titlesec}
\usepackage{enumitem}
\usepackage{fontawesome5}
\usepackage[hidelinks]{hyperref}

% Keep page objects uncompressed so the app can count pages by scanning the PDF.
\pdfobjcompresslevel=0

% Backstop: render any Unicode character LaTeX does not know (emoji, CJK, ...) as "?"
% instead of failing the compile. \UTFviii@undefined@err is the kernel's utf8 error hook.
\makeatletter\def\UTFviii@undefined@err#1{?}\makeatother

\pagestyle{empty}
\setlength{\parindent}{0pt}
\raggedbottom

\titleformat{\section}{\large\bfseries}{}{0pt}{}[\vspace{-7pt}\rule{\textwidth}{0.7pt}]
\titlespacing*{\section}{0pt}{9pt}{5pt}

\setlist[itemize]{leftmargin=1.1em,labelsep=0.4em,itemsep=1pt,parsep=0pt,topsep=1pt,partopsep=0pt,label=\textbullet}

% \resumeEntry{left text}{right text}
% Right-flush form: if left + right do not fit on one line, the right part moves to the next line flush right.
\newcommand{\resumeEntry}[2]{\par\vspace{4pt}{#1\unskip\nobreak\hfill\penalty50\hskip1em\null\nobreak\hfill\mbox{#2}\parfillskip=0pt\par}\vspace{1pt}}
\newcommand{\resumeName}[1]{\begin{center}{\Huge #1}\end{center}\vspace{-6pt}}
\newcommand{\resumeContact}[1]{\begin{center}#1\end{center}\vspace{2pt}}

\begin{document}
%%CONTENT%%
\end{document}
```

- [ ] **Step 4: Implement the document type, builder and template loader**

`src/latex/document.ts`:
```ts
import type { Profile, SkillCategory } from "@/bank/schema";

/** One entry with its header fields and the final bullet texts, ready to render. */
export type DocEntry = {
  title: string;
  org?: string;
  location?: string;
  start: string;
  end: string;
  link?: string;
  bullets: string[];
};

/** A fully resolved resume: no ids, no lookups needed. */
export type ResumeDocument = {
  profile: Profile;
  summary: string;
  education: DocEntry[];
  experience: DocEntry[];
  projects: DocEntry[];
  skills: SkillCategory[];
};
```

`src/latex/build.ts`:
```ts
import type { Profile, SkillCategory } from "@/bank/schema";
import type { DocEntry, ResumeDocument } from "./document";
import { escapeLatex } from "./escape";

export const CONTENT_MARKER = "%%CONTENT%%";
/** The marker must occupy a whole line, so a mention inside a comment is never replaced. */
const MARKER_LINE = /^%%CONTENT%%$/m;

/** Bullets pasted from Word or the web often start with their own bullet glyph; drop one. */
function stripLeadingMarker(bullet: string): string {
  // A dash or asterisk only counts as a marker when followed by whitespace ("-20%" is content).
  return bullet.replace(/^(?:[\u2022\u25CF\u25AA\u2219\u00B7\uF0B7]\s*|[-*]\s+)/, "");
}

/** Single-line fields (titles, names, dates) must not contain blank lines: they break \textbf{}. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function buildTex(doc: ResumeDocument, template: string): string {
  if (!MARKER_LINE.test(template)) {
    throw new Error(`Template is missing the ${CONTENT_MARKER} marker on its own line`);
  }
  // Function replacer: a string replacement would interpret "$&" patterns in the content.
  return template.replace(MARKER_LINE, () => renderContent(doc));
}

export function renderContent(doc: ResumeDocument): string {
  const parts = [
    renderHeader(doc.profile),
    doc.summary.trim() ? escapeLatex(doc.summary.trim()) : "",
    renderSection("Education", doc.education),
    renderSection("Experience", doc.experience),
    renderSection("Projects", doc.projects),
    renderSkills(doc.skills),
  ];
  return `${parts.filter(Boolean).join("\n\n")}\n`;
}

/** URLs go inside \href{...}; strip the characters that would break the argument. */
function safeUrl(url: string): string {
  return url.replace(/[{}\\%#\s]/g, "");
}

function renderHeader(p: Profile): string {
  const items: string[] = [];
  if (p.email) items.push(`\\faEnvelope\\ \\href{mailto:${safeUrl(p.email)}}{${escapeLatex(oneLine(p.email))}}`);
  if (p.phone) items.push(`\\faPhone\\ ${escapeLatex(oneLine(p.phone))}`);
  if (p.linkedin) items.push(`\\faLinkedin\\ \\href{${safeUrl(p.linkedin)}}{LinkedIn}`);
  if (p.github) items.push(`\\faGithub\\ \\href{${safeUrl(p.github)}}{GitHub}`);
  if (p.website) items.push(`\\faGlobe\\ \\href{${safeUrl(p.website)}}{Website}`);
  const contact = items.length ? `\\resumeContact{${items.join(" \\quad ")}}` : "";
  return [`\\resumeName{${escapeLatex(oneLine(p.name))}}`, contact].filter(Boolean).join("\n");
}

function renderDates(e: DocEntry): string {
  const start = oneLine(e.start);
  const end = oneLine(e.end);
  if (start && end) return `${escapeLatex(start)} -- ${escapeLatex(end)}`;
  return escapeLatex(start || end);
}

function renderEntry(e: DocEntry): string {
  const boldTitle = `\\textbf{${escapeLatex(oneLine(e.title))}}`;
  const title = e.link ? `\\href{${safeUrl(e.link)}}{${boldTitle}}` : boldTitle;
  const left = e.org?.trim() ? `${title}, ${escapeLatex(oneLine(e.org))}` : title;
  const right = [renderDates(e), e.location?.trim() ? escapeLatex(oneLine(e.location)) : ""].filter(Boolean).join(" ~|~ ");
  const bullets = e.bullets.map((b) => b.trim()).filter(Boolean);
  const lines = [`\\resumeEntry{${left}}{${right}}`];
  if (bullets.length > 0) {
    lines.push("\\begin{itemize}");
    // \item{} so a bullet starting with "[" is not read as an optional argument.
    for (const bullet of bullets) lines.push(`  \\item{} ${escapeLatex(stripLeadingMarker(bullet))}`);
    lines.push("\\end{itemize}");
  }
  return lines.join("\n");
}

function renderSection(title: string, entries: DocEntry[]): string {
  const real = entries.filter((e) => e.title.trim());
  if (real.length === 0) return "";
  return [`\\section{${title}}`, ...real.map(renderEntry)].join("\n");
}

function renderSkills(skills: SkillCategory[]): string {
  const categories = skills.filter((c) => c.name.trim() && c.items.length > 0);
  if (categories.length === 0) return "";
  const lines = ["\\section{Skills}", "\\begin{itemize}"];
  for (const c of categories) {
    const items = c.items.map((i) => escapeLatex(oneLine(i))).filter(Boolean);
    lines.push(`  \\item{} \\textbf{${escapeLatex(oneLine(c.name))}:} ${items.join(", ")}`);
  }
  lines.push("\\end{itemize}");
  return lines.join("\n");
}
```

`src/latex/template.ts`:
```ts
import { readFile } from "node:fs/promises";
import path from "node:path";

export function templatePath(): string {
  return process.env.RESUME_TEMPLATE ?? path.join(process.cwd(), "templates", "resume.tex");
}

export async function loadTemplate(): Promise<string> {
  return readFile(templatePath(), "utf8");
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm test -- src/latex/build.test.ts
```
Expected: 13 tests pass; a snapshot file `src/latex/__snapshots__/build.test.ts.snap` is written. Open it and eyeball that the content looks like LaTeX, not garbage.

- [ ] **Step 6: Commit**

```bash
git add templates/resume.tex src/latex/document.ts src/latex/build.ts src/latex/template.ts src/latex/fixture.ts src/latex/build.test.ts src/latex/__snapshots__
git commit -m "feat: add latex template and tex builder"
```

---

### Task 6: Compile with latexmk

> Updated during execution (review of commit 257e7cb): `compileTex` now spawns latexmk in its own process group and SIGKILLs the whole group on timeout (the execFile timeout orphaned pdflatex at 100% CPU), passes `-norc` and the pdflatex flag that disables `\write18` (a crafted URL could reach it via TeX `^^xx` notation; `safeUrl` in Task 5 now also escapes `^`), distinguishes timeout and "no PDF produced" outcomes, and has tests for the timeout kill and the shell-escape refusal. The repo is the source of truth for the final code.

**Files:**
- Create: `src/latex/compile.ts`
- Test: `src/latex/compile.integration.test.ts`

- [ ] **Step 1: Write the failing test**

`src/latex/compile.integration.test.ts`:
```ts
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { buildTex } from "./build";
import { compileTex, latexEnv } from "./compile";
import { exampleDocument } from "./fixture";
import { loadTemplate } from "./template";

function hasLatexmk(): boolean {
  try {
    execFileSync("latexmk", ["--version"], { env: latexEnv(), stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!hasLatexmk())("compileTex (integration, needs latexmk)", () => {
  it("compiles the example document to a one-page PDF", async () => {
    const tex = buildTex(exampleDocument, await loadTemplate());
    const result = await compileTex(tex);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(result.pages).toBe(1);
  }, 90_000);

  it("compiles bullets full of special and unicode characters", async () => {
    const nasty = [
      "Specials: & % $ # _ { } ~ ^ \\ < > and [brackets] first",
      "Unicode: ≥99.9% uptime, ≈2× faster, 5−3, μs, naïve – café’s “quote”, ✓ done, 日本語, 🚀",
      "Spaces:\u200Bzero\u2009thin\u202Fnarrow and cafe\u0301",
    ];
    const doc = { ...exampleDocument, projects: [{ title: "Edge cases", start: "", end: "", bullets: nasty }] };
    const result = await compileTex(buildTex(doc, await loadTemplate()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pages).toBe(1);
  }, 90_000);

  it("counts pages even when the template does not disable object streams", async () => {
    const template = (await loadTemplate()).replace("\\pdfobjcompresslevel=0", "");
    const result = await compileTex(buildTex(exampleDocument, template));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pages).toBe(1);
  }, 90_000);

  it("returns the log when LaTeX fails", async () => {
    const result = await compileTex("\\documentclass{article}\\begin{document}\\undefinedmacro\\end{document}");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.log).toContain("Undefined control sequence");
  }, 90_000);
});

describe("compileTex with a missing binary", () => {
  it("reports that latexmk is missing", async () => {
    const result = await compileTex("\\documentclass{article}\\begin{document}x\\end{document}", {
      latexmkPath: "/definitely/not/latexmk",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/latexmk/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- src/latex/compile
```
Expected: FAIL, cannot find module './compile'.

- [ ] **Step 3: Implement `src/latex/compile.ts`**

```ts
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { isEnoent } from "@/lib/fs";
import { countPdfPages } from "./page-count";

const execFileAsync = promisify(execFile);

export type CompileResult =
  | { ok: true; pdf: Buffer; pages: number; log: string }
  | { ok: false; message: string; log: string };

export type CompileOptions = { latexmkPath?: string; timeoutMs?: number };

/** PATH with the usual MacTeX and Homebrew locations appended, for servers launched from an IDE. */
export function latexEnv(): NodeJS.ProcessEnv {
  const extra = ["/Library/TeX/texbin", "/usr/local/bin", "/opt/homebrew/bin"];
  return { ...process.env, PATH: [process.env.PATH, ...extra].filter(Boolean).join(":") };
}

export async function compileTex(tex: string, options: CompileOptions = {}): Promise<CompileResult> {
  const latexmk = options.latexmkPath ?? process.env.LATEXMK_PATH ?? "latexmk";
  const timeout = options.timeoutMs ?? 60_000;
  const dir = await mkdtemp(path.join(os.tmpdir(), "resume-tailor-"));
  try {
    // Prepended lines work before \documentclass, so they also protect a user-supplied template:
    // keep page objects uncompressed for page counting, and render unknown Unicode as "?" instead of failing.
    const source = [
      "\\pdfobjcompresslevel=0",
      "\\makeatletter\\def\\UTFviii@undefined@err#1{?}\\makeatother",
      tex,
    ].join("\n");
    await writeFile(path.join(dir, "resume.tex"), source, "utf8");
    try {
      await execFileAsync(
        latexmk,
        ["-pdf", "-interaction=nonstopmode", "-halt-on-error", `-output-directory=${dir}`, "resume.tex"],
        { cwd: dir, env: latexEnv(), timeout, maxBuffer: 16 * 1024 * 1024 },
      );
    } catch (err) {
      const log = await readLog(dir);
      if (isEnoent(err)) {
        return { ok: false, message: `latexmk not found at "${latexmk}". Install MacTeX or set LATEXMK_PATH.`, log };
      }
      return { ok: false, message: "LaTeX compilation failed. See the log for details.", log };
    }
    const pdf = await readFile(path.join(dir, "resume.pdf"));
    return { ok: true, pdf, pages: countPdfPages(pdf), log: await readLog(dir) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function readLog(dir: string): Promise<string> {
  try {
    return await readFile(path.join(dir, "resume.log"), "utf8");
  } catch {
    return "";
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- src/latex/compile
```
Expected: 5 tests pass (the compile tests take a few seconds each because they really run pdflatex). If the one-page test reports 2 pages, tighten `\titlespacing` or margins in the template rather than changing the test.

- [ ] **Step 5: Commit**

```bash
git add src/latex/compile.ts src/latex/compile.integration.test.ts
git commit -m "feat: compile tex to pdf with latexmk and report page count"
```

---

### Task 7: Applications schema, ids and repository

> Updated during execution (review of commit 7c773cf): `list` skips stray or unreadable files with a console warning instead of failing the whole dashboard, `get` rejects a file whose content id differs from its filename, `savePdf` is atomic (shared `writeFileAtomic` in `src/lib/fs.ts`) and 404s when the application does not exist, `delete` removes the PDF first, `slugify` strips combining marks (accent-safe), `newApplicationId` uses the local date, the schema validates `id` against `APPLICATION_ID` and `createdAt` as an ISO datetime, and tests cover these. The repo is the source of truth for the final code.

**Files:**
- Create: `src/applications/schema.ts`, `src/applications/ids.ts`, `src/applications/repository.ts`
- Test: `src/applications/ids.test.ts`, `src/applications/repository.test.ts`

- [ ] **Step 1: Write the failing tests**

`src/applications/ids.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { assertApplicationId, newApplicationId, slugify } from "./ids";

describe("slugify", () => {
  it("lowercases, dashes and trims", () => {
    expect(slugify("  Tencent  Games / EU! ")).toBe("tencent-games-eu");
  });
  it("caps length without trailing dash", () => {
    expect(slugify("a".repeat(29) + "-b")).toBe("a".repeat(29));
  });
  it("falls back when nothing is left", () => {
    expect(slugify("!!!")).toBe("application");
  });
});

describe("newApplicationId", () => {
  it("is date-company-random", () => {
    const id = newApplicationId("Acme Corp", new Date("2026-10-27T10:00:00Z"));
    expect(id).toMatch(/^2026-10-27-acme-corp-[0-9a-f]{8}$/);
    expect(assertApplicationId(id)).toBe(id);
  });
});

describe("assertApplicationId", () => {
  it("rejects path-like ids", () => {
    expect(() => assertApplicationId("../x")).toThrow();
    expect(() => assertApplicationId("A B")).toThrow();
  });
});
```

`src/applications/repository.test.ts`:
```ts
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApplicationRepository } from "./repository";
import type { Application } from "./schema";

let root: string;
let repo: ApplicationRepository;

const app = (id: string, createdAt: string): Application => ({
  id,
  createdAt,
  company: "Acme",
  roleTitle: "SWE",
  jobDescription: "Build things",
  model: "manual",
  warnings: [],
  notes: "",
  resume: { summary: "", education: [], experience: [], projects: [], skills: [] },
});

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "apps-repo-"));
  repo = new ApplicationRepository(root);
});
afterEach(() => rm(root, { recursive: true, force: true }));

describe("ApplicationRepository", () => {
  it("lists nothing for a profile with no applications", async () => {
    expect(await repo.list("sam")).toEqual([]);
  });

  it("saves, gets, and lists newest first with pdf flag", async () => {
    await repo.save("sam", app("2026-10-01-acme-aaaaaaaa", "2026-10-01T00:00:00Z"));
    await repo.save("sam", app("2026-10-02-acme-bbbbbbbb", "2026-10-02T00:00:00Z"));
    await repo.savePdf("sam", "2026-10-01-acme-aaaaaaaa", Buffer.from("%PDF-fake"));
    const list = await repo.list("sam");
    expect(list.map((a) => a.id)).toEqual(["2026-10-02-acme-bbbbbbbb", "2026-10-01-acme-aaaaaaaa"]);
    expect(list[1].hasPdf).toBe(true);
    expect(list[0].hasPdf).toBe(false);
    expect((await repo.get("sam", "2026-10-02-acme-bbbbbbbb")).company).toBe("Acme");
    expect((await repo.readPdf("sam", "2026-10-01-acme-aaaaaaaa"))?.toString()).toBe("%PDF-fake");
    expect(await repo.readPdf("sam", "2026-10-02-acme-bbbbbbbb")).toBeNull();
  });

  it("404s on unknown ids and deletes json + pdf", async () => {
    await expect(repo.get("sam", "nope")).rejects.toMatchObject({ status: 404 });
    await repo.save("sam", app("2026-10-01-acme-aaaaaaaa", "2026-10-01T00:00:00Z"));
    await repo.savePdf("sam", "2026-10-01-acme-aaaaaaaa", Buffer.from("x"));
    await repo.delete("sam", "2026-10-01-acme-aaaaaaaa");
    expect(await repo.list("sam")).toEqual([]);
    expect(await repo.readPdf("sam", "2026-10-01-acme-aaaaaaaa")).toBeNull();
  });

  it("rejects an application that fails validation", async () => {
    await expect(repo.save("sam", { id: "x" })).rejects.toMatchObject({ status: 400 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- src/applications
```
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`src/applications/schema.ts`:
```ts
import { z } from "zod";
import { SkillCategorySchema } from "@/bank/schema";

export const ResumeBulletSchema = z.object({
  bulletId: z.string(),
  original: z.string(),
  text: z.string(),
});

export const ResumeEntrySchema = z.object({
  entryId: z.string(),
  rationale: z.string().default(""),
  bullets: z.array(ResumeBulletSchema),
});

/** The editable review state: only included entries, in order, with their chosen bullets. */
export const ResumeStateSchema = z.object({
  summary: z.string(),
  education: z.array(ResumeEntrySchema),
  experience: z.array(ResumeEntrySchema),
  projects: z.array(ResumeEntrySchema),
  skills: z.array(SkillCategorySchema),
});

export const ApplicationSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  company: z.string(),
  roleTitle: z.string().default(""),
  jobDescription: z.string(),
  model: z.string(),
  warnings: z.array(z.string()).default([]),
  notes: z.string().default(""),
  resume: ResumeStateSchema,
});

export type ResumeBullet = z.infer<typeof ResumeBulletSchema>;
export type ResumeEntry = z.infer<typeof ResumeEntrySchema>;
export type ResumeState = z.infer<typeof ResumeStateSchema>;
export type Application = z.infer<typeof ApplicationSchema>;

export type ApplicationSummary = Pick<Application, "id" | "createdAt" | "company" | "roleTitle" | "model"> & {
  hasPdf: boolean;
};
```

`src/applications/ids.ts`:
```ts
import { newId } from "@/bank/ids";
import { AppError } from "@/lib/errors";

export const APPLICATION_ID = /^[a-z0-9][a-z0-9-]{0,79}$/;

export function slugify(text: string, max = 30): string {
  const slug = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/, "");
  return slug || "application";
}

export function newApplicationId(company: string, now: Date = new Date()): string {
  const date = now.toISOString().slice(0, 10);
  const random = newId("a").slice(2);
  return `${date}-${slugify(company)}-${random}`;
}

export function assertApplicationId(id: string): string {
  if (!APPLICATION_ID.test(id)) throw new AppError(`Invalid application id "${id}"`, 400);
  return id;
}
```

`src/applications/repository.ts`:
```ts
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertProfileSlug } from "@/bank/repository";
import { AppError } from "@/lib/errors";
import { exists, isEnoent, writeJsonAtomic } from "@/lib/fs";
import { assertApplicationId } from "./ids";
import { type Application, ApplicationSchema, type ApplicationSummary } from "./schema";

export class ApplicationRepository {
  constructor(readonly root: string) {}

  dir(slug: string): string {
    return path.join(this.root, assertProfileSlug(slug), "applications");
  }

  jsonPath(slug: string, id: string): string {
    return path.join(this.dir(slug), `${assertApplicationId(id)}.json`);
  }

  pdfPath(slug: string, id: string): string {
    return path.join(this.dir(slug), `${assertApplicationId(id)}.pdf`);
  }

  async list(slug: string): Promise<ApplicationSummary[]> {
    let names: string[];
    try {
      names = await readdir(this.dir(slug));
    } catch (err) {
      if (isEnoent(err)) return [];
      throw err;
    }
    const ids = names.filter((n) => n.endsWith(".json")).map((n) => n.slice(0, -".json".length));
    const summaries = await Promise.all(
      ids.map(async (id): Promise<ApplicationSummary> => {
        const app = await this.get(slug, id);
        return {
          id: app.id,
          createdAt: app.createdAt,
          company: app.company,
          roleTitle: app.roleTitle,
          model: app.model,
          hasPdf: await exists(this.pdfPath(slug, id)),
        };
      }),
    );
    return summaries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async get(slug: string, id: string): Promise<Application> {
    const file = this.jsonPath(slug, id);
    let raw: string;
    try {
      raw = await readFile(file, "utf8");
    } catch (err) {
      if (isEnoent(err)) throw new AppError(`Application "${id}" not found`, 404);
      throw err;
    }
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new AppError(`${file} is not valid JSON`, 500);
    }
    const parsed = ApplicationSchema.safeParse(json);
    if (!parsed.success) throw new AppError(`${file} does not match the application schema`, 500, parsed.error.issues);
    return parsed.data;
  }

  async save(slug: string, application: unknown): Promise<Application> {
    const parsed = ApplicationSchema.safeParse(application);
    if (!parsed.success) throw new AppError("Application does not match the schema", 400, parsed.error.issues);
    await writeJsonAtomic(this.jsonPath(slug, parsed.data.id), parsed.data);
    return parsed.data;
  }

  async delete(slug: string, id: string): Promise<void> {
    await rm(this.jsonPath(slug, id), { force: true });
    await rm(this.pdfPath(slug, id), { force: true });
  }

  async savePdf(slug: string, id: string, pdf: Buffer): Promise<void> {
    const file = this.pdfPath(slug, id);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, pdf);
  }

  async readPdf(slug: string, id: string): Promise<Buffer | null> {
    try {
      return await readFile(this.pdfPath(slug, id));
    } catch (err) {
      if (isEnoent(err)) return null;
      throw err;
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- src/applications
```
Expected: 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/applications/schema.ts src/applications/ids.ts src/applications/repository.ts src/applications/ids.test.ts src/applications/repository.test.ts
git commit -m "feat: add application schema, ids and repository"
```

---

### Task 8: Tailor output schema, limits and validator

> Updated during execution (review of commit 0a4ad4a): the validator ignores blank draft bullets, applies the project entry limit before validating bullets (naming dropped projects), restores forgotten pinned bullets at their bank position, keeps all pinned bullets when they exceed the limit without a false "Trimmed" warning, warns on duplicate bullets/skill categories and on entries left with no bullets, trims notes and rationale, and uses user-facing warning wording. The repo is the source of truth for the final code.

**Files:**
- Create: `src/tailor/schema.ts`, `src/tailor/limits.ts`, `src/tailor/validate.ts`
- Test: `src/tailor/validate.test.ts`

- [ ] **Step 1: Write the failing test**

`src/tailor/validate.test.ts`:
```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BankSchema } from "@/bank/schema";
import type { TailorResult } from "./schema";
import { validateTailorResult } from "./validate";

const bank = BankSchema.parse(JSON.parse(readFileSync("data/example/bank.json", "utf8")));

const base: TailorResult = {
  summary: "Tailored summary.",
  education: [{ entryId: "e_edu1", rationale: "r", bullets: [{ bulletId: "b_edu1a", edited: null }] }],
  experience: [
    {
      entryId: "e_exp1",
      rationale: "Backend match",
      bullets: [
        { bulletId: "b_exp1b", edited: "Cut p95 API latency from 800ms to 120ms with Redis caching." },
        { bulletId: "b_exp1c", edited: "Wrote Playwright end-to-end tests covering the checkout flow, catching 3 regressions before release." },
      ],
    },
  ],
  projects: [{ entryId: "e_prj1", rationale: "r", bullets: [{ bulletId: "b_prj1a", edited: null }] }],
  skills: [{ name: "programming", items: ["go", "TypeScript", "Rust"] }],
  notes: "",
};

describe("validateTailorResult", () => {
  it("keeps valid selections and normalises edits", () => {
    const { result, warnings } = validateTailorResult(bank, base);
    const exp = result.experience[0];
    expect(exp.bullets[0].edited).toBe("Cut p95 API latency from 800ms to 120ms with Redis caching.");
    // edit identical to the original is normalised to null
    expect(exp.bullets[1].edited).toBeNull();
    expect(warnings.filter((w) => w.includes("Rust"))).toHaveLength(1);
  });

  it("adds pinned bullets that were left out", () => {
    const { result } = validateTailorResult(bank, base);
    expect(result.experience[0].bullets.map((b) => b.bulletId)).toContain("b_exp1a");
  });

  it("drops unknown entry and bullet ids with warnings", () => {
    const bad: TailorResult = {
      ...base,
      experience: [
        { entryId: "e_ghost", rationale: "", bullets: [] },
        { entryId: "e_exp1", rationale: "", bullets: [{ bulletId: "b_ghost", edited: null }] },
      ],
    };
    const { result, warnings } = validateTailorResult(bank, bad);
    expect(result.experience.map((e) => e.entryId)).toEqual(["e_exp1"]);
    expect(warnings.some((w) => w.includes("e_ghost"))).toBe(true);
    expect(warnings.some((w) => w.includes("b_ghost"))).toBe(true);
  });

  it("drops duplicate entries", () => {
    const dup: TailorResult = { ...base, experience: [base.experience[0], base.experience[0]] };
    expect(validateTailorResult(bank, dup).result.experience).toHaveLength(1);
  });

  it("enforces bullet limits while keeping pinned bullets", () => {
    const many: TailorResult = {
      ...base,
      experience: [
        {
          entryId: "e_exp1",
          rationale: "",
          bullets: ["b_exp1b", "b_exp1c", "b_exp1d", "b_exp1a"].map((bulletId) => ({ bulletId, edited: null })),
        },
      ],
    };
    const { result, warnings } = validateTailorResult(bank, many, {
      experienceBullets: 2,
      projectEntries: 3,
      projectBullets: 5,
      educationBullets: 2,
    });
    const ids = result.experience[0].bullets.map((b) => b.bulletId);
    expect(ids).toHaveLength(2);
    expect(ids).toContain("b_exp1a");
    expect(ids).toContain("b_exp1b");
    expect(warnings.some((w) => w.startsWith("Trimmed"))).toBe(true);
  });

  it("limits the number of projects", () => {
    const { result, warnings } = validateTailorResult(bank, base, {
      experienceBullets: 5,
      projectEntries: 0,
      projectBullets: 5,
      educationBullets: 2,
    });
    expect(result.projects).toEqual([]);
    expect(warnings.some((w) => w.includes("projects"))).toBe(true);
  });

  it("keeps education in bank order", () => {
    const twoEdu = {
      ...bank,
      education: [bank.education[0], { ...bank.education[0], id: "e_edu2", title: "Second School" }],
    };
    const reversed: TailorResult = {
      ...base,
      education: [
        { entryId: "e_edu2", rationale: "", bullets: [] },
        { entryId: "e_edu1", rationale: "", bullets: [] },
      ],
    };
    expect(validateTailorResult(twoEdu, reversed).result.education.map((e) => e.entryId)).toEqual(["e_edu1", "e_edu2"]);
  });

  it("matches skills case-insensitively and uses the bank spelling", () => {
    const { result } = validateTailorResult(bank, base);
    expect(result.skills).toEqual([{ name: "Programming", items: ["Go", "TypeScript"] }]);
  });

  it("falls back to the master summary when Claude returns none", () => {
    const { result, warnings } = validateTailorResult(bank, { ...base, summary: "  " });
    expect(result.summary).toBe(bank.summary);
    expect(warnings.some((w) => w.includes("summary"))).toBe(true);
  });

  it("does not mutate its inputs", () => {
    const snapshot = JSON.stringify(base);
    validateTailorResult(bank, base);
    expect(JSON.stringify(base)).toBe(snapshot);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- src/tailor
```
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`src/tailor/schema.ts`:
```ts
import { z } from "zod";

// Structured output schema for Claude. Optional values are modelled as nullable so every
// property is required in the JSON schema, which structured outputs expect.
export const SelectedBulletSchema = z.object({
  bulletId: z.string(),
  edited: z.string().nullable(),
});

export const SelectedEntrySchema = z.object({
  entryId: z.string(),
  rationale: z.string(),
  bullets: z.array(SelectedBulletSchema),
});

export const TailorSkillCategorySchema = z.object({
  name: z.string(),
  items: z.array(z.string()),
});

export const TailorResultSchema = z.object({
  summary: z.string(),
  education: z.array(SelectedEntrySchema),
  experience: z.array(SelectedEntrySchema),
  projects: z.array(SelectedEntrySchema),
  skills: z.array(TailorSkillCategorySchema),
  notes: z.string(),
});

export type SelectedBullet = z.infer<typeof SelectedBulletSchema>;
export type SelectedEntry = z.infer<typeof SelectedEntrySchema>;
export type TailorSkillCategory = z.infer<typeof TailorSkillCategorySchema>;
export type TailorResult = z.infer<typeof TailorResultSchema>;
```

`src/tailor/limits.ts`:
```ts
export type TailorLimits = {
  experienceBullets: number;
  projectEntries: number;
  projectBullets: number;
  educationBullets: number;
};

export const DEFAULT_LIMITS: TailorLimits = {
  experienceBullets: 5,
  projectEntries: 3,
  projectBullets: 5,
  educationBullets: 2,
};
```

`src/tailor/validate.ts`:
```ts
import type { Bank, Entry, SectionKey } from "@/bank/schema";
import { DEFAULT_LIMITS, type TailorLimits } from "./limits";
import type { SelectedBullet, SelectedEntry, TailorResult, TailorSkillCategory } from "./schema";

export type ValidatedTailor = { result: TailorResult; warnings: string[] };

const norm = (s: string) => s.trim().toLowerCase();

/** Reconcile Claude's answer with the bank: unknown ids are dropped, pinned bullets enforced, limits applied. */
export function validateTailorResult(bank: Bank, result: TailorResult, limits: TailorLimits = DEFAULT_LIMITS): ValidatedTailor {
  const warnings: string[] = [];

  const education = sortByBankOrder(bank.education, validateSection(bank, "education", result.education, limits.educationBullets, warnings));
  const experience = validateSection(bank, "experience", result.experience, limits.experienceBullets, warnings);
  const allProjects = validateSection(bank, "projects", result.projects, limits.projectBullets, warnings);
  const projects = allProjects.length > limits.projectEntries ? allProjects.slice(0, limits.projectEntries) : allProjects;
  if (projects.length !== allProjects.length) {
    warnings.push(`Trimmed projects from ${allProjects.length} to ${limits.projectEntries}`);
  }

  const summary = result.summary.trim() || bank.summary;
  if (!result.summary.trim()) warnings.push("Claude returned an empty summary; using the master summary instead");

  const skills = validateSkills(bank, result.skills, warnings);

  return { result: { summary, education, experience, projects, skills, notes: result.notes }, warnings };
}

function validateSection(bank: Bank, section: SectionKey, selected: SelectedEntry[], maxBullets: number, warnings: string[]): SelectedEntry[] {
  const byId = new Map(bank[section].map((e) => [e.id, e]));
  const seen = new Set<string>();
  const out: SelectedEntry[] = [];
  for (const sel of selected) {
    const entry = byId.get(sel.entryId);
    if (!entry) {
      warnings.push(`Dropped unknown ${section} entry "${sel.entryId}"`);
      continue;
    }
    if (seen.has(sel.entryId)) {
      warnings.push(`Dropped duplicate ${section} entry "${entry.title}"`);
      continue;
    }
    seen.add(sel.entryId);
    out.push({ entryId: sel.entryId, rationale: sel.rationale, bullets: validateBullets(entry, sel.bullets, maxBullets, warnings) });
  }
  return out;
}

function validateBullets(entry: Entry, selected: SelectedBullet[], max: number, warnings: string[]): SelectedBullet[] {
  const byId = new Map(entry.bullets.map((b) => [b.id, b]));
  const seen = new Set<string>();
  const kept: SelectedBullet[] = [];
  for (const sel of selected) {
    const bullet = byId.get(sel.bulletId);
    if (!bullet) {
      warnings.push(`Dropped unknown bullet "${sel.bulletId}" in "${entry.title}"`);
      continue;
    }
    if (seen.has(sel.bulletId)) continue;
    seen.add(sel.bulletId);
    const edited = sel.edited?.trim() ?? "";
    kept.push({ bulletId: sel.bulletId, edited: edited && edited !== bullet.text.trim() ? edited : null });
  }
  for (const bullet of entry.bullets) {
    if (bullet.pinned && !seen.has(bullet.id)) {
      seen.add(bullet.id);
      kept.push({ bulletId: bullet.id, edited: null });
    }
  }
  if (kept.length <= max) return kept;

  const pinnedIds = new Set(entry.bullets.filter((b) => b.pinned).map((b) => b.id));
  const pinned = kept.filter((k) => pinnedIds.has(k.bulletId));
  const rest = kept.filter((k) => !pinnedIds.has(k.bulletId));
  const keepIds = new Set([...pinned, ...rest].slice(0, Math.max(max, pinned.length)).map((k) => k.bulletId));
  warnings.push(`Trimmed "${entry.title}" from ${kept.length} to ${keepIds.size} bullets`);
  return kept.filter((k) => keepIds.has(k.bulletId));
}

function sortByBankOrder(bankEntries: Entry[], selected: SelectedEntry[]): SelectedEntry[] {
  const index = new Map(bankEntries.map((e, i) => [e.id, i]));
  return [...selected].sort((a, b) => (index.get(a.entryId) ?? 0) - (index.get(b.entryId) ?? 0));
}

function validateSkills(bank: Bank, skills: TailorSkillCategory[], warnings: string[]): TailorSkillCategory[] {
  const out: TailorSkillCategory[] = [];
  const used = new Set<string>();
  for (const cat of skills) {
    const bankCat = bank.skills.find((c) => norm(c.name) === norm(cat.name));
    if (!bankCat) {
      warnings.push(`Dropped unknown skills category "${cat.name}"`);
      continue;
    }
    if (used.has(bankCat.id)) continue;
    used.add(bankCat.id);
    const items: string[] = [];
    for (const item of cat.items) {
      const match = bankCat.items.find((i) => norm(i) === norm(item));
      if (!match) {
        warnings.push(`Dropped unknown skill "${item}" in ${bankCat.name}`);
        continue;
      }
      if (!items.includes(match)) items.push(match);
    }
    if (items.length > 0) out.push({ name: bankCat.name, items });
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- src/tailor
```
Expected: 10 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/tailor/schema.ts src/tailor/limits.ts src/tailor/validate.ts src/tailor/validate.test.ts
git commit -m "feat: add tailor output schema and bank-aware validator"
```

---

### Task 9: Resume state (from tailor result, full bank, resolve) and edit helpers

> Updated during execution (review of commit 959d6bb): shared `isRealBullet`/`toResumeBullet`/`toResumeEntry` helpers keep blank draft bullets, untitled entries and unnamed skill categories out of review state; `addBullet` takes the bank and re-adds at bank position (as does `includeEntry`); no-op edits return the same state reference; `pruneMissing(state, bank)` drops entries deleted from the bank and Task 15 calls it on load. The repo is the source of truth for the final code.

**Files:**
- Create: `src/applications/resume-state.ts`, `src/applications/edit.ts`
- Test: `src/applications/resume-state.test.ts`, `src/applications/edit.test.ts`

- [ ] **Step 1: Write the failing tests**

`src/applications/resume-state.test.ts`:
```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BankSchema } from "@/bank/schema";
import { renderContent } from "@/latex/build";
import type { TailorResult } from "@/tailor/schema";
import { fromTailorResult, fullStateFromBank, resolveResume } from "./resume-state";

const bank = BankSchema.parse(JSON.parse(readFileSync("data/example/bank.json", "utf8")));

const result: TailorResult = {
  summary: "Tailored.",
  education: [{ entryId: "e_edu1", rationale: "", bullets: [{ bulletId: "b_edu1a", edited: null }] }],
  experience: [
    {
      entryId: "e_exp1",
      rationale: "Backend",
      bullets: [
        { bulletId: "b_exp1b", edited: "Cut p95 latency to 120ms." },
        { bulletId: "b_exp1a", edited: null },
      ],
    },
  ],
  projects: [],
  skills: [{ name: "Programming", items: ["Go", "TypeScript"] }],
  notes: "",
};

describe("fromTailorResult", () => {
  it("keeps original text and applies edits", () => {
    const state = fromTailorResult(bank, result);
    const exp = state.experience[0];
    expect(exp.rationale).toBe("Backend");
    expect(exp.bullets[0]).toEqual({
      bulletId: "b_exp1b",
      original: "Cut p95 API latency from 800ms to 120ms by adding Redis caching and fixing N+1 queries.",
      text: "Cut p95 latency to 120ms.",
    });
    expect(exp.bullets[1].text).toBe(exp.bullets[1].original);
    expect(state.skills).toEqual([{ id: "s_lang", name: "Programming", items: ["Go", "TypeScript"] }]);
    expect(state.projects).toEqual([]);
  });
});

describe("fullStateFromBank", () => {
  it("includes every entry and bullet unchanged", () => {
    const state = fullStateFromBank(bank);
    expect(state.experience).toHaveLength(2);
    expect(state.experience[0].bullets).toHaveLength(4);
    expect(state.summary).toBe(bank.summary);
    expect(state.skills).toEqual(bank.skills);
    expect(state.skills).not.toBe(bank.skills);
  });
});

describe("resolveResume", () => {
  it("joins state with bank headers and renders", () => {
    const doc = resolveResume(bank, fromTailorResult(bank, result));
    expect(doc.experience[0].title).toBe("Software Engineer Intern");
    expect(doc.experience[0].org).toBe("Acme Corp");
    expect(doc.experience[0].bullets).toEqual([
      "Cut p95 latency to 120ms.",
      "Built a Go service that ingests 2M events/day from Kafka into PostgreSQL with exactly-once semantics.",
    ]);
    expect(renderContent(doc)).toContain("\\section{Experience}");
  });

  it("skips entries that no longer exist in the bank", () => {
    const state = fromTailorResult(bank, result);
    const doc = resolveResume({ ...bank, experience: [] }, state);
    expect(doc.experience).toEqual([]);
  });
});
```

`src/applications/edit.test.ts`:
```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BankSchema } from "@/bank/schema";
import {
  addBullet,
  excludeEntry,
  includeEntry,
  moveBullet,
  moveEntry,
  moveItem,
  removeBullet,
  revertBullet,
  setBulletText,
  setSkills,
  setSummary,
} from "./edit";
import { fullStateFromBank } from "./resume-state";

const bank = BankSchema.parse(JSON.parse(readFileSync("data/example/bank.json", "utf8")));
const state = fullStateFromBank(bank);
const ids = (s: typeof state) => s.experience[0].bullets.map((b) => b.bulletId);

describe("moveItem", () => {
  it("moves within bounds and copies", () => {
    const arr = [1, 2, 3];
    expect(moveItem(arr, 0, 2)).toEqual([2, 3, 1]);
    expect(moveItem(arr, 2, 0)).toEqual([3, 1, 2]);
    expect(arr).toEqual([1, 2, 3]);
  });
  it("ignores out-of-range moves", () => {
    expect(moveItem([1, 2], 1, 2)).toEqual([1, 2]);
    expect(moveItem([1, 2], 0, -1)).toEqual([1, 2]);
  });
});

describe("bullet edits", () => {
  it("sets and reverts text without mutating", () => {
    const edited = setBulletText(state, "experience", "e_exp1", "b_exp1a", "New text");
    expect(edited.experience[0].bullets[0].text).toBe("New text");
    expect(state.experience[0].bullets[0].text).not.toBe("New text");
    const reverted = revertBullet(edited, "experience", "e_exp1", "b_exp1a");
    expect(reverted.experience[0].bullets[0].text).toBe(state.experience[0].bullets[0].original);
  });

  it("removes, re-adds (once) and moves bullets", () => {
    const removed = removeBullet(state, "experience", "e_exp1", "b_exp1a");
    expect(ids(removed)).toEqual(["b_exp1b", "b_exp1c", "b_exp1d"]);
    const bullet = bank.experience[0].bullets[0];
    const added = addBullet(removed, "experience", "e_exp1", bullet);
    expect(ids(added)).toEqual(["b_exp1b", "b_exp1c", "b_exp1d", "b_exp1a"]);
    expect(addBullet(added, "experience", "e_exp1", bullet)).toBe(added);
    expect(ids(moveBullet(added, "experience", "e_exp1", "b_exp1a", -1))).toEqual(["b_exp1b", "b_exp1c", "b_exp1a", "b_exp1d"]);
    expect(ids(moveBullet(added, "experience", "e_exp1", "b_exp1b", -1))).toEqual(ids(added));
  });
});

describe("entry edits", () => {
  it("excludes, includes with all bullets, and moves entries", () => {
    const without = excludeEntry(state, "experience", "e_exp1");
    expect(without.experience.map((e) => e.entryId)).toEqual(["e_exp2"]);
    const back = includeEntry(without, bank, "experience", "e_exp1");
    expect(back.experience.map((e) => e.entryId)).toEqual(["e_exp2", "e_exp1"]);
    expect(back.experience[1].bullets).toHaveLength(4);
    expect(includeEntry(back, bank, "experience", "e_exp1")).toBe(back);
    expect(includeEntry(back, bank, "experience", "e_ghost")).toBe(back);
    expect(moveEntry(back, "experience", "e_exp1", -1).experience.map((e) => e.entryId)).toEqual(["e_exp1", "e_exp2"]);
  });
});

describe("summary and skills", () => {
  it("replace values immutably", () => {
    expect(setSummary(state, "S").summary).toBe("S");
    const skills = setSkills(state, [{ id: "s_lang", name: "Programming", items: ["Go"] }]).skills;
    expect(skills).toEqual([{ id: "s_lang", name: "Programming", items: ["Go"] }]);
    expect(state.skills).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- src/applications
```
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`src/applications/resume-state.ts`:
```ts
import type { Bank, Entry, SectionKey } from "@/bank/schema";
import type { DocEntry, ResumeDocument } from "@/latex/document";
import type { SelectedEntry, TailorResult } from "@/tailor/schema";
import type { ResumeEntry, ResumeState } from "./schema";

/** Turn a validated Claude result into editable review state, keeping original bullet text. */
export function fromTailorResult(bank: Bank, result: TailorResult): ResumeState {
  const section = (key: SectionKey, selected: SelectedEntry[]): ResumeEntry[] => {
    const byId = new Map(bank[key].map((e) => [e.id, e]));
    return selected.flatMap((sel) => {
      const entry = byId.get(sel.entryId);
      if (!entry) return [];
      const bulletsById = new Map(entry.bullets.map((b) => [b.id, b]));
      const bullets = sel.bullets.flatMap((sb) => {
        const bullet = bulletsById.get(sb.bulletId);
        if (!bullet) return [];
        return [{ bulletId: bullet.id, original: bullet.text, text: sb.edited ?? bullet.text }];
      });
      return [{ entryId: entry.id, rationale: sel.rationale, bullets }];
    });
  };
  const skills = result.skills.flatMap((cat) => {
    const bankCat = bank.skills.find((c) => c.name === cat.name);
    return bankCat ? [{ id: bankCat.id, name: bankCat.name, items: [...cat.items] }] : [];
  });
  return {
    summary: result.summary,
    education: section("education", result.education),
    experience: section("experience", result.experience),
    projects: section("projects", result.projects),
    skills,
  };
}

/** Everything in the bank, unchanged. Used for the no-AI path and tests. */
export function fullStateFromBank(bank: Bank): ResumeState {
  const all = (entries: Entry[]): ResumeEntry[] =>
    entries.map((e) => ({
      entryId: e.id,
      rationale: "",
      bullets: e.bullets.map((b) => ({ bulletId: b.id, original: b.text, text: b.text })),
    }));
  return {
    summary: bank.summary,
    education: all(bank.education),
    experience: all(bank.experience),
    projects: all(bank.projects),
    skills: bank.skills.map((c) => ({ ...c, items: [...c.items] })),
  };
}

/** Join review state with bank headers into a render-ready document. Entries missing from the bank are skipped. */
export function resolveResume(bank: Bank, state: ResumeState): ResumeDocument {
  const section = (key: SectionKey): DocEntry[] => {
    const byId = new Map(bank[key].map((e) => [e.id, e]));
    return state[key].flatMap((re) => {
      const entry = byId.get(re.entryId);
      if (!entry) return [];
      return [
        {
          title: entry.title,
          org: entry.org,
          location: entry.location,
          start: entry.start,
          end: entry.end,
          link: entry.link,
          bullets: re.bullets.map((b) => b.text),
        },
      ];
    });
  };
  return {
    profile: bank.profile,
    summary: state.summary,
    education: section("education"),
    experience: section("experience"),
    projects: section("projects"),
    skills: state.skills,
  };
}
```

`src/applications/edit.ts`:
```ts
import type { Bank, Bullet, SectionKey, SkillCategory } from "@/bank/schema";
import type { ResumeEntry, ResumeState } from "./schema";

export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const copy = [...items];
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return copy;
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}

function mapEntry(state: ResumeState, section: SectionKey, entryId: string, fn: (e: ResumeEntry) => ResumeEntry): ResumeState {
  return { ...state, [section]: state[section].map((e) => (e.entryId === entryId ? fn(e) : e)) };
}

export function setBulletText(state: ResumeState, section: SectionKey, entryId: string, bulletId: string, text: string): ResumeState {
  return mapEntry(state, section, entryId, (e) => ({
    ...e,
    bullets: e.bullets.map((b) => (b.bulletId === bulletId ? { ...b, text } : b)),
  }));
}

export function revertBullet(state: ResumeState, section: SectionKey, entryId: string, bulletId: string): ResumeState {
  return mapEntry(state, section, entryId, (e) => ({
    ...e,
    bullets: e.bullets.map((b) => (b.bulletId === bulletId ? { ...b, text: b.original } : b)),
  }));
}

export function removeBullet(state: ResumeState, section: SectionKey, entryId: string, bulletId: string): ResumeState {
  return mapEntry(state, section, entryId, (e) => ({ ...e, bullets: e.bullets.filter((b) => b.bulletId !== bulletId) }));
}

export function addBullet(state: ResumeState, section: SectionKey, entryId: string, bullet: Bullet): ResumeState {
  const entry = state[section].find((e) => e.entryId === entryId);
  if (!entry || entry.bullets.some((b) => b.bulletId === bullet.id)) return state;
  return mapEntry(state, section, entryId, (e) => ({
    ...e,
    bullets: [...e.bullets, { bulletId: bullet.id, original: bullet.text, text: bullet.text }],
  }));
}

export function moveBullet(state: ResumeState, section: SectionKey, entryId: string, bulletId: string, direction: -1 | 1): ResumeState {
  return mapEntry(state, section, entryId, (e) => {
    const index = e.bullets.findIndex((b) => b.bulletId === bulletId);
    return { ...e, bullets: moveItem(e.bullets, index, index + direction) };
  });
}

export function includeEntry(state: ResumeState, bank: Bank, section: SectionKey, entryId: string): ResumeState {
  if (state[section].some((e) => e.entryId === entryId)) return state;
  const entry = bank[section].find((e) => e.id === entryId);
  if (!entry) return state;
  const added: ResumeEntry = {
    entryId,
    rationale: "Added manually",
    bullets: entry.bullets.map((b) => ({ bulletId: b.id, original: b.text, text: b.text })),
  };
  return { ...state, [section]: [...state[section], added] };
}

export function excludeEntry(state: ResumeState, section: SectionKey, entryId: string): ResumeState {
  return { ...state, [section]: state[section].filter((e) => e.entryId !== entryId) };
}

export function moveEntry(state: ResumeState, section: SectionKey, entryId: string, direction: -1 | 1): ResumeState {
  const index = state[section].findIndex((e) => e.entryId === entryId);
  return { ...state, [section]: moveItem(state[section], index, index + direction) };
}

export function setSummary(state: ResumeState, summary: string): ResumeState {
  return { ...state, summary };
}

export function setSkills(state: ResumeState, skills: SkillCategory[]): ResumeState {
  return { ...state, skills: skills.map((c) => ({ ...c, items: [...c.items] })) };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/applications/resume-state.ts src/applications/edit.ts src/applications/resume-state.test.ts src/applications/edit.test.ts
git commit -m "feat: add resume state conversion and pure edit helpers"
```

---

### Task 10: Prompt, Claude model client, tailor orchestrator

> Updated during execution (review of commit 8eb73a0): the client calls `messages.create` with the zod output format, checks `stop_reason` (refusal, max_tokens) BEFORE parsing with the format's parser (a `messages.parse` call would throw first and surface a raw 500), uses a 5-minute timeout with one retry, maps timeouts to 504; the system prompt names the tagged blocks as data (prompt-injection guard), forbids moving facts between bullets, states that pinned bullets count toward limits, requires at least one bullet per entry, and routes unmet JD requirements to notes; a pasted `</job_description>` tag is neutralised; stubbed-fetch tests cover the client's failure paths. Known follow-up: server-side refusal fallbacks (`fallbacks: "default"` beta) are not enabled. The repo is the source of truth for the final code.

**Files:**
- Create: `src/tailor/prompt.ts`, `src/tailor/model.ts`, `src/tailor/anthropic-model.ts`, `src/tailor/tailor.ts`
- Test: `src/tailor/prompt.test.ts`, `src/tailor/tailor.test.ts`

- [ ] **Step 1: Write the failing tests**

`src/tailor/prompt.test.ts`:
```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BankSchema } from "@/bank/schema";
import { DEFAULT_LIMITS } from "./limits";
import { bankForPrompt, buildSystemPrompt, buildUserMessage } from "./prompt";

const bank = BankSchema.parse(JSON.parse(readFileSync("data/example/bank.json", "utf8")));

describe("buildSystemPrompt", () => {
  it("states the limits and the no-invention rule", () => {
    const prompt = buildSystemPrompt(DEFAULT_LIMITS);
    expect(prompt).toContain("at most 5 bullets per experience entry");
    expect(prompt).toContain("at most 3 projects");
    expect(prompt).toContain("Never invent");
  });
});

describe("bankForPrompt", () => {
  it("keeps ids and pinned flags, drops category ids", () => {
    const compact = bankForPrompt(bank);
    expect(compact.experience[0].id).toBe("e_exp1");
    expect(compact.experience[0].bullets[0]).toEqual({ id: "b_exp1a", text: bank.experience[0].bullets[0].text, pinned: true });
    expect(compact.experience[0].bullets[1]).toEqual({ id: "b_exp1b", text: bank.experience[0].bullets[1].text });
    expect(compact.skills[0]).toEqual({ name: "Programming", items: bank.skills[0].items });
  });

  it("drops untitled draft entries and blank bullets", () => {
    const withDrafts = {
      ...bank,
      projects: [
        ...bank.projects,
        { id: "e_draft", title: "", start: "", end: "", bullets: [{ id: "b_x", text: "x" }] },
      ],
      experience: [{ ...bank.experience[0], bullets: [...bank.experience[0].bullets, { id: "b_blank", text: "  " }] }],
      skills: [...bank.skills, { id: "s_draft", name: "  ", items: ["x"] }],
    };
    const compact = bankForPrompt(withDrafts);
    expect(compact.projects.map((p) => p.id)).toEqual(["e_prj1"]);
    expect(compact.experience[0].bullets.map((b) => b.id)).not.toContain("b_blank");
    expect(compact.skills.map((s) => s.name)).not.toContain("  ");
  });
});

describe("buildUserMessage", () => {
  it("wraps the JD and bank in tags and names the target", () => {
    const msg = buildUserMessage(bank, "  We need Go.  ", "Acme", "Backend Engineer");
    expect(msg).toContain("Target role: Backend Engineer at Acme");
    expect(msg).toContain("<job_description>\nWe need Go.\n</job_description>");
    expect(msg).toContain('"master_summary"');
  });
});
```

`src/tailor/tailor.test.ts`:
```ts
import { cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApplicationRepository } from "@/applications/repository";
import { BankRepository } from "@/bank/repository";
import type { TailorModel, TailorRequest } from "./model";
import type { TailorResult } from "./schema";
import { createManualApplication, runTailor } from "./tailor";

let root: string;
let banks: BankRepository;
let applications: ApplicationRepository;

const fakeResult: TailorResult = {
  summary: "Go-focused summary.",
  education: [{ entryId: "e_edu1", rationale: "r", bullets: [{ bulletId: "b_edu1a", edited: null }] }],
  experience: [{ entryId: "e_exp1", rationale: "Go service", bullets: [{ bulletId: "b_exp1b", edited: "Cut latency." }] }],
  projects: [],
  skills: [{ name: "Programming", items: ["Go"] }],
  notes: "JD asks for Rust; bank has none.",
};

class FakeModel implements TailorModel {
  readonly id = "fake-model";
  requests: TailorRequest[] = [];
  constructor(private readonly result: TailorResult) {}
  async tailor(req: TailorRequest): Promise<TailorResult> {
    this.requests.push(req);
    return this.result;
  }
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "tailor-"));
  await cp("data/example", path.join(root, "example"), { recursive: true });
  banks = new BankRepository(root);
  applications = new ApplicationRepository(root);
});
afterEach(() => rm(root, { recursive: true, force: true }));

describe("runTailor", () => {
  it("calls the model with the bank, validates, and saves an application", async () => {
    const model = new FakeModel(fakeResult);
    const now = () => new Date(2026, 9, 27, 9); // local time: ids use the local date
    const app = await runTailor(
      { profile: "example", jobDescription: "We need Go.", company: "Acme Corp", roleTitle: "Backend" },
      { banks, applications, model, now },
    );
    expect(app.id).toMatch(/^2026-10-27-acme-corp-[0-9a-f]{8}$/);
    expect(app.model).toBe("fake-model");
    expect(app.notes).toContain("Rust");
    expect(app.resume.summary).toBe("Go-focused summary.");
    expect(app.resume.experience[0].bullets.map((b) => b.bulletId)).toEqual(["b_exp1a", "b_exp1b"]);
    expect(model.requests[0].user).toContain("We need Go.");
    expect(await applications.get("example", app.id)).toEqual(app);
  });

  it("rejects an empty job description or company", async () => {
    const deps = { banks, applications, model: new FakeModel(fakeResult) };
    await expect(runTailor({ profile: "example", jobDescription: " ", company: "Acme" }, deps)).rejects.toMatchObject({ status: 400 });
    await expect(runTailor({ profile: "example", jobDescription: "x", company: " " }, deps)).rejects.toMatchObject({ status: 400 });
  });
});

describe("createManualApplication", () => {
  it("saves the full bank as the starting state", async () => {
    const app = await createManualApplication({ profile: "example", jobDescription: "JD", company: "Acme" }, { banks, applications });
    expect(app.model).toBe("manual");
    expect(app.resume.experience).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- src/tailor
```
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`src/tailor/prompt.ts`:
```ts
import type { Bank, Entry } from "@/bank/schema";
import type { TailorLimits } from "./limits";

export function buildSystemPrompt(limits: TailorLimits): string {
  return `You are an expert technical resume editor. You receive a candidate's complete experience bank as JSON (every entry and bullet has an id) and a job description (JD). Produce a tailored selection for this specific JD.

Rules:
1. Select bullets ONLY by their id. Never invent a bullet that has no id in the bank.
2. For a selected bullet you may return "edited" text, or null to keep it unchanged. An edit must keep every fact, number, tool and outcome exactly. You may reorder clauses, mirror the JD's vocabulary where the bank already supports it, and tighten length. Never add claims, tools or metrics that are not in the bank.
3. Bullets marked "pinned": true must be included whenever their entry is included.
4. Limits: at most ${limits.experienceBullets} bullets per experience entry, at most ${limits.projectEntries} projects with at most ${limits.projectBullets} bullets each, at most ${limits.educationBullets} bullets per education entry. The resume must fit one page, so prefer fewer, stronger bullets.
5. Include every experience entry unless it is clearly irrelevant. Order experience and projects by relevance to the JD, most relevant first. Education stays in bank order.
6. Rewrite "summary" in 2-3 sentences for this JD using only facts from the bank and the master summary.
7. "skills": return the bank's categories by exact name and items by exact spelling, reordered so the most JD-relevant appear first. You may drop items. Never add items.
8. "rationale": one short sentence per included entry on why it was included.
9. "notes": anything the candidate should know, for example JD requirements the bank cannot support. Use an empty string if there is nothing.`;
}

/** Compact bank for the prompt: keeps ids and pinned flags, drops untitled drafts, blank bullets and unnamed skill categories. */
export function bankForPrompt(bank: Bank) {
  const entries = (list: Entry[]) =>
    list
      .filter((e) => e.title.trim())
      .map((e) => ({
        id: e.id,
        title: e.title,
        org: e.org,
        location: e.location,
        start: e.start,
        end: e.end,
        bullets: e.bullets
          .filter((b) => b.text.trim())
          .map((b) => ({ id: b.id, text: b.text, ...(b.pinned ? { pinned: true } : {}) })),
      }));
  return {
    master_summary: bank.summary,
    education: entries(bank.education),
    experience: entries(bank.experience),
    projects: entries(bank.projects),
    skills: bank.skills.filter((c) => c.name.trim()).map((c) => ({ name: c.name, items: c.items })),
  };
}

export function buildUserMessage(bank: Bank, jobDescription: string, company: string, roleTitle?: string): string {
  const target = roleTitle?.trim() ? `${roleTitle.trim()} at ${company}` : company;
  return [
    `Target role: ${target}`,
    "",
    "<job_description>",
    jobDescription.trim(),
    "</job_description>",
    "",
    "<experience_bank>",
    JSON.stringify(bankForPrompt(bank)),
    "</experience_bank>",
  ].join("\n");
}
```

`src/tailor/model.ts`:
```ts
import type { TailorResult } from "./schema";

export const MODEL_IDS = ["claude-opus-5-5", "claude-sonnet-5-5"] as const;
export type ModelId = (typeof MODEL_IDS)[number];
export const DEFAULT_MODEL_ID: ModelId = "claude-opus-5-5";

export const MODEL_LABELS: Record<ModelId, string> = {
  "claude-opus-5-5": "Claude Opus 5.5 (default)",
  "claude-sonnet-5-5": "Claude Sonnet 5.5 (faster, cheaper)",
};

export type TailorRequest = { system: string; user: string };

export interface TailorModel {
  readonly id: string;
  tailor(request: TailorRequest): Promise<TailorResult>;
}
```

`src/tailor/anthropic-model.ts`:
```ts
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { AppError } from "@/lib/errors";
import type { ModelId, TailorModel, TailorRequest } from "./model";
import { type TailorResult, TailorResultSchema } from "./schema";

export function hasApiKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export class AnthropicTailorModel implements TailorModel {
  private readonly client: Anthropic;

  constructor(
    readonly id: ModelId,
    client?: Anthropic,
  ) {
    // The SDK reads ANTHROPIC_API_KEY from the environment (Next.js loads .env.local).
    this.client = client ?? new Anthropic();
  }

  async tailor(request: TailorRequest): Promise<TailorResult> {
    const response = await this.client.messages
      .parse({
        model: this.id,
        max_tokens: 16000,
        system: request.system,
        messages: [{ role: "user", content: request.user }],
        // Thinking is always on for these models; effort controls depth.
        output_config: { effort: "high", format: zodOutputFormat(TailorResultSchema) },
      })
      .catch((err: unknown) => {
        throw toAppError(err);
      });
    if (response.stop_reason === "refusal") {
      const why = response.stop_details?.explanation ?? "no explanation given";
      throw new AppError(`Claude declined this request: ${why}`, 502);
    }
    if (response.stop_reason === "max_tokens") {
      throw new AppError("Claude ran out of output tokens before finishing. Try a shorter bank or JD.", 502);
    }
    if (!response.parsed_output) {
      throw new AppError("Claude returned output that did not match the expected schema.", 502);
    }
    return response.parsed_output;
  }
}

function toAppError(err: unknown): AppError {
  if (err instanceof Anthropic.AuthenticationError) return new AppError("Anthropic rejected the API key. Check ANTHROPIC_API_KEY in .env.local.", 401);
  if (err instanceof Anthropic.RateLimitError) return new AppError("Anthropic rate limit hit. Wait a moment and retry.", 429);
  if (err instanceof Anthropic.APIConnectionError) return new AppError("Could not reach the Anthropic API. Check your network.", 502);
  if (err instanceof Anthropic.APIError) return new AppError(`Anthropic API error: ${err.message}`, 502);
  return new AppError(err instanceof Error ? err.message : "Unknown error calling Claude", 500);
}
```

`src/tailor/tailor.ts`:
```ts
import { newApplicationId } from "@/applications/ids";
import type { ApplicationRepository } from "@/applications/repository";
import { fromTailorResult, fullStateFromBank } from "@/applications/resume-state";
import type { Application } from "@/applications/schema";
import type { BankRepository } from "@/bank/repository";
import { AppError } from "@/lib/errors";
import { DEFAULT_LIMITS, type TailorLimits } from "./limits";
import type { TailorModel } from "./model";
import { buildSystemPrompt, buildUserMessage } from "./prompt";
import { validateTailorResult } from "./validate";

export type TailorInput = {
  profile: string;
  jobDescription: string;
  company: string;
  roleTitle?: string;
};

export type TailorDeps = {
  banks: BankRepository;
  applications: ApplicationRepository;
  model: TailorModel;
  limits?: TailorLimits;
  now?: () => Date;
};

function cleanInput(input: TailorInput) {
  const jobDescription = input.jobDescription.trim();
  const company = input.company.trim();
  if (!jobDescription) throw new AppError("Job description is required", 400);
  if (!company) throw new AppError("Company is required", 400);
  return { jobDescription, company, roleTitle: input.roleTitle?.trim() ?? "" };
}

/** Ask Claude for a selection, validate it against the bank, and save the application. */
export async function runTailor(input: TailorInput, deps: TailorDeps): Promise<Application> {
  const { jobDescription, company, roleTitle } = cleanInput(input);
  const limits = deps.limits ?? DEFAULT_LIMITS;
  const bank = await deps.banks.read(input.profile);
  const raw = await deps.model.tailor({
    system: buildSystemPrompt(limits),
    user: buildUserMessage(bank, jobDescription, company, roleTitle),
  });
  const { result, warnings } = validateTailorResult(bank, raw, limits);
  const now = (deps.now ?? (() => new Date()))();
  const application: Application = {
    id: newApplicationId(company, now),
    createdAt: now.toISOString(),
    company,
    roleTitle,
    jobDescription,
    model: deps.model.id,
    warnings,
    notes: result.notes,
    resume: fromTailorResult(bank, result),
  };
  return deps.applications.save(input.profile, application);
}

/** No-AI path: start from the whole bank and let the user prune. */
export async function createManualApplication(
  input: TailorInput,
  deps: Pick<TailorDeps, "banks" | "applications" | "now">,
): Promise<Application> {
  const { jobDescription, company, roleTitle } = cleanInput(input);
  const bank = await deps.banks.read(input.profile);
  const now = (deps.now ?? (() => new Date()))();
  const application: Application = {
    id: newApplicationId(company, now),
    createdAt: now.toISOString(),
    company,
    roleTitle,
    jobDescription,
    model: "manual",
    warnings: [],
    notes: "",
    resume: fullStateFromBank(bank),
  };
  return deps.applications.save(input.profile, application);
}
```

- [ ] **Step 4: Run tests and the type checker**

```bash
npm test && npx tsc --noEmit
```
Expected: all tests pass; `tsc` exits 0. If `tsc` complains about `output_config`, `parsed_output`, or `stop_details` on the SDK types, check the installed SDK version with `npm ls @anthropic-ai/sdk` (must be 1.x) and read `node_modules/@anthropic-ai/sdk/README.md` for the current `messages.parse` shape rather than guessing.

- [ ] **Step 5: Commit**

```bash
git add src/tailor/prompt.ts src/tailor/model.ts src/tailor/anthropic-model.ts src/tailor/tailor.ts src/tailor/prompt.test.ts src/tailor/tailor.test.ts
git commit -m "feat: add tailor prompt, Claude structured-output client and orchestrator"
```

---

### Task 11: HTTP helpers and API route handlers

> Updated during execution (review of commit cb3a84b): `npm run dev`/`start` bind to 127.0.0.1 (Next's default is 0.0.0.0), `src/proxy.ts` rejects API requests whose Host is not a loopback name or whose Origin differs from the Host (cross-site POSTs and DNS rebinding), `readJson()` in `src/lib/http.ts` turns malformed bodies into 400s, `handle` logs AppErrors with status >= 500, the compile route checks the application exists before compiling, and `loadTemplate` carries a `turbopackIgnore` hint so `next build` stops tracing the project. The repo is the source of truth for the final code.

**Files:**
- Create: `src/lib/http.ts`, `src/lib/deps.ts`
- Create: `src/app/api/profiles/route.ts`, `src/app/api/bank/route.ts`, `src/app/api/applications/route.ts`, `src/app/api/applications/[id]/route.ts`, `src/app/api/applications/[id]/pdf/route.ts`, `src/app/api/tailor/route.ts`, `src/app/api/compile/route.ts`

- [ ] **Step 1: Implement the helpers**

`src/lib/http.ts`:
```ts
import { ZodError } from "zod";
import { AppError } from "./errors";

/** Run a handler and turn thrown errors into JSON responses. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AppError) {
      return Response.json({ error: err.message, details: err.details ?? null }, { status: err.status });
    }
    if (err instanceof ZodError) {
      return Response.json({ error: "Invalid request body", details: err.issues }, { status: 400 });
    }
    console.error(err);
    const message = err instanceof Error ? err.message : "Unexpected error";
    return Response.json({ error: message }, { status: 500 });
  }
}

export function requireProfile(request: Request): string {
  const slug = new URL(request.url).searchParams.get("profile");
  if (!slug) throw new AppError("Missing ?profile= query parameter", 400);
  return slug;
}

export function pdfResponse(pdf: Buffer, pages: number, filename: string): Response {
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "X-Page-Count": String(pages),
      "Cache-Control": "no-store",
    },
  });
}
```

`src/lib/deps.ts`:
```ts
import path from "node:path";
import { ApplicationRepository } from "@/applications/repository";
import { BankRepository } from "@/bank/repository";

export function dataRoot(): string {
  return process.env.RESUME_DATA_DIR ?? path.join(process.cwd(), "data");
}

export const banks = new BankRepository(dataRoot());
export const applications = new ApplicationRepository(dataRoot());
```

- [ ] **Step 2: Implement the routes**

`src/app/api/profiles/route.ts`:
```ts
import { z } from "zod";
import { banks } from "@/lib/deps";
import { handle } from "@/lib/http";

const CreateProfileSchema = z.object({ slug: z.string(), name: z.string().default("") });

export async function GET() {
  return handle(async () => Response.json({ profiles: await banks.listProfiles() }));
}

export async function POST(request: Request) {
  return handle(async () => {
    const body = CreateProfileSchema.parse(await request.json());
    const bank = await banks.createProfile(body.slug, body.name);
    return Response.json({ slug: body.slug, bank }, { status: 201 });
  });
}
```

`src/app/api/bank/route.ts`:
```ts
import { banks } from "@/lib/deps";
import { handle, requireProfile } from "@/lib/http";

export async function GET(request: Request) {
  return handle(async () => Response.json(await banks.read(requireProfile(request))));
}

export async function PUT(request: Request) {
  return handle(async () => {
    const profile = requireProfile(request);
    const bank = await banks.write(profile, await request.json());
    return Response.json(bank);
  });
}
```

`src/app/api/applications/route.ts`:
```ts
import { z } from "zod";
import { applications, banks } from "@/lib/deps";
import { handle, requireProfile } from "@/lib/http";
import { createManualApplication } from "@/tailor/tailor";

const CreateSchema = z.object({
  jobDescription: z.string(),
  company: z.string(),
  roleTitle: z.string().optional(),
});

export async function GET(request: Request) {
  return handle(async () => Response.json({ applications: await applications.list(requireProfile(request)) }));
}

/** Creates a manual (no-AI) application seeded with the whole bank. */
export async function POST(request: Request) {
  return handle(async () => {
    const profile = requireProfile(request);
    const body = CreateSchema.parse(await request.json());
    const application = await createManualApplication({ profile, ...body }, { banks, applications });
    return Response.json({ application }, { status: 201 });
  });
}
```

`src/app/api/applications/[id]/route.ts`:
```ts
import { z } from "zod";
import { ResumeStateSchema } from "@/applications/schema";
import { applications } from "@/lib/deps";
import { handle, requireProfile } from "@/lib/http";

type Context = { params: Promise<{ id: string }> };

const UpdateSchema = z.object({ resume: ResumeStateSchema });

export async function GET(request: Request, { params }: Context) {
  return handle(async () => {
    const { id } = await params;
    return Response.json({ application: await applications.get(requireProfile(request), id) });
  });
}

export async function PUT(request: Request, { params }: Context) {
  return handle(async () => {
    const { id } = await params;
    const profile = requireProfile(request);
    const body = UpdateSchema.parse(await request.json());
    const existing = await applications.get(profile, id);
    const saved = await applications.save(profile, { ...existing, resume: body.resume });
    return Response.json({ application: saved });
  });
}

export async function DELETE(request: Request, { params }: Context) {
  return handle(async () => {
    const { id } = await params;
    await applications.delete(requireProfile(request), id);
    return Response.json({ ok: true });
  });
}
```

`src/app/api/applications/[id]/pdf/route.ts`:
```ts
import { AppError } from "@/lib/errors";
import { applications } from "@/lib/deps";
import { handle, pdfResponse, requireProfile } from "@/lib/http";
import { countPdfPages } from "@/latex/page-count";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  return handle(async () => {
    const { id } = await params;
    const profile = requireProfile(request);
    const pdf = await applications.readPdf(profile, id);
    if (!pdf) throw new AppError("No PDF has been compiled for this application yet", 404);
    return pdfResponse(pdf, countPdfPages(pdf), `${id}.pdf`);
  });
}
```

`src/app/api/tailor/route.ts`:
```ts
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { applications, banks } from "@/lib/deps";
import { handle } from "@/lib/http";
import { AnthropicTailorModel, hasApiKey } from "@/tailor/anthropic-model";
import { DEFAULT_MODEL_ID, MODEL_IDS } from "@/tailor/model";
import { runTailor } from "@/tailor/tailor";

const TailorRequestSchema = z.object({
  profile: z.string(),
  jobDescription: z.string(),
  company: z.string(),
  roleTitle: z.string().optional(),
  model: z.enum(MODEL_IDS).default(DEFAULT_MODEL_ID),
});

export async function POST(request: Request) {
  return handle(async () => {
    if (!hasApiKey()) {
      throw new AppError("No Anthropic API key found. Put ANTHROPIC_API_KEY=... in .env.local and restart npm run dev.", 400);
    }
    const body = TailorRequestSchema.parse(await request.json());
    const application = await runTailor(body, { banks, applications, model: new AnthropicTailorModel(body.model) });
    return Response.json({ application }, { status: 201 });
  });
}
```

`src/app/api/compile/route.ts`:
```ts
import { z } from "zod";
import { resolveResume } from "@/applications/resume-state";
import { ResumeStateSchema } from "@/applications/schema";
import { buildTex } from "@/latex/build";
import { compileTex } from "@/latex/compile";
import { loadTemplate } from "@/latex/template";
import { applications, banks } from "@/lib/deps";
import { handle, pdfResponse } from "@/lib/http";

const CompileRequestSchema = z.object({
  profile: z.string(),
  resume: ResumeStateSchema,
  applicationId: z.string().optional(),
});

export async function POST(request: Request) {
  return handle(async () => {
    const body = CompileRequestSchema.parse(await request.json());
    const bank = await banks.read(body.profile);
    const tex = buildTex(resolveResume(bank, body.resume), await loadTemplate());
    const result = await compileTex(tex);
    if (!result.ok) {
      return Response.json({ error: result.message, log: result.log }, { status: 422 });
    }
    if (body.applicationId) {
      await applications.savePdf(body.profile, body.applicationId, result.pdf);
    }
    return pdfResponse(result.pdf, result.pages, "resume.pdf");
  });
}
```

- [ ] **Step 3: Smoke test the routes with curl**

Start the server in the background, then exercise it:
```bash
cd /Users/edwardgoh/Desktop/resume
npx tsc --noEmit
(npm run dev -- --port 3050 > /tmp/resume-dev.log 2>&1 &) ; sleep 8
curl -s localhost:3050/api/profiles
curl -s "localhost:3050/api/bank?profile=example" | head -c 200; echo
curl -s -X POST "localhost:3050/api/applications?profile=example" -H 'content-type: application/json' \
  -d '{"company":"Acme","jobDescription":"We need Go."}' | head -c 300; echo
APP=$(curl -s "localhost:3050/api/applications?profile=example" | sed -E 's/.*"id":"([^"]+)".*/\1/')
curl -s -o /tmp/resume-smoke.pdf -D - -X POST localhost:3050/api/compile -H 'content-type: application/json' \
  -d "{\"profile\":\"example\",\"applicationId\":\"$APP\",\"resume\":$(curl -s "localhost:3050/api/applications/$APP?profile=example" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>process.stdout.write(JSON.stringify(JSON.parse(d).application.resume)))')}" | grep -i "x-page-count\|HTTP/"
curl -s -X POST localhost:3050/api/tailor -H 'content-type: application/json' -d '{"profile":"example","company":"Acme","jobDescription":"Go"}'; echo
curl -s -X DELETE "localhost:3050/api/applications/$APP?profile=example"
pkill -f "next dev.*3050"
```
Expected: `{"profiles":["example"]}`; bank JSON; a created application; compile returns `HTTP/1.1 200` with `X-Page-Count: 1`; tailor returns the 400 "No Anthropic API key found..." message (no key is set yet); delete returns `{"ok":true}`. Check `data/example/applications/` is empty afterwards (delete it if a stray file remains, so the example folder stays clean).

- [ ] **Step 4: Commit**

```bash
git add src/lib/http.ts src/lib/deps.ts src/app/api
git commit -m "feat: add API routes for profiles, bank, applications, tailor and compile"
```

---

### Task 12: UI foundation (API client, profile context, top bar, primitives, dashboard)

> Updated during execution (review of commit 8a8faab): the unlayered `font: inherit` rule in globals.css was removed (it cancelled Button/Field size utilities) and base rules moved into `@layer base`; `--color-ink-faint` darkened for AA contrast; `Button.tsx` exports `buttonClass()` and `FOCUS_RING` for links styled as buttons; `Field` renders hints outside the label with `aria-describedby`; `api.ts` gained `withProfile()`, a 204/empty-body guard and NaN-safe page-count parsing; the top bar handles profile-load errors, uses a real form with pending state and returns focus on close; the dashboard renders a `ProfileApplications` child keyed by profile (cancelled-flag effect, no eslint suppression), manages focus in the two-step delete and fixes 375px overflow. **Patterns Tasks 13-15 must follow:** keyed child per profile with a cancelled-flag effect (no setState directly in an effect body), `buttonClass()` for links, focus management when a confirm step swaps in, read `error` from `useProfile()`, build URLs with `withProfile()`.

**Files:**
- Create: `src/ui/api.ts`, `src/ui/ProfileProvider.tsx`, `src/ui/TopBar.tsx`, `src/ui/Button.tsx`, `src/ui/Banner.tsx`, `src/ui/Field.tsx`, `src/ui/dashboard/ApplicationList.tsx`
- Replace: `src/app/layout.tsx`, `src/app/page.tsx`
- Delete: `public/*.svg` (scaffold leftovers)

No unit tests for this task (pure UI); it is verified by loading the page.

- [ ] **Step 1: API client `src/ui/api.ts`**

```ts
import type { ResumeState } from "@/applications/schema";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function parseResponse<T>(res: Response): Promise<T> {
  if (res.ok) return (await res.json()) as T;
  let message = `${res.status} ${res.statusText}`;
  let details: unknown;
  try {
    const body = (await res.json()) as { error?: unknown; details?: unknown; log?: unknown };
    if (typeof body.error === "string") message = body.error;
    details = body.details ?? body.log;
  } catch {
    // Non-JSON error body: keep the status text.
  }
  throw new ApiError(message, res.status, details);
}

export const api = {
  get<T>(url: string): Promise<T> {
    return fetch(url).then((res) => parseResponse<T>(res));
  },
  send<T>(url: string, method: "POST" | "PUT" | "DELETE", body?: unknown): Promise<T> {
    return fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then((res) => parseResponse<T>(res));
  },
};

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong";
}

export type CompiledPdf = { blob: Blob; pages: number };

/** Compiles the resume state to a PDF. Throws ApiError (details = LaTeX log) on failure. */
export async function compilePdf(profile: string, resume: ResumeState, applicationId?: string): Promise<CompiledPdf> {
  const res = await fetch("/api/compile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profile, resume, applicationId }),
  });
  if (!res.ok) await parseResponse<never>(res);
  const pages = Number(res.headers.get("X-Page-Count") ?? "0");
  return { blob: await res.blob(), pages };
}
```

- [ ] **Step 2: Profile context `src/ui/ProfileProvider.tsx`**

```tsx
"use client";

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, errorMessage } from "./api";

type ProfileContextValue = {
  profile: string | null;
  profiles: string[];
  loading: boolean;
  error: string | null;
  setProfile: (slug: string) => void;
  createProfile: (slug: string, name: string) => Promise<void>;
};

const STORAGE_KEY = "resume-tailor:profile";
const ProfileContext = createContext<ProfileContextValue | null>(null);

function readStoredProfile(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeProfile(slug: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, slug);
  } catch {
    // Storage can be unavailable (private mode); the selection just won't persist.
  }
}

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [profiles, setProfiles] = useState<string[]>([]);
  const [profile, setProfileState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ profiles: string[] }>("/api/profiles")
      .then(({ profiles }) => {
        if (cancelled) return;
        setProfiles(profiles);
        const stored = readStoredProfile();
        setProfileState(stored && profiles.includes(stored) ? stored : (profiles[0] ?? null));
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setProfile = useCallback((slug: string) => {
    setProfileState(slug);
    storeProfile(slug);
  }, []);

  const createProfile = useCallback(
    async (slug: string, name: string) => {
      await api.send("/api/profiles", "POST", { slug, name });
      setProfiles((prev) => [...prev, slug].sort());
      setProfile(slug);
    },
    [setProfile],
  );

  const value = useMemo(
    () => ({ profile, profiles, loading, error, setProfile, createProfile }),
    [profile, profiles, loading, error, setProfile, createProfile],
  );

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile(): ProfileContextValue {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error("useProfile must be used inside ProfileProvider");
  return ctx;
}
```

- [ ] **Step 3: Primitives**

`src/ui/Button.tsx`:
```tsx
import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-ink text-paper hover:bg-accent focus-visible:ring-accent",
  secondary: "bg-card text-ink border border-rule hover:border-ink focus-visible:ring-ink",
  ghost: "text-ink-soft hover:text-ink hover:bg-paper-deep focus-visible:ring-ink",
  danger: "text-danger hover:bg-accent-soft focus-visible:ring-danger",
};

const SIZES: Record<Size, string> = {
  sm: "px-2.5 py-1 text-xs",
  md: "px-3.5 py-2 text-sm",
};

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size };

export function Button({ variant = "secondary", size = "md", className = "", type = "button", ...props }: Props) {
  return (
    <button
      type={type}
      {...props}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-paper disabled:pointer-events-none disabled:opacity-40 ${SIZES[size]} ${VARIANTS[variant]} ${className}`}
    />
  );
}
```

`src/ui/Banner.tsx`:
```tsx
import type { ReactNode } from "react";

type Tone = "error" | "warn" | "ok" | "info";

const TONES: Record<Tone, string> = {
  error: "border-accent/30 bg-accent-soft text-accent-deep",
  warn: "border-warn/30 bg-warn-soft text-warn",
  ok: "border-ok/30 bg-ok-soft text-ok",
  info: "border-rule bg-paper-deep text-ink-soft",
};

export function Banner({ tone = "info", title, children }: { tone?: Tone; title?: string; children?: ReactNode }) {
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-md border px-3.5 py-2.5 text-sm ${TONES[tone]}`}>
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={title ? "mt-0.5" : ""}>{children}</div>}
    </div>
  );
}
```

`src/ui/Field.tsx`:
```tsx
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

const BASE =
  "w-full rounded-md border border-rule bg-card px-3 py-2 text-sm text-ink placeholder:text-ink-faint transition-colors focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10";

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-soft">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-faint">{hint}</span>}
    </label>
  );
}

export function TextInput({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${BASE} ${className}`} />;
}

export function TextArea({ className = "", ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${BASE} leading-relaxed ${className}`} />;
}

export function Select({ className = "", ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${BASE} ${className}`} />;
}
```

- [ ] **Step 4: Top bar `src/ui/TopBar.tsx`**

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { errorMessage } from "./api";
import { Button } from "./Button";
import { useProfile } from "./ProfileProvider";

const LINKS = [
  { href: "/", label: "Dashboard", isActive: (p: string) => p === "/" },
  { href: "/bank/experience", label: "Bank", isActive: (p: string) => p.startsWith("/bank") },
  { href: "/tailor", label: "Tailor", isActive: (p: string) => p.startsWith("/tailor") },
];

export function TopBar() {
  const pathname = usePathname();
  const { profile, profiles, setProfile, createProfile } = useProfile();
  const [creating, setCreating] = useState(false);
  const [slug, setSlug] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    try {
      await createProfile(slug.trim(), "");
      setCreating(false);
      setSlug("");
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <header className="sticky top-0 z-10 border-b border-rule bg-paper/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <Link href="/" className="font-serif text-xl tracking-tight">
          Resume<span className="text-accent">Tailor</span>
        </Link>
        <nav aria-label="Main navigation" className="flex gap-1">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                link.isActive(pathname) ? "bg-ink text-paper" : "text-ink-soft hover:bg-paper-deep hover:text-ink"
              }`}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {creating ? (
            <>
              <input
                autoFocus
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submit();
                  if (e.key === "Escape") setCreating(false);
                }}
                placeholder="slug, e.g. edward"
                aria-label="New profile slug"
                className="w-44 rounded-md border border-rule bg-card px-2 py-1 text-sm focus:border-ink focus:outline-none"
              />
              <Button size="sm" variant="primary" onClick={() => void submit()} disabled={!slug.trim()}>
                Create
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setCreating(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              <label htmlFor="profile-select" className="text-xs uppercase tracking-wide text-ink-faint">
                Profile
              </label>
              <select
                id="profile-select"
                value={profile ?? ""}
                onChange={(e) => setProfile(e.target.value)}
                className="rounded-md border border-rule bg-card px-2 py-1 text-sm focus:border-ink focus:outline-none"
              >
                {profiles.length === 0 && <option value="">none</option>}
                {profiles.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <Button size="sm" variant="ghost" onClick={() => setCreating(true)}>
                + New
              </Button>
            </>
          )}
          {error && (
            <span role="alert" className="text-xs text-danger">
              {error}
            </span>
          )}
        </div>
      </div>
    </header>
  );
}
```

- [ ] **Step 5: Layout and dashboard**

Replace `src/app/layout.tsx`:
```tsx
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ProfileProvider } from "@/ui/ProfileProvider";
import { TopBar } from "@/ui/TopBar";
import "./globals.css";

export const metadata: Metadata = {
  title: "Resume Tailor",
  description: "Pick the right bullets for every job description.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <ProfileProvider>
          <TopBar />
          <main className="mx-auto w-full max-w-6xl px-4 py-8">{children}</main>
        </ProfileProvider>
      </body>
    </html>
  );
}
```

Replace `src/app/page.tsx`:
```tsx
import { ApplicationList } from "@/ui/dashboard/ApplicationList";

export default function DashboardPage() {
  return <ApplicationList />;
}
```

`src/ui/dashboard/ApplicationList.tsx`:
```tsx
"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { ApplicationSummary } from "@/applications/schema";
import { api, errorMessage } from "@/ui/api";
import { Banner } from "@/ui/Banner";
import { Button } from "@/ui/Button";
import { useProfile } from "@/ui/ProfileProvider";

export function ApplicationList() {
  const { profile, loading } = useProfile();
  const [apps, setApps] = useState<ApplicationSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!profile) return;
    try {
      const { applications } = await api.get<{ applications: ApplicationSummary[] }>(`/api/applications?profile=${profile}`);
      setApps(applications);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [profile]);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(id: string) {
    try {
      await api.send(`/api/applications/${id}?profile=${profile}`, "DELETE");
      setConfirmId(null);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  if (loading) return <p className="text-ink-soft">Loading…</p>;
  if (!profile) {
    return (
      <Banner tone="info" title="No profile yet">
        Create one with the “+ New” button in the top bar, then fill in your bank.
      </Banner>
    );
  }

  return (
    <section aria-labelledby="dash-heading">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-ink-faint">{profile}</p>
          <h1 id="dash-heading" className="mt-1 text-4xl tracking-tight">
            Tailored resumes
          </h1>
        </div>
        <Link
          href="/tailor"
          className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-paper transition-colors hover:bg-accent"
        >
          New tailored resume
        </Link>
      </div>

      {error && (
        <div className="mt-6">
          <Banner tone="error" title="Could not load applications">
            {error}
          </Banner>
        </div>
      )}

      {apps && apps.length === 0 && (
        <div className="mt-10 rounded-lg border border-dashed border-rule bg-card/60 p-10 text-center">
          <p className="font-serif text-xl">Nothing tailored yet.</p>
          <p className="mt-2 text-sm text-ink-soft">
            Fill in your{" "}
            <Link href="/bank/experience" className="underline">
              bank
            </Link>
            , then paste a job description under{" "}
            <Link href="/tailor" className="underline">
              Tailor
            </Link>
            .
          </p>
        </div>
      )}

      <ul className="mt-8 grid gap-4 sm:grid-cols-2">
        {apps?.map((app) => (
          <li
            key={app.id}
            className="rounded-lg border border-rule bg-card p-5 shadow-card transition-transform duration-150 hover:-translate-y-0.5"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-2xl leading-tight">{app.company}</h2>
                {app.roleTitle && <p className="text-sm text-ink-soft">{app.roleTitle}</p>}
              </div>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                  app.hasPdf ? "bg-ok-soft text-ok" : "bg-paper-deep text-ink-faint"
                }`}
              >
                {app.hasPdf ? "PDF ready" : "No PDF"}
              </span>
            </div>
            <p className="mt-3 text-xs text-ink-faint">
              {new Date(app.createdAt).toLocaleString()} · {app.model}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Link
                href={`/tailor/${app.id}`}
                className="rounded-md border border-rule bg-card px-3 py-1.5 text-sm font-medium transition-colors hover:border-ink"
              >
                Open
              </Link>
              {app.hasPdf && (
                <a
                  href={`/api/applications/${app.id}/pdf?profile=${profile}`}
                  download={`${app.id}.pdf`}
                  className="rounded-md px-3 py-1.5 text-sm text-ink-soft transition-colors hover:bg-paper-deep hover:text-ink"
                >
                  Download PDF
                </a>
              )}
              <span className="ml-auto" />
              {confirmId === app.id ? (
                <>
                  <Button size="sm" variant="danger" onClick={() => void remove(app.id)}>
                    Confirm delete
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmId(null)}>
                    Cancel
                  </Button>
                </>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => setConfirmId(app.id)}>
                  Delete
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 6: Remove scaffold leftovers and verify**

```bash
cd /Users/edwardgoh/Desktop/resume
rm -f public/*.svg
npx tsc --noEmit && npm run lint
(npm run dev -- --port 3050 > /tmp/resume-dev.log 2>&1 &) ; sleep 8
curl -s localhost:3050/ | grep -o "Tailored resumes\|No profile yet\|Resume<" | head -3
pkill -f "next dev.*3050"
```
Expected: `tsc` and lint clean. The page HTML contains `Resume<` (the brand). Open http://localhost:3050 in a browser while the server runs: you should see the top bar with the `example` profile selected and the "Nothing tailored yet" empty state.

- [ ] **Step 7: Commit**

```bash
git add -A src/ui src/app/layout.tsx src/app/page.tsx public
git commit -m "feat: add UI shell, profile switcher and dashboard"
```

---

### Task 13: Bank editor

> Updated during execution (review of commit eb91520): a module-level save queue in `src/ui/bank/bank-saver.ts` serialises PUTs and makes loads wait for them, the editor flushes a pending save on unmount and uses a keepalive PUT on `pagehide` (a tab switch within the 800 ms debounce used to drop the edit, and a naive flush raced the next tab's load), "Saved" is only shown for the latest state, save errors show beside the indicator with Retry, a shared `src/ui/ReorderControls.tsx` provides move/delete with focus retention and an inline confirm for entries and categories, bullets have labels, tabs have the focus ring and `aria-current`, the Pin hint is visible, unchanged skill blurs do not save, and entry cards gained a header plus mobile layout fixes. Known follow-up: two tabs editing the same bank are last-writer-wins (no revision check). The repo is the source of truth for the final code.

**Files:**
- Create: `src/app/bank/page.tsx`, `src/app/bank/[section]/page.tsx`
- Create: `src/ui/bank/BankEditor.tsx`, `src/ui/bank/ProfileForm.tsx`, `src/ui/bank/EntryEditor.tsx`, `src/ui/bank/SkillsEditor.tsx`

Note on drafts: the editor creates entries with an empty title and bullets with empty text while the user types. The bank schema allows empty strings (Task 2); the LaTeX builder and the prompt both skip blank titles and bullets (Tasks 5 and 10), so drafts never reach Claude or the PDF.

- [ ] **Step 1: Routes**

`src/app/bank/page.tsx`:
```tsx
import { redirect } from "next/navigation";

export default function BankIndexPage() {
  redirect("/bank/experience");
}
```

`src/app/bank/[section]/page.tsx`:
```tsx
"use client";

import { notFound, useParams } from "next/navigation";
import { BANK_SECTIONS, BankEditor, type BankSection } from "@/ui/bank/BankEditor";

export default function BankSectionPage() {
  const { section } = useParams<{ section: string }>();
  if (!BANK_SECTIONS.includes(section as BankSection)) notFound();
  return <BankEditor section={section as BankSection} />;
}
```

- [ ] **Step 2: `src/ui/bank/BankEditor.tsx`**

```tsx
"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Bank, SectionKey } from "@/bank/schema";
import { api, errorMessage, withProfile } from "@/ui/api";
import { Banner } from "@/ui/Banner";
import { useProfile } from "@/ui/ProfileProvider";
import { EntryEditor } from "./EntryEditor";
import { ProfileForm } from "./ProfileForm";
import { SkillsEditor } from "./SkillsEditor";

export const BANK_SECTIONS = ["profile", "experience", "projects", "education", "skills"] as const;
export type BankSection = (typeof BANK_SECTIONS)[number];

const LABELS: Record<BankSection, string> = {
  profile: "Profile",
  experience: "Experience",
  projects: "Projects",
  education: "Education",
  skills: "Skills",
};

type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";
const SAVE_DELAY_MS = 800;

export function BankEditor({ section }: { section: BankSection }) {
  const { profile, loading, error: profileError } = useProfile();
  if (loading) return <p className="text-ink-soft">Loading…</p>;
  if (profileError) {
    return (
      <Banner tone="error" title="Profiles failed to load">
        {profileError}
      </Banner>
    );
  }
  if (!profile) {
    return (
      <Banner tone="info" title="No profile yet">
        Create one with the “+ New” button in the top bar.
      </Banner>
    );
  }
  // Keyed by profile so switching profiles remounts with fresh state (no setState inside an effect).
  return <ProfileBankEditor key={profile} profile={profile} section={section} />;
}

function ProfileBankEditor({ profile, section }: { profile: string; section: BankSection }) {
  const [bank, setBank] = useState<Bank | null>(null);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<Bank | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<Bank>(withProfile("/api/bank", profile))
      .then((loaded) => {
        if (cancelled) return;
        latest.current = loaded;
        setBank(loaded);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [profile]);

  const save = useCallback(async () => {
    if (!latest.current) return;
    setStatus("saving");
    try {
      await api.send(withProfile("/api/bank", profile), "PUT", latest.current);
      setStatus("saved");
      setError(null);
    } catch (err) {
      setStatus("error");
      setError(errorMessage(err));
    }
  }, [profile]);

  const update = useCallback(
    (fn: (bank: Bank) => Bank) => {
      setBank((prev) => {
        if (!prev) return prev;
        const next = fn(prev);
        latest.current = next;
        return next;
      });
      setStatus("dirty");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void save(), SAVE_DELAY_MS);
    },
    [save],
  );

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <section aria-labelledby="bank-heading">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-ink-faint">{profile} · bank</p>
          <h1 id="bank-heading" className="mt-1 text-4xl tracking-tight">
            {LABELS[section]}
          </h1>
        </div>
        <SaveIndicator status={status} />
      </div>

      <nav aria-label="Bank sections" className="mt-6 flex flex-wrap gap-1 border-b border-rule">
        {BANK_SECTIONS.map((s) => (
          <Link
            key={s}
            href={`/bank/${s}`}
            className={`-mb-px border-b-2 px-3 py-2 text-sm transition-colors ${
              s === section ? "border-accent text-ink" : "border-transparent text-ink-soft hover:text-ink"
            }`}
          >
            {LABELS[s]}
          </Link>
        ))}
      </nav>

      {error && (
        <div className="mt-4">
          <Banner tone="error" title="Problem with the bank">
            {error}
          </Banner>
        </div>
      )}
      {!bank && !error && <p className="mt-6 text-ink-soft">Loading bank…</p>}

      {bank && (
        <div className="mt-6">
          {section === "profile" && <ProfileForm bank={bank} onChange={update} />}
          {section === "skills" && (
            <SkillsEditor skills={bank.skills} onChange={(skills) => update((b) => ({ ...b, skills }))} />
          )}
          {(section === "experience" || section === "projects" || section === "education") && (
            <EntryEditor
              section={section as SectionKey}
              entries={bank[section as SectionKey]}
              onChange={(entries) => update((b) => ({ ...b, [section]: entries }))}
            />
          )}
        </div>
      )}
    </section>
  );
}

function SaveIndicator({ status }: { status: SaveStatus }) {
  const text: Record<SaveStatus, string> = {
    idle: "",
    dirty: "Unsaved changes",
    saving: "Saving…",
    saved: "Saved",
    error: "Save failed",
  };
  const tone = status === "saved" ? "text-ok" : status === "error" ? "text-danger" : "text-ink-faint";
  return (
    <span role="status" className={`text-sm ${tone}`}>
      {text[status]}
    </span>
  );
}
```

- [ ] **Step 3: `src/ui/bank/ProfileForm.tsx`**

```tsx
"use client";

import type { Bank } from "@/bank/schema";
import { Field, TextArea, TextInput } from "@/ui/Field";

type Props = { bank: Bank; onChange: (fn: (bank: Bank) => Bank) => void };

const FIELDS: Array<{ key: keyof Bank["profile"]; label: string; placeholder: string }> = [
  { key: "name", label: "Full name", placeholder: "Your name as it appears on the resume" },
  { key: "email", label: "Email", placeholder: "you@example.com" },
  { key: "phone", label: "Phone", placeholder: "+44 ..." },
  { key: "linkedin", label: "LinkedIn URL", placeholder: "https://linkedin.com/in/..." },
  { key: "github", label: "GitHub URL", placeholder: "https://github.com/..." },
  { key: "website", label: "Website URL", placeholder: "https://..." },
];

export function ProfileForm({ bank, onChange }: Props) {
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
      <div className="grid gap-4 rounded-lg border border-rule bg-card p-5 shadow-card">
        {FIELDS.map((f) => (
          <Field key={f.key} label={f.label}>
            <TextInput
              value={bank.profile[f.key] ?? ""}
              placeholder={f.placeholder}
              onChange={(e) => {
                const value = e.target.value;
                onChange((b) => ({ ...b, profile: { ...b.profile, [f.key]: value } }));
              }}
            />
          </Field>
        ))}
      </div>
      <div className="rounded-lg border border-rule bg-card p-5 shadow-card">
        <Field
          label="Master summary"
          hint="Claude rewrites this for each job description using only facts from here and your bullets."
        >
          <TextArea
            rows={8}
            value={bank.summary}
            onChange={(e) => {
              const summary = e.target.value;
              onChange((b) => ({ ...b, summary }));
            }}
          />
        </Field>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: `src/ui/bank/EntryEditor.tsx`**

```tsx
"use client";

import { moveItem } from "@/applications/edit";
import { newId } from "@/bank/ids";
import { type Bullet, type Entry, SECTION_LABELS, type SectionKey } from "@/bank/schema";
import { Button } from "@/ui/Button";
import { Field, TextArea, TextInput } from "@/ui/Field";

type Props = { section: SectionKey; entries: Entry[]; onChange: (entries: Entry[]) => void };

const TITLE_LABEL: Record<SectionKey, string> = { experience: "Role title", projects: "Project name", education: "Institution" };
const ORG_LABEL: Record<SectionKey, string> = { experience: "Company", projects: "Organisation (optional)", education: "Degree" };

type TextField = "title" | "org" | "location" | "start" | "end" | "link";

export function EntryEditor({ section, entries, onChange }: Props) {
  const replace = (id: string, fn: (e: Entry) => Entry) => onChange(entries.map((e) => (e.id === id ? fn(e) : e)));
  const setField = (id: string, key: TextField, value: string) => replace(id, (e) => ({ ...e, [key]: value }));
  const add = () =>
    onChange([...entries, { id: newId("e"), title: "", org: "", location: "", start: "", end: "", link: "", bullets: [] }]);

  return (
    <div className="grid gap-5">
      {entries.length === 0 && <p className="text-ink-soft">No {SECTION_LABELS[section].toLowerCase()} yet.</p>}
      {entries.map((entry, index) => (
        <article key={entry.id} className="rounded-lg border border-rule bg-card p-5 shadow-card">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={TITLE_LABEL[section]}>
              <TextInput value={entry.title} onChange={(e) => setField(entry.id, "title", e.target.value)} />
            </Field>
            <Field label={ORG_LABEL[section]}>
              <TextInput value={entry.org ?? ""} onChange={(e) => setField(entry.id, "org", e.target.value)} />
            </Field>
            <Field label="Start">
              <TextInput value={entry.start} placeholder="Jul 2025" onChange={(e) => setField(entry.id, "start", e.target.value)} />
            </Field>
            <Field label="End">
              <TextInput value={entry.end} placeholder="Present" onChange={(e) => setField(entry.id, "end", e.target.value)} />
            </Field>
            <Field label="Location (optional)">
              <TextInput value={entry.location ?? ""} placeholder="London, UK" onChange={(e) => setField(entry.id, "location", e.target.value)} />
            </Field>
            <Field label="Link (optional)">
              <TextInput value={entry.link ?? ""} placeholder="https://" onChange={(e) => setField(entry.id, "link", e.target.value)} />
            </Field>
          </div>

          <BulletList bullets={entry.bullets} onChange={(bullets) => replace(entry.id, (e) => ({ ...e, bullets }))} />

          <div className="mt-4 flex items-center gap-2 border-t border-rule pt-3">
            <Button size="sm" variant="ghost" aria-label="Move entry up" disabled={index === 0} onClick={() => onChange(moveItem(entries, index, index - 1))}>
              ↑
            </Button>
            <Button size="sm" variant="ghost" aria-label="Move entry down" disabled={index === entries.length - 1} onClick={() => onChange(moveItem(entries, index, index + 1))}>
              ↓
            </Button>
            <Button size="sm" variant="danger" className="ml-auto" onClick={() => onChange(entries.filter((e) => e.id !== entry.id))}>
              Delete entry
            </Button>
          </div>
        </article>
      ))}
      <div>
        <Button variant="primary" onClick={add}>
          Add {section === "projects" ? "project" : "entry"}
        </Button>
      </div>
    </div>
  );
}

function BulletList({ bullets, onChange }: { bullets: Bullet[]; onChange: (bullets: Bullet[]) => void }) {
  const replace = (id: string, fn: (b: Bullet) => Bullet) => onChange(bullets.map((b) => (b.id === id ? fn(b) : b)));
  return (
    <div className="mt-4">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-soft">
        Bullets <span className="font-normal text-ink-faint">({bullets.length})</span>
      </p>
      <ul className="grid gap-2">
        {bullets.map((bullet, i) => (
          <li key={bullet.id} className="flex gap-2">
            <TextArea
              rows={2}
              value={bullet.text}
              placeholder="New bullet"
              onChange={(e) => {
                const text = e.target.value;
                replace(bullet.id, (b) => ({ ...b, text }));
              }}
            />
            <div className="flex flex-col gap-1">
              <Button
                size="sm"
                variant={bullet.pinned ? "primary" : "ghost"}
                title="Pinned bullets are always included when this entry is on the resume"
                aria-pressed={Boolean(bullet.pinned)}
                onClick={() => replace(bullet.id, (b) => ({ ...b, pinned: !b.pinned }))}
              >
                Pin
              </Button>
              <Button size="sm" variant="ghost" aria-label="Move bullet up" disabled={i === 0} onClick={() => onChange(moveItem(bullets, i, i - 1))}>
                ↑
              </Button>
              <Button size="sm" variant="ghost" aria-label="Move bullet down" disabled={i === bullets.length - 1} onClick={() => onChange(moveItem(bullets, i, i + 1))}>
                ↓
              </Button>
              <Button size="sm" variant="danger" aria-label="Delete bullet" onClick={() => onChange(bullets.filter((b) => b.id !== bullet.id))}>
                ✕
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <Button size="sm" className="mt-2" onClick={() => onChange([...bullets, { id: newId("b"), text: "" }])}>
        Add bullet
      </Button>
    </div>
  );
}
```

- [ ] **Step 5: `src/ui/split-items.ts` and `src/ui/bank/SkillsEditor.tsx`**

`src/ui/split-items.ts` (shared by the bank editor and the review screen):
```ts
/** "Python, Go , ,TypeScript" -> ["Python", "Go", "TypeScript"] */
export function splitItems(text: string): string[] {
  return text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
```

`src/ui/bank/SkillsEditor.tsx`:

```tsx
"use client";

import { useState } from "react";
import { moveItem } from "@/applications/edit";
import { newId } from "@/bank/ids";
import type { SkillCategory } from "@/bank/schema";
import { Button } from "@/ui/Button";
import { Field, TextInput } from "@/ui/Field";

import { splitItems } from "@/ui/split-items";

type Props = { skills: SkillCategory[]; onChange: (skills: SkillCategory[]) => void };

export function SkillsEditor({ skills, onChange }: Props) {
  const replace = (id: string, fn: (c: SkillCategory) => SkillCategory) =>
    onChange(skills.map((c) => (c.id === id ? fn(c) : c)));
  return (
    <div className="grid gap-4">
      {skills.length === 0 && <p className="text-ink-soft">No skill categories yet.</p>}
      {skills.map((cat, i) => (
        <div key={cat.id} className="grid gap-3 rounded-lg border border-rule bg-card p-5 shadow-card sm:grid-cols-[14rem_1fr_auto]">
          <Field label="Category">
            <TextInput
              value={cat.name}
              placeholder="Programming"
              onChange={(e) => {
                const name = e.target.value;
                replace(cat.id, (c) => ({ ...c, name }));
              }}
            />
          </Field>
          <ItemsField items={cat.items} onCommit={(items) => replace(cat.id, (c) => ({ ...c, items }))} />
          <div className="flex items-end gap-1">
            <Button size="sm" variant="ghost" aria-label="Move category up" disabled={i === 0} onClick={() => onChange(moveItem(skills, i, i - 1))}>
              ↑
            </Button>
            <Button size="sm" variant="ghost" aria-label="Move category down" disabled={i === skills.length - 1} onClick={() => onChange(moveItem(skills, i, i + 1))}>
              ↓
            </Button>
            <Button size="sm" variant="danger" onClick={() => onChange(skills.filter((c) => c.id !== cat.id))}>
              Delete
            </Button>
          </div>
        </div>
      ))}
      <div>
        <Button variant="primary" onClick={() => onChange([...skills, { id: newId("s"), name: "", items: [] }])}>
          Add category
        </Button>
      </div>
    </div>
  );
}

/** Comma-separated editor that commits on blur, so typing a comma does not split mid-keystroke. */
function ItemsField({ items, onCommit }: { items: string[]; onCommit: (items: string[]) => void }) {
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(false);
  return (
    <Field label="Items (comma-separated)">
      <TextInput
        value={editing ? text : items.join(", ")}
        placeholder="Python, Go, TypeScript"
        onFocus={() => {
          setText(items.join(", "));
          setEditing(true);
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          setEditing(false);
          onCommit(splitItems(text));
        }}
      />
    </Field>
  );
}
```

- [ ] **Step 6: Verify in the browser**

```bash
cd /Users/edwardgoh/Desktop/resume
npx tsc --noEmit && npm run lint
```
Then run `npm run dev`, open http://localhost:3000/bank/experience with the `example` profile, add a bullet to Acme Corp, type text, wait a second and confirm the "Saved" indicator. Reload: the bullet is still there. Check `git status` shows `data/example/bank.json` modified, then restore it with `git checkout data/example/bank.json` so the example stays pristine.

- [ ] **Step 7: Commit**

```bash
git add src/app/bank src/ui/bank src/ui/split-items.ts
git commit -m "feat: add bank editor with autosave"
```

---

### Task 14: Tailor page (paste a job description)

> Updated during execution (review of commit 426b60c): the form no longer navigates after the user has left the page (unmount guard), has a synchronous re-entry guard, shows a full-contrast `role="status"` busy line with an elapsed timer and locks the fields while a call runs, keeps the busy button focusable with `aria-disabled`, moves focus to the error banner on failure, marks Company required with clearer placeholders and a readiness hint, and the side card is sticky; the API-key error message lost its backticks. The repo is the source of truth for the final code.

**Files:**
- Create: `src/app/tailor/page.tsx`, `src/ui/tailor/TailorForm.tsx`

- [ ] **Step 1: Route `src/app/tailor/page.tsx`**

```tsx
import { TailorForm } from "@/ui/tailor/TailorForm";

export default function TailorPage() {
  return <TailorForm />;
}
```

- [ ] **Step 2: `src/ui/tailor/TailorForm.tsx`**

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Application } from "@/applications/schema";
import { DEFAULT_MODEL_ID, MODEL_IDS, MODEL_LABELS, type ModelId } from "@/tailor/model";
import { api, errorMessage, withProfile } from "@/ui/api";
import { Banner } from "@/ui/Banner";
import { Button } from "@/ui/Button";
import { Field, Select, TextArea, TextInput } from "@/ui/Field";
import { useProfile } from "@/ui/ProfileProvider";

type Mode = "ai" | "manual";

export function TailorForm() {
  const router = useRouter();
  const { profile, loading, error: profileError } = useProfile();
  const [company, setCompany] = useState("");
  const [roleTitle, setRoleTitle] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [model, setModel] = useState<ModelId>(DEFAULT_MODEL_ID);
  const [busy, setBusy] = useState<Mode | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ready = Boolean(profile) && company.trim().length > 0 && jobDescription.trim().length > 0 && busy === null;

  async function start(mode: Mode) {
    if (!profile) return;
    setBusy(mode);
    setError(null);
    try {
      const { application } =
        mode === "ai"
          ? await api.send<{ application: Application }>("/api/tailor", "POST", { profile, company, roleTitle, jobDescription, model })
          : await api.send<{ application: Application }>(withProfile("/api/applications", profile), "POST", { company, roleTitle, jobDescription });
      router.push(`/tailor/${application.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(null);
    }
  }

  if (loading) return <p className="text-ink-soft">Loading…</p>;
  if (profileError) {
    return (
      <Banner tone="error" title="Profiles failed to load">
        {profileError}
      </Banner>
    );
  }
  if (!profile) {
    return (
      <Banner tone="info" title="No profile yet">
        Create one with the “New profile” button in the top bar, then fill in your bank.
      </Banner>
    );
  }

  return (
    <section aria-labelledby="tailor-heading">
      <p className="text-xs font-semibold uppercase tracking-widest text-ink-faint">{profile}</p>
      <h1 id="tailor-heading" className="mt-1 text-4xl tracking-tight">
        Tailor to a job
      </h1>
      <p className="mt-2 max-w-2xl text-sm text-ink-soft">
        Paste the job description. Claude reads your whole bank, picks the bullets that fit, lightly rewords them, and you
        review every change before anything is compiled.
      </p>

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="rounded-lg border border-rule bg-card p-5 shadow-card">
          <Field label="Job description">
            <TextArea
              rows={22}
              value={jobDescription}
              onChange={(e) => setJobDescription(e.target.value)}
              placeholder="Paste the full posting here, requirements and all."
              className="font-mono text-[13px]"
            />
          </Field>
        </div>

        <div className="grid content-start gap-4 rounded-lg border border-rule bg-card p-5 shadow-card">
          <Field label="Company">
            <TextInput value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Acme Corp" />
          </Field>
          <Field label="Role title (optional)">
            <TextInput value={roleTitle} onChange={(e) => setRoleTitle(e.target.value)} placeholder="Backend Engineer" />
          </Field>
          <Field label="Model">
            <Select value={model} onChange={(e) => setModel(e.target.value as ModelId)}>
              {MODEL_IDS.map((id) => (
                <option key={id} value={id}>
                  {MODEL_LABELS[id]}
                </option>
              ))}
            </Select>
          </Field>

          {error && (
            <Banner tone="error" title="Could not start">
              {error}
            </Banner>
          )}

          <div className="mt-2 grid gap-2">
            <Button variant="primary" disabled={!ready} onClick={() => void start("ai")}>
              {busy === "ai" ? "Asking Claude… this can take a minute" : "Tailor with Claude"}
            </Button>
            <Button variant="ghost" disabled={!ready} onClick={() => void start("manual")}>
              {busy === "manual" ? "Creating…" : "Start from full bank (no AI)"}
            </Button>
          </div>
          <p className="text-xs text-ink-faint">
            The no-AI option loads every bullet so you can prune by hand. Useful before your API key is set up.
          </p>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Verify**

```bash
cd /Users/edwardgoh/Desktop/resume && npx tsc --noEmit && npm run lint
```
Run `npm run dev`, open http://localhost:3000/tailor, fill company and JD, click "Start from full bank (no AI)". You should land on `/tailor/<id>` (a 404 page is expected until Task 15 exists; the application JSON appears under `data/example/applications/`). Delete that JSON afterwards so the example folder stays clean. Also click "Tailor with Claude" once: the red banner must say the API key is missing.

- [ ] **Step 4: Commit**

```bash
git add src/app/tailor/page.tsx src/ui/tailor
git commit -m "feat: add tailor page with AI and manual start"
```

---

### Task 15: Review screen

**Files:**
- Create: `src/app/tailor/[id]/page.tsx`
- Create: `src/ui/review/ReviewScreen.tsx`, `src/ui/review/SectionReview.tsx`, `src/ui/review/EntryReview.tsx`, `src/ui/review/BulletDiff.tsx`, `src/ui/review/SkillsReview.tsx`, `src/ui/review/PdfPreview.tsx`

- [ ] **Step 1: Route `src/app/tailor/[id]/page.tsx`**

```tsx
"use client";

import { useParams } from "next/navigation";
import { ReviewScreen } from "@/ui/review/ReviewScreen";

export default function ReviewPage() {
  const { id } = useParams<{ id: string }>();
  return <ReviewScreen applicationId={id} />;
}
```

- [ ] **Step 2: `src/ui/review/BulletDiff.tsx`**

```tsx
import { diffWords } from "diff";

/** Word-level diff of the original bank bullet against the current text. */
export function BulletDiff({ original, text }: { original: string; text: string }) {
  const parts = diffWords(original, text);
  return (
    <p className="text-sm leading-relaxed">
      {parts.map((part, i) => {
        if (part.added) {
          return (
            <ins key={i} className="rounded bg-ok-soft px-0.5 text-ok no-underline">
              {part.value}
            </ins>
          );
        }
        if (part.removed) {
          return (
            <del key={i} className="rounded bg-accent-soft px-0.5 text-accent-deep line-through">
              {part.value}
            </del>
          );
        }
        return <span key={i}>{part.value}</span>;
      })}
    </p>
  );
}
```

- [ ] **Step 3: `src/ui/review/PdfPreview.tsx`**

```tsx
export function PdfPreview({ url, pages }: { url: string; pages: number }) {
  const unknown = pages === 0; // the counter found no page objects
  const onePage = pages === 1;
  const badge = unknown ? "bg-paper-deep text-ink-faint" : onePage ? "bg-ok-soft text-ok" : "bg-warn-soft text-warn";
  return (
    <div className="rounded-lg border border-rule bg-card shadow-card">
      <div className="flex flex-wrap items-center gap-3 border-b border-rule px-4 py-2 text-sm">
        <span className="font-medium">Preview</span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badge}`}>
          {unknown ? "page count unknown" : `${pages} page${onePage ? "" : "s"}`}
        </span>
        {!unknown && !onePage && <span className="text-xs text-warn">Spills past one page. Remove a bullet or two and compile again.</span>}
      </div>
      <iframe title="Resume PDF preview" src={url} className="h-[80vh] w-full rounded-b-lg bg-white" />
    </div>
  );
}
```

- [ ] **Step 4: `src/ui/review/EntryReview.tsx`**

```tsx
"use client";

import { useState } from "react";
import type { ResumeBullet, ResumeEntry } from "@/applications/schema";
import type { Bullet, Entry } from "@/bank/schema";
import { Button } from "@/ui/Button";
import { TextArea } from "@/ui/Field";
import { BulletDiff } from "./BulletDiff";

type Props = {
  entry: Entry;
  state: ResumeEntry;
  isFirst: boolean;
  isLast: boolean;
  onMoveEntry: (direction: -1 | 1) => void;
  onExclude: () => void;
  onSetText: (bulletId: string, text: string) => void;
  onRevert: (bulletId: string) => void;
  onRemove: (bulletId: string) => void;
  onMoveBullet: (bulletId: string, direction: -1 | 1) => void;
  onAdd: (bullet: Bullet) => void;
};

export function EntryReview(props: Props) {
  const { entry, state } = props;
  const selected = new Set(state.bullets.map((b) => b.bulletId));
  const unselected = entry.bullets.filter((b) => !selected.has(b.id) && b.text.trim());
  const dates = [entry.start, entry.end].filter(Boolean).join(" – ");

  return (
    <article className="rounded-lg border border-rule bg-card p-4 shadow-card">
      <header className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1">
          <h3 className="text-lg leading-tight">
            {entry.title}
            {entry.org && <span className="font-normal text-ink-soft">, {entry.org}</span>}
          </h3>
          <p className="text-xs text-ink-faint">
            {dates}
            {entry.location && ` · ${entry.location}`}
          </p>
          {state.rationale && <p className="mt-1 text-xs italic text-ink-soft">{state.rationale}</p>}
        </div>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" aria-label="Move entry up" disabled={props.isFirst} onClick={() => props.onMoveEntry(-1)}>
            ↑
          </Button>
          <Button size="sm" variant="ghost" aria-label="Move entry down" disabled={props.isLast} onClick={() => props.onMoveEntry(1)}>
            ↓
          </Button>
          <Button size="sm" variant="danger" onClick={props.onExclude}>
            Remove
          </Button>
        </div>
      </header>

      <ul className="mt-3 grid gap-2">
        {state.bullets.map((bullet, i) => (
          <BulletRow
            key={bullet.bulletId}
            bullet={bullet}
            isFirst={i === 0}
            isLast={i === state.bullets.length - 1}
            onSetText={(text) => props.onSetText(bullet.bulletId, text)}
            onRevert={() => props.onRevert(bullet.bulletId)}
            onRemove={() => props.onRemove(bullet.bulletId)}
            onMove={(d) => props.onMoveBullet(bullet.bulletId, d)}
          />
        ))}
        {state.bullets.length === 0 && <li className="text-sm text-ink-faint">No bullets selected.</li>}
      </ul>

      {unselected.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-medium text-ink-soft hover:text-ink">
            Show {unselected.length} more from the bank
          </summary>
          <ul className="mt-2 grid gap-1.5">
            {unselected.map((b) => (
              <li key={b.id} className="flex items-start gap-2 rounded-md bg-paper-deep/60 px-3 py-2">
                <p className="flex-1 text-sm text-ink-soft">{b.text}</p>
                <Button size="sm" onClick={() => props.onAdd(b)}>
                  Add
                </Button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}

type RowProps = {
  bullet: ResumeBullet;
  isFirst: boolean;
  isLast: boolean;
  onSetText: (text: string) => void;
  onRevert: () => void;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
};

function BulletRow({ bullet, isFirst, isLast, onSetText, onRevert, onRemove, onMove }: RowProps) {
  const [editing, setEditing] = useState(false);
  const changed = bullet.text !== bullet.original;

  return (
    <li className="flex gap-2 rounded-md border border-rule/70 px-3 py-2">
      <div className="min-w-0 flex-1">
        {editing ? (
          <TextArea rows={3} autoFocus value={bullet.text} onChange={(e) => onSetText(e.target.value)} onBlur={() => setEditing(false)} />
        ) : changed ? (
          <BulletDiff original={bullet.original} text={bullet.text} />
        ) : (
          <p className="text-sm leading-relaxed">{bullet.text}</p>
        )}
        {changed && !editing && <p className="mt-1 text-[11px] uppercase tracking-wide text-ink-faint">edited from bank</p>}
      </div>
      <div className="flex shrink-0 flex-col gap-1">
        <Button size="sm" variant="ghost" onClick={() => setEditing((v) => !v)}>
          {editing ? "Done" : "Edit"}
        </Button>
        {changed && (
          <Button size="sm" variant="ghost" onClick={onRevert}>
            Revert
          </Button>
        )}
        <Button size="sm" variant="ghost" aria-label="Move bullet up" disabled={isFirst} onClick={() => onMove(-1)}>
          ↑
        </Button>
        <Button size="sm" variant="ghost" aria-label="Move bullet down" disabled={isLast} onClick={() => onMove(1)}>
          ↓
        </Button>
        <Button size="sm" variant="danger" aria-label="Remove bullet" onClick={onRemove}>
          ✕
        </Button>
      </div>
    </li>
  );
}
```

- [ ] **Step 5: `src/ui/review/SectionReview.tsx`**

```tsx
"use client";

import * as edit from "@/applications/edit";
import type { ResumeState } from "@/applications/schema";
import { type Bank, SECTION_LABELS, type SectionKey } from "@/bank/schema";
import { Button } from "@/ui/Button";
import { EntryReview } from "./EntryReview";

type Props = {
  section: SectionKey;
  bank: Bank;
  resume: ResumeState;
  onChange: (fn: (state: ResumeState) => ResumeState) => void;
};

export function SectionReview({ section, bank, resume, onChange }: Props) {
  const included = resume[section];
  const byId = new Map(bank[section].map((e) => [e.id, e]));
  const excluded = bank[section].filter((e) => e.title.trim() && !included.some((r) => r.entryId === e.id));

  return (
    <section aria-labelledby={`review-${section}`}>
      <h2 id={`review-${section}`} className="mb-3 border-b border-ink pb-1 text-2xl">
        {SECTION_LABELS[section]}
      </h2>
      <div className="grid gap-3">
        {included.map((state, i) => {
          const entry = byId.get(state.entryId);
          if (!entry) return null;
          return (
            <EntryReview
              key={state.entryId}
              entry={entry}
              state={state}
              isFirst={i === 0}
              isLast={i === included.length - 1}
              onMoveEntry={(d) => onChange((s) => edit.moveEntry(s, section, entry.id, d))}
              onExclude={() => onChange((s) => edit.excludeEntry(s, section, entry.id))}
              onSetText={(bulletId, text) => onChange((s) => edit.setBulletText(s, section, entry.id, bulletId, text))}
              onRevert={(bulletId) => onChange((s) => edit.revertBullet(s, section, entry.id, bulletId))}
              onRemove={(bulletId) => onChange((s) => edit.removeBullet(s, section, entry.id, bulletId))}
              onMoveBullet={(bulletId, d) => onChange((s) => edit.moveBullet(s, section, entry.id, bulletId, d))}
              onAdd={(bullet) => onChange((s) => edit.addBullet(s, section, entry.id, bullet, bank))}
            />
          );
        })}
        {included.length === 0 && <p className="text-sm text-ink-faint">Nothing from this section is on the resume.</p>}
      </div>
      {excluded.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-medium text-ink-soft hover:text-ink">
            Not included ({excluded.length})
          </summary>
          <ul className="mt-2 grid gap-1.5">
            {excluded.map((e) => (
              <li key={e.id} className="flex items-center gap-2 rounded-md bg-paper-deep/60 px-3 py-2 text-sm">
                <span className="flex-1">
                  <span className="font-medium">{e.title}</span>
                  {e.org && <span className="text-ink-soft">, {e.org}</span>}
                </span>
                <Button size="sm" onClick={() => onChange((s) => edit.includeEntry(s, bank, section, e.id))}>
                  Add
                </Button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
```

- [ ] **Step 6: `src/ui/review/SkillsReview.tsx`**

```tsx
"use client";

import { useState } from "react";
import { moveItem } from "@/applications/edit";
import type { Bank, SkillCategory } from "@/bank/schema";
import { Button } from "@/ui/Button";
import { TextInput } from "@/ui/Field";
import { splitItems } from "@/ui/split-items";

type Props = { bank: Bank; skills: SkillCategory[]; onChange: (skills: SkillCategory[]) => void };

export function SkillsReview({ bank, skills, onChange }: Props) {
  const missing = bank.skills.filter((c) => c.name.trim() && !skills.some((s) => s.id === c.id));
  const replace = (id: string, fn: (c: SkillCategory) => SkillCategory) => onChange(skills.map((c) => (c.id === id ? fn(c) : c)));

  return (
    <section aria-labelledby="review-skills">
      <h2 id="review-skills" className="mb-3 border-b border-ink pb-1 text-2xl">
        Skills
      </h2>
      <div className="grid gap-2">
        {skills.map((cat, i) => (
          <div key={cat.id} className="flex items-center gap-2 rounded-lg border border-rule bg-card px-3 py-2 shadow-card">
            <span className="w-44 shrink-0 text-sm font-semibold">{cat.name}:</span>
            <ItemsInput items={cat.items} onCommit={(items) => replace(cat.id, (c) => ({ ...c, items }))} />
            <Button size="sm" variant="ghost" aria-label="Move category up" disabled={i === 0} onClick={() => onChange(moveItem(skills, i, i - 1))}>
              ↑
            </Button>
            <Button size="sm" variant="ghost" aria-label="Move category down" disabled={i === skills.length - 1} onClick={() => onChange(moveItem(skills, i, i + 1))}>
              ↓
            </Button>
            <Button size="sm" variant="danger" aria-label="Remove category" onClick={() => onChange(skills.filter((c) => c.id !== cat.id))}>
              ✕
            </Button>
          </div>
        ))}
      </div>
      {missing.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {missing.map((c) => (
            <Button key={c.id} size="sm" onClick={() => onChange([...skills, { ...c, items: [...c.items] }])}>
              + {c.name}
            </Button>
          ))}
        </div>
      )}
    </section>
  );
}

function ItemsInput({ items, onCommit }: { items: string[]; onCommit: (items: string[]) => void }) {
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(false);
  return (
    <TextInput
      aria-label="Skill items, comma-separated"
      value={editing ? text : items.join(", ")}
      onFocus={() => {
        setText(items.join(", "));
        setEditing(true);
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        setEditing(false);
        onCommit(splitItems(text));
      }}
    />
  );
}
```

- [ ] **Step 7: `src/ui/review/ReviewScreen.tsx`**

```tsx
"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import * as edit from "@/applications/edit";
import { slugify } from "@/applications/ids";
import type { Application, ResumeState } from "@/applications/schema";
import { type Bank, SECTION_KEYS } from "@/bank/schema";
import { ApiError, api, compilePdf, errorMessage, withProfile } from "@/ui/api";
import { Banner } from "@/ui/Banner";
import { Button, buttonClass } from "@/ui/Button";
import { Field, TextArea } from "@/ui/Field";
import { useProfile } from "@/ui/ProfileProvider";
import { PdfPreview } from "./PdfPreview";
import { SectionReview } from "./SectionReview";
import { SkillsReview } from "./SkillsReview";

type Props = { applicationId: string };
type Preview = { url: string; pages: number };
type Problem = { message: string; log?: string };

export function ReviewScreen({ applicationId }: Props) {
  const { profile, loading, error: profileError } = useProfile();
  const [application, setApplication] = useState<Application | null>(null);
  const [bank, setBank] = useState<Bank | null>(null);
  const [resume, setResume] = useState<ResumeState | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [compiling, setCompiling] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const previewUrl = useRef<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    Promise.all([
      api.get<{ application: Application }>(withProfile(`/api/applications/${applicationId}`, profile)),
      api.get<Bank>(withProfile("/api/bank", profile)),
    ])
      .then(([{ application: loaded }, loadedBank]) => {
        if (cancelled) return;
        setApplication(loaded);
        setBank(loadedBank);
        // Entries deleted from the bank since tailoring are dropped so reordering stays predictable.
        setResume(edit.pruneMissing(loaded.resume, loadedBank));
        setDirty(false);
      })
      .catch((err) => {
        if (!cancelled) setProblem({ message: errorMessage(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [profile, applicationId]);

  useEffect(
    () => () => {
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    },
    [],
  );

  const change = useCallback((fn: (state: ResumeState) => ResumeState) => {
    setResume((prev) => {
      if (!prev) return prev;
      const next = fn(prev);
      // The edit helpers return the same reference for no-op edits, so only real changes mark the state dirty.
      if (next !== prev) setDirty(true);
      return next;
    });
  }, []);

  async function save(state: ResumeState): Promise<void> {
    if (!profile) return;
    setSaving(true);
    try {
      const { application: saved } = await api.send<{ application: Application }>(
        withProfile(`/api/applications/${applicationId}`, profile),
        "PUT",
        { resume: state },
      );
      setApplication(saved);
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }

  async function onSave() {
    if (!resume) return;
    setProblem(null);
    try {
      await save(resume);
    } catch (err) {
      setProblem({ message: errorMessage(err) });
    }
  }

  async function onCompile() {
    if (!profile || !resume) return;
    setCompiling(true);
    setProblem(null);
    try {
      if (dirty) await save(resume);
      const { blob, pages } = await compilePdf(profile, resume, applicationId);
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
      const url = URL.createObjectURL(blob);
      previewUrl.current = url;
      setPreview({ url, pages });
    } catch (err) {
      const log = err instanceof ApiError && typeof err.details === "string" ? err.details : undefined;
      setProblem({ message: errorMessage(err), log });
    } finally {
      setCompiling(false);
    }
  }

  if (loading) return <p className="text-ink-soft">Loading…</p>;
  if (profileError) {
    return (
      <Banner tone="error" title="Profiles failed to load">
        {profileError}
      </Banner>
    );
  }
  if (!profile) return <Banner tone="info" title="No profile selected" />;
  if (problem && !application) {
    return (
      <Banner tone="error" title="Could not load this application">
        {problem.message}
      </Banner>
    );
  }
  if (!application || !bank || !resume) return <p className="text-ink-soft">Loading application…</p>;

  const filename = `${slugify(application.company)}-resume.pdf`;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <aside className="grid content-start gap-4 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:self-start lg:overflow-auto">
        <div>
          <Link href="/" className="text-xs text-ink-faint hover:text-ink">
            ← Dashboard
          </Link>
          <h1 className="mt-1 text-3xl leading-tight">{application.company}</h1>
          {application.roleTitle && <p className="text-ink-soft">{application.roleTitle}</p>}
          <p className="mt-1 text-xs text-ink-faint">
            {new Date(application.createdAt).toLocaleString()} · {application.model}
          </p>
        </div>
        {application.notes && (
          <Banner tone="info" title="Claude's notes">
            {application.notes}
          </Banner>
        )}
        {application.warnings.length > 0 && (
          <Banner tone="warn" title="Adjusted after validation">
            <ul className="list-disc pl-4">
              {application.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </Banner>
        )}
        <div className="rounded-lg border border-rule bg-card p-4 shadow-card">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-soft">Job description</p>
          <pre className="whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-ink-soft">{application.jobDescription}</pre>
        </div>
      </aside>

      <div className="grid content-start gap-6">
        <div className="sticky top-16 z-[5] -mx-1 flex flex-wrap items-center gap-2 rounded-lg border border-rule bg-paper/95 px-3 py-2 shadow-card backdrop-blur">
          <Button variant="primary" onClick={() => void onCompile()} disabled={compiling || saving}>
            {compiling ? "Compiling…" : "Compile PDF"}
          </Button>
          <Button onClick={() => void onSave()} disabled={!dirty || saving || compiling}>
            {saving ? "Saving…" : dirty ? "Save" : "Saved"}
          </Button>
          {preview && (
            <a href={preview.url} download={filename} className={buttonClass({ variant: "secondary" })}>
              Download PDF
            </a>
          )}
          <span className="ml-auto text-xs text-ink-faint">{dirty ? "Unsaved changes" : ""}</span>
        </div>

        {problem && (
          <Banner tone="error" title={problem.message}>
            {problem.log && (
              <details className="mt-1">
                <summary className="cursor-pointer text-xs">LaTeX log</summary>
                <pre className="mt-1 max-h-72 overflow-auto rounded bg-ink p-2 font-mono text-[11px] text-paper">{problem.log}</pre>
              </details>
            )}
          </Banner>
        )}

        {preview && <PdfPreview url={preview.url} pages={preview.pages} />}

        <section aria-labelledby="review-summary">
          <h2 id="review-summary" className="mb-3 border-b border-ink pb-1 text-2xl">
            Summary
          </h2>
          <Field label="Summary paragraph">
            <TextArea
              rows={4}
              value={resume.summary}
              onChange={(e) => {
                const summary = e.target.value;
                change((s) => edit.setSummary(s, summary));
              }}
            />
          </Field>
        </section>

        {SECTION_KEYS.map((section) => (
          <SectionReview key={section} section={section} bank={bank} resume={resume} onChange={change} />
        ))}

        <SkillsReview bank={bank} skills={resume.skills} onChange={(skills) => change((s) => edit.setSkills(s, skills))} />
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Verify end to end in the browser**

```bash
cd /Users/edwardgoh/Desktop/resume && npx tsc --noEmit && npm run lint
```
Run `npm run dev`. On `/tailor` with the `example` profile, start from full bank, then on the review screen:
1. Remove a bullet, edit another (the diff shows), revert it.
2. Click "Compile PDF": the preview appears with a "1 page" badge; "Download PDF" appears.
3. Reload: your edits are still there (compile saved them).
4. Dashboard shows the application with "PDF ready".
Delete the application from the dashboard afterwards so `data/example/applications/` is empty.

- [ ] **Step 9: Commit**

```bash
git add src/app/tailor src/ui/review
git commit -m "feat: add review screen with diff, reorder, compile preview and download"
```

---

### Task 16: Bank merge utility, seed script, and Edward's bank

**Files:**
- Create: `src/bank/merge.ts`, `scripts/seed-from-pdfs.ts`
- Test: `src/bank/merge.test.ts`
- Create (not committed, main session only): `data/edward/bank.json`

- [ ] **Step 1: Write the failing test `src/bank/merge.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { type ExtractedBank, mergeBank } from "./merge";
import { emptyBank } from "./schema";

function counter() {
  let n = 0;
  return (prefix: string) => `${prefix}_${++n}`;
}

const extracted: ExtractedBank = {
  profile: { name: "Sam Smith", email: "sam@example.com", phone: "", linkedin: "https://linkedin.com/in/sam" },
  summary: "Extracted summary.",
  education: [],
  experience: [
    {
      title: "Software Engineer Intern",
      org: "Acme Corp",
      location: "London, UK",
      start: "Jul 2024",
      end: "Jan 2025",
      bullets: ["Built a Go service.", "Cut latency by 80%."],
    },
  ],
  projects: [{ title: "Trail Planner", start: "2024", end: "Present", bullets: ["Next.js app."] }],
  skills: [{ name: "Programming", items: ["Go", "typescript"] }],
};

describe("mergeBank", () => {
  it("fills an empty bank with ids", () => {
    const bank = mergeBank(emptyBank(), extracted, counter());
    expect(bank.profile).toEqual({ name: "Sam Smith", email: "sam@example.com", phone: "", linkedin: "https://linkedin.com/in/sam", github: undefined, website: undefined });
    expect(bank.summary).toBe("Extracted summary.");
    expect(bank.experience[0].id).toBe("e_1");
    expect(bank.experience[0].bullets.map((b) => b.id)).toEqual(["b_2", "b_3"]);
    expect(bank.projects[0].org).toBeUndefined();
    expect(bank.projects[0].id).toBe("e_4");
    expect(bank.skills).toEqual([{ id: "s_6", name: "Programming", items: ["Go", "typescript"] }]);
  });

  it("appends only new bullets to a matching entry and keeps existing profile and summary", () => {
    const existing = mergeBank(emptyBank(), extracted, counter());
    const again: ExtractedBank = {
      ...extracted,
      profile: { name: "Other Name", phone: "+44 1" },
      summary: "Different summary.",
      experience: [
        {
          ...extracted.experience[0],
          title: "software engineer intern",
          bullets: ["Built a Go service.", "  Shipped CI.  "],
        },
      ],
      skills: [{ name: "programming", items: ["GO", "Rust"] }],
    };
    const merged = mergeBank(existing, again, counter());
    expect(merged.profile.name).toBe("Sam Smith");
    expect(merged.profile.phone).toBe("+44 1");
    expect(merged.summary).toBe("Extracted summary.");
    expect(merged.experience).toHaveLength(1);
    expect(merged.experience[0].bullets.map((b) => b.text)).toEqual(["Built a Go service.", "Cut latency by 80%.", "Shipped CI."]);
    expect(merged.skills[0].items).toEqual(["Go", "typescript", "Rust"]);
    expect(existing.experience[0].bullets).toHaveLength(2);
  });

  it("skips entries with no title and blank bullets", () => {
    const bank = mergeBank(emptyBank(), { ...extracted, experience: [{ title: " ", start: "", end: "", bullets: ["x"] }], projects: [{ title: "P", start: "", end: "", bullets: ["", "  "] }] }, counter());
    expect(bank.experience).toEqual([]);
    expect(bank.projects[0].bullets).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- src/bank/merge
```
Expected: FAIL, cannot find module './merge'.

- [ ] **Step 3: Implement `src/bank/merge.ts`**

```ts
import { newId } from "./ids";
import type { Bank, Bullet, Entry, Profile, SkillCategory } from "./schema";

export type ExtractedEntry = {
  title: string;
  org?: string;
  location?: string;
  start: string;
  end: string;
  link?: string;
  bullets: string[];
};

export type ExtractedBank = {
  profile: Partial<Profile>;
  summary: string;
  education: ExtractedEntry[];
  experience: ExtractedEntry[];
  projects: ExtractedEntry[];
  skills: Array<{ name: string; items: string[] }>;
};

type MakeId = (prefix: string) => string;

const norm = (s: string | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const entryKey = (e: { title: string; org?: string }) => `${norm(e.title)}|${norm(e.org)}`;
const clean = (s: string | undefined) => s?.trim() || undefined;

/** Merge extracted resume content into a bank: existing values win, new entries/bullets/skills are appended. */
export function mergeBank(existing: Bank, extracted: ExtractedBank, makeId: MakeId = newId): Bank {
  return {
    ...existing,
    profile: {
      name: existing.profile.name || extracted.profile.name || "",
      email: existing.profile.email || extracted.profile.email || "",
      phone: existing.profile.phone || extracted.profile.phone || "",
      linkedin: existing.profile.linkedin || clean(extracted.profile.linkedin),
      github: existing.profile.github || clean(extracted.profile.github),
      website: existing.profile.website || clean(extracted.profile.website),
    },
    summary: existing.summary || extracted.summary,
    education: mergeSection(existing.education, extracted.education, makeId),
    experience: mergeSection(existing.experience, extracted.experience, makeId),
    projects: mergeSection(existing.projects, extracted.projects, makeId),
    skills: mergeSkills(existing.skills, extracted.skills, makeId),
  };
}

function mergeSection(existing: Entry[], extracted: ExtractedEntry[], makeId: MakeId): Entry[] {
  return extracted.reduce<Entry[]>((entries, ex) => {
    if (!ex.title.trim()) return entries;
    const index = entries.findIndex((e) => entryKey(e) === entryKey(ex));
    if (index === -1) {
      const entry: Entry = {
        id: makeId("e"),
        title: ex.title.trim(),
        org: clean(ex.org),
        location: clean(ex.location),
        start: ex.start.trim(),
        end: ex.end.trim(),
        link: clean(ex.link),
        bullets: appendBullets([], ex.bullets, makeId),
      };
      return [...entries, entry];
    }
    return entries.map((e, i) => (i === index ? { ...e, bullets: appendBullets(e.bullets, ex.bullets, makeId) } : e));
  }, existing);
}

function appendBullets(current: Bullet[], incoming: string[], makeId: MakeId): Bullet[] {
  const seen = new Set(current.map((b) => norm(b.text)));
  const added: Bullet[] = [];
  for (const raw of incoming) {
    const text = raw.trim();
    const key = norm(text);
    if (!text || seen.has(key)) continue;
    seen.add(key);
    added.push({ id: makeId("b"), text });
  }
  return [...current, ...added];
}

function mergeSkills(existing: SkillCategory[], extracted: ExtractedBank["skills"], makeId: MakeId): SkillCategory[] {
  return extracted.reduce<SkillCategory[]>((categories, ex) => {
    if (!ex.name.trim()) return categories;
    const index = categories.findIndex((c) => norm(c.name) === norm(ex.name));
    if (index === -1) {
      return [...categories, { id: makeId("s"), name: ex.name.trim(), items: appendItems([], ex.items) }];
    }
    return categories.map((c, i) => (i === index ? { ...c, items: appendItems(c.items, ex.items) } : c));
  }, existing);
}

function appendItems(current: string[], incoming: string[]): string[] {
  const seen = new Set(current.map(norm));
  const added: string[] = [];
  for (const raw of incoming) {
    const item = raw.trim();
    if (!item || seen.has(norm(item))) continue;
    seen.add(norm(item));
    added.push(item);
  }
  return [...current, ...added];
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- src/bank/merge
```
Expected: 3 tests pass. Ids are allocated in call order: experience entry `e_1`, its bullets `b_2` `b_3`, project `e_4`, its bullet `b_5`, skills category `s_6`.

- [ ] **Step 5: Seed script `scripts/seed-from-pdfs.ts`**

```ts
/**
 * Seed or enrich a profile's bank from resume PDFs.
 *   npm run seed -- --profile edward "/path/to/CV one.pdf" "/path/to/CV two.pdf"
 * Needs: pdftotext (brew install poppler) and ANTHROPIC_API_KEY (read from .env.local if not set).
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { type ExtractedBank, mergeBank } from "@/bank/merge";
import { BankRepository } from "@/bank/repository";
import { type Bank, emptyBank } from "@/bank/schema";
import { AppError } from "@/lib/errors";

const ExtractedEntrySchema = z.object({
  title: z.string(),
  org: z.string(),
  location: z.string(),
  start: z.string(),
  end: z.string(),
  link: z.string(),
  bullets: z.array(z.string()),
});

const ExtractedBankSchema = z.object({
  profile: z.object({
    name: z.string(),
    email: z.string(),
    phone: z.string(),
    linkedin: z.string(),
    github: z.string(),
    website: z.string(),
  }),
  summary: z.string(),
  education: z.array(ExtractedEntrySchema),
  experience: z.array(ExtractedEntrySchema),
  projects: z.array(ExtractedEntrySchema),
  skills: z.array(z.object({ name: z.string(), items: z.array(z.string()) })),
});

const SYSTEM = `You extract resume content into structured JSON.
- Copy bullet text verbatim; only repair words broken across lines by PDF extraction.
- Use empty strings for anything not present. Dates exactly as written, e.g. "Jul 2025".
- Education: institution in "title", degree in "org".
- Projects: "org" empty unless an organisation is named.
- Skills: keep the resume's own category names and item spelling.
- "summary": the opening profile paragraph if there is one, else empty.`;

function usage(): never {
  console.error('Usage: npm run seed -- --profile <slug> "<file.pdf>" ["<more.pdf>" ...]');
  process.exit(1);
}

/** Minimal .env.local loader so the script works without Next.js. */
function loadDotEnvLocal(): void {
  if (process.env.ANTHROPIC_API_KEY) return;
  try {
    for (const line of readFileSync(path.join(process.cwd(), ".env.local"), "utf8").split("\n")) {
      const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    // no .env.local; the check below reports it
  }
}

function toExtracted(parsed: z.infer<typeof ExtractedBankSchema>): ExtractedBank {
  const entry = (e: z.infer<typeof ExtractedEntrySchema>) => ({
    title: e.title,
    org: e.org || undefined,
    location: e.location || undefined,
    start: e.start,
    end: e.end,
    link: e.link || undefined,
    bullets: e.bullets,
  });
  return {
    profile: {
      name: parsed.profile.name,
      email: parsed.profile.email,
      phone: parsed.profile.phone,
      linkedin: parsed.profile.linkedin || undefined,
      github: parsed.profile.github || undefined,
      website: parsed.profile.website || undefined,
    },
    summary: parsed.summary,
    education: parsed.education.map(entry),
    experience: parsed.experience.map(entry),
    projects: parsed.projects.map(entry),
    skills: parsed.skills,
  };
}

function countBullets(bank: Bank): number {
  return [...bank.education, ...bank.experience, ...bank.projects].reduce((n, e) => n + e.bullets.length, 0);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flag = args.indexOf("--profile");
  if (flag === -1 || !args[flag + 1]) usage();
  const slug = args[flag + 1];
  const pdfs = args.filter((_, i) => i !== flag && i !== flag + 1);
  if (pdfs.length === 0) usage();

  loadDotEnvLocal();
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is not set. Put it in .env.local or export it.");
    process.exit(1);
  }

  const repo = new BankRepository(path.join(process.cwd(), "data"));
  let bank = await repo.read(slug).catch((err: unknown) => {
    if (err instanceof AppError && err.status === 404) return emptyBank();
    throw err;
  });
  const client = new Anthropic();

  for (const pdf of pdfs) {
    console.log(`Extracting ${pdf} ...`);
    const text = execFileSync("pdftotext", ["-layout", pdf, "-"], { encoding: "utf8" });
    const response = await client.messages.parse({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      system: SYSTEM,
      messages: [{ role: "user", content: `<resume_text>\n${text}\n</resume_text>` }],
      output_config: { effort: "medium", format: zodOutputFormat(ExtractedBankSchema) },
    });
    if (!response.parsed_output) {
      throw new Error(`Claude returned no structured output for ${pdf} (stop_reason=${response.stop_reason})`);
    }
    const before = countBullets(bank);
    bank = mergeBank(bank, toExtracted(response.parsed_output));
    console.log(`  +${countBullets(bank) - before} new bullets`);
  }

  await repo.write(slug, bank);
  console.log(`Wrote data/${slug}/bank.json with ${countBullets(bank)} bullets.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
```

Check it type-checks and prints usage:
```bash
cd /Users/edwardgoh/Desktop/resume && npx tsc --noEmit && npm run seed
```
Expected: `tsc` clean; the script prints the usage line and exits 1.

- [ ] **Step 6: Commit the utility and script (never the data)**

```bash
git add src/bank/merge.ts src/bank/merge.test.ts scripts/seed-from-pdfs.ts
git commit -m "feat: add bank merge utility and pdf seed script"
```

- [ ] **Step 7: Create Edward's bank (main session only; personal data, not committed)**

The main Claude session, not a subagent, writes `data/edward/bank.json` by transcribing `/Users/edwardgoh/Library/Mobile Documents/com~apple~CloudDocs/Documents/Resumes/CV_Edward.pdf` into the bank schema: profile (name, email, phone, LinkedIn and GitHub URLs if the PDF text contains them, otherwise leave those two empty for Edward to fill in), the summary paragraph, one education entry (institution as title, degree as org, both bullets), both experience entries with every bullet, both projects with every bullet, and the five skill categories with their items in order. Ids follow the `e_`, `b_`, `s_` prefixes with 8 hex chars. The content is deliberately not reproduced in this plan so Edward's phone number and email stay out of git. Verify with:

```bash
cd /Users/edwardgoh/Desktop/resume
npx tsx -e 'import { BankSchema } from "./src/bank/schema"; import { readFileSync } from "node:fs"; const b = BankSchema.parse(JSON.parse(readFileSync("data/edward/bank.json","utf8"))); console.log(b.experience.length, "experience,", b.projects.length, "projects,", b.skills.length, "skill categories")'
git status --short data/
```
Expected: `2 experience, 2 projects, 5 skill categories` and `git status` shows nothing under `data/` (it is ignored).

Later, Edward can enrich it from the older CVs with, for example:
```bash
npm run seed -- --profile edward "/Users/edwardgoh/Library/Mobile Documents/com~apple~CloudDocs/Documents/Resumes/CV SWE.pdf" "/Users/edwardgoh/Library/Mobile Documents/com~apple~CloudDocs/Documents/Resumes/CV AI.pdf"
```

---

### Task 17: Playwright smoke test and README

**Files:**
- Create: `playwright.config.ts`, `e2e/smoke.spec.ts`
- Modify: `README.md`

- [ ] **Step 1: `playwright.config.ts`**

```ts
import path from "node:path";
import { defineConfig } from "@playwright/test";

const PORT = 3123;

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  retries: 0,
  use: { baseURL: `http://localhost:${PORT}`, headless: true },
  webServer: {
    command: `npm run dev -- --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    env: { RESUME_DATA_DIR: path.resolve(".e2e-data") },
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
```

- [ ] **Step 2: `e2e/smoke.spec.ts`**

```ts
import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

const DATA = path.resolve(".e2e-data");

test.beforeAll(async () => {
  await rm(DATA, { recursive: true, force: true });
  await mkdir(DATA, { recursive: true });
  await cp(path.resolve("data/example"), path.join(DATA, "example"), { recursive: true });
});

test("bank editor adds a bullet and persists it", async ({ page }) => {
  await page.goto("/bank/experience");
  await expect(page.getByRole("heading", { name: "Experience" })).toBeVisible();
  await page.getByRole("button", { name: "Add bullet" }).first().click();
  const fresh = page.locator('textarea[placeholder="New bullet"]:placeholder-shown').first();
  await fresh.fill("Shipped the smoke test bullet");
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible({ timeout: 10_000 });
  await page.reload();
  await expect(page.getByDisplayValue("Shipped the smoke test bullet")).toBeVisible();
});

test("manual application compiles to a one-page PDF", async ({ page }) => {
  await page.goto("/tailor");
  await page.getByLabel("Company").fill("Acme");
  await page.getByLabel("Job description").fill("We need Go engineers.");
  await page.getByRole("button", { name: "Start from full bank" }).click();
  await expect(page).toHaveURL(/\/tailor\/.+/);
  await page.getByRole("button", { name: "Compile PDF" }).click();
  await expect(page.getByText("1 page", { exact: true })).toBeVisible({ timeout: 60_000 });
});
```

- [ ] **Step 3: Run it once**

```bash
cd /Users/edwardgoh/Desktop/resume
npx playwright install chromium
npm run test:e2e
```
Expected: 2 passed. (The second test really compiles LaTeX, so it takes several seconds.)

- [ ] **Step 4: Replace `README.md`**

```markdown
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
npm run dev                     # http://localhost:3000
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
```

- [ ] **Step 5: Commit**

```bash
git add playwright.config.ts e2e README.md
git commit -m "docs: add README and playwright smoke test"
```

---

### Task 18: Final verification and push

> Polish items deferred from reviews, to do before the final check (each small):
> - `src/tailor/validate.ts`: "a experience entry" wording; collapse the two overlapping pinned-over-limit warnings into one; skip the "no bullets" warning for bank entries that have no real bullets.
> - `src/ui/bank/BankEditor.tsx`: on `pagehide`, also send the keepalive PUT when a queued save has not been confirmed yet (keep a ref to the last server-confirmed bank); after confirming a delete, move focus to the next entry heading or the Add button; Escape closes the inline confirm.
> - `src/ui/bank/BankEditor.tsx` tabs at 375px: show that the strip scrolls (edge fade or tighter spacing so all five fit).
> - `src/ui/Button.tsx`: `aria-disabled:hover:bg-ink aria-disabled:cursor-progress` so a busy button does not look clickable; `src/ui/Field.tsx`: `disabled:bg-paper disabled:text-ink-soft` so locked fields look locked; `src/ui/Banner.tsx`: app focus ring instead of the browser outline; `src/ui/tailor/TailorForm.tsx`: keep the `role="status"` element always mounted and swap its contents, move the sentence period inside the hidden timer span.
> - Known, accepted for v1: two tabs editing the same bank are last-writer-wins; refusal fallbacks not enabled.

- [ ] **Step 1: Full check**

```bash
cd /Users/edwardgoh/Desktop/resume
npm test && npm run lint && npx tsc --noEmit && npm run build
git status --short
```
Expected: all green; `git status` clean (nothing under `data/` except the example, which is already committed).

- [ ] **Step 2: Push the branch and report the link**

```bash
git push -u origin feat/resume-tailor
echo https://github.com/GOH8910/resume-tailor/tree/feat/resume-tailor
```
Do not open a PR; the user opens it manually.
