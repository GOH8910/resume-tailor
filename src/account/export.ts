import { asc, eq } from "drizzle-orm";
import { applications, banks, creditEvents } from "@/db/schema";
import type { Db } from "@/db/types";
import type { CreditKind } from "@/credits/types";

export type ExportedCreditEvent = { kind: CreditKind; amount: number; ref: string | null; createdAt: string };

/** What "Download my data" hands the account holder. */
export type AccountExport = {
  exportedAt: string;
  email: string;
  /** The bank as stored, or null if the account never had one. */
  bank: unknown;
  /** Each tailored resume with its job description; the compiled PDFs are left out. */
  applications: unknown[];
  /** The whole credits ledger, oldest first. */
  credits: ExportedCreditEvent[];
};

/**
 * Everything the account has stored, read as stored rather than through the schemas, so data that no longer
 * matches them still comes out. Only the PDF columns are left out: they are rebuilt from the JSON by compiling.
 */
export async function exportAccount(db: Db, account: { id: string; email: string }, now = new Date()): Promise<AccountExport> {
  const [bank] = await db.select({ data: banks.data }).from(banks).where(eq(banks.userId, account.id));
  const resumes = await db
    .select({ data: applications.data })
    .from(applications)
    .where(eq(applications.userId, account.id))
    .orderBy(asc(applications.createdAt), asc(applications.id));
  const ledger = await db
    .select({ kind: creditEvents.kind, amount: creditEvents.amount, ref: creditEvents.ref, createdAt: creditEvents.createdAt })
    .from(creditEvents)
    .where(eq(creditEvents.userId, account.id))
    .orderBy(asc(creditEvents.createdAt), asc(creditEvents.id));
  return {
    exportedAt: now.toISOString(),
    email: account.email,
    bank: bank?.data ?? null,
    applications: resumes.map((row) => row.data),
    credits: ledger.map((event) => ({ ...event, createdAt: event.createdAt.toISOString() })),
  };
}
