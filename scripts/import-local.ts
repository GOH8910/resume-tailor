/**
 * Import a bank and applications saved by the local app (data/<profile>/) into an account.
 *   npm run import:local -- --email you@example.com --from data/<profile> [--replace] [--dry-run]
 * See USAGE for the flags, targets and production notes.
 */
import { parseArgs } from "node:util";
import { findUserIdByEmail } from "@/db/users";
import { importLocalData, type ImportResult } from "@/import/import-local";
import { applications, banks } from "@/lib/deps";

const USAGE = `Usage: npm run import:local -- --email <email> --from <dir> [--replace] [--dry-run]

  --email     the account to import into; sign in on the site once first
  --from      a profile folder of the local app, e.g. data/edward (bank.json + applications/)
  --replace   overwrite a bank that already has content (by default it is kept)
  --dry-run   validate, count and report what would happen to the bank; write nothing

Safe to re-run: applications and PDFs are upserted.
Targets the local PGlite under data/pglite, which is single-process: stop \`npm run dev\` first.

Production: sign in on the production site first so the account exists there, then set
DATABASE_URL to Neon's direct (unpooled) connection string; change sslmode=require to sslmode=verify-full in it.
Migrations run on every invocation, --dry-run included, so run this from the commit that is deployed.
Use an absolute --from path when the data lives in another checkout.`;

function usage(): never {
  console.error(USAGE);
  process.exit(1);
}

function readFlags() {
  try {
    return parseArgs({
      options: {
        email: { type: "string" },
        from: { type: "string" },
        replace: { type: "boolean", default: false },
        "dry-run": { type: "boolean", default: false },
      },
    }).values;
  } catch (err) {
    // e.g. "Unknown option '--dryrun'"
    console.error(`${err instanceof Error ? err.message : err}\n`);
    usage();
  }
}

function parse(): { email: string; from: string; replace: boolean; dryRun: boolean } {
  const flags = readFlags();
  if (!flags.email || !flags.from) usage();
  return { email: flags.email, from: flags.from, replace: flags.replace, dryRun: flags["dry-run"] };
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
