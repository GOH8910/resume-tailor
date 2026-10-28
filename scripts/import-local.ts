/**
 * Import a bank and applications saved by the local app (data/<profile>/) into an account.
 *   npm run import:local -- --email you@example.com --from data/<profile> [--replace] [--dry-run]
 * See usage() for the flags and targets.
 */
import { parseArgs } from "node:util";
import { findUserIdByEmail } from "@/db/users";
import { importLocalData, type ImportResult } from "@/import/import-local";
import { applications, banks } from "@/lib/deps";

const USAGE = `Usage: npm run import:local -- --email <email> --from <dir> [--replace] [--dry-run]

  --email     the account to import into; sign in on the site once first
  --from      a profile folder of the local app, e.g. data/edward (bank.json + applications/)
  --replace   overwrite a bank that already has content (by default it is kept)
  --dry-run   validate and count, write nothing

Targets the local PGlite under data/pglite, which is single-process: stop \`npm run dev\` first.
Set DATABASE_URL=<neon url> to target production instead.`;

function usage(): never {
  console.error(USAGE);
  process.exit(1);
}

function parse(): { email: string; from: string; replace: boolean; dryRun: boolean } {
  try {
    const { values } = parseArgs({
      options: {
        email: { type: "string" },
        from: { type: "string" },
        replace: { type: "boolean", default: false },
        "dry-run": { type: "boolean", default: false },
      },
    });
    if (!values.email || !values.from) usage();
    return { email: values.email, from: values.from, replace: values.replace, dryRun: values["dry-run"] };
  } catch {
    usage();
  }
}

/** Counts only: never print bank or application contents. */
function report(result: ImportResult, dryRun: boolean): void {
  console.log(`Bank: ${result.bank}`);
  console.log(`Applications: ${result.applications} (${result.pdfs} with a PDF)`);
  if (result.skipped.length > 0) {
    console.log(`Skipped ${result.skipped.length}:`);
    for (const line of result.skipped) console.log(`  ${line}`);
  }
  if (dryRun) console.log("Dry run: nothing was written.");
}

async function main(): Promise<void> {
  const args = parse();
  const userId = await findUserIdByEmail(args.email);
  if (!userId) {
    console.error(`No account for ${args.email}: sign in on the site first, then re-run`);
    process.exit(1);
  }
  const result = await importLocalData({ ...args, userId, banks, applications });
  report(result, args.dryRun);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
