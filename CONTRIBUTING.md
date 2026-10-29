# Contributing

Thanks for helping. Small, focused changes are easiest to review.

## Before you open a pull request

Set up as in the README's "From source" section, then run the gates. All of them must pass:

```bash
npx tsc --noEmit
npx eslint src e2e scripts
npx vitest run
npm run test:e2e             # needs `npx playwright install chromium` and MacTeX
bash scripts/smoke-image.sh  # needs Docker; run it when you touch the Dockerfile, docker/, LaTeX or security headers
```

- **Tests are required for behaviour changes.** Write the test first and watch it fail. Unit tests live next to the
  code (`*.test.ts`, Vitest, PGlite for the database); user flows go in `e2e/` (Playwright, both modes).
- **Settings** are read once in `src/lib/env.ts` and used through `env`. A new setting also goes in `.env.example`,
  with its default.
- **Database changes** go through `src/db/schema.ts` and `npm run db:generate`; commit the generated migration.

## Branches and commits

- Work on a branch, never on `main`.
- Commit messages are `type: short description`, where type is one of `feat`, `fix`, `refactor`, `docs`, `test`,
  `chore`, `perf` or `ci`. For example: `fix: keep the PDF preview on a failed compile`.

## No personal data

Never commit a real resume, bank, PDF, `.env` file, API key or email address. `data/` is ignored except
`data/example/`, which holds a made-up bank for tests and the sample image. Use `example.com` addresses in tests.

## Licence

Resume Tailor is licensed under the GNU Affero General Public License v3.0 (`LICENSE`). By sending a contribution,
you agree that it is licensed under the same terms.

Security problems go through `SECURITY.md`, not a public issue.
