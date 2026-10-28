import { eq } from "drizzle-orm";
import { banks } from "@/db/schema";
import type { Db } from "@/db/types";
import { AppError } from "@/lib/errors";
import { type Bank, BankSchema, emptyBank } from "./schema";

/** One bank per user, stored as validated JSON. `db` is a getter so the connection opens lazily. */
export class BankRepository {
  constructor(private readonly db: () => Promise<Db>) {}

  async createEmpty(userId: string, name: string): Promise<void> {
    const db = await this.db();
    await db.insert(banks).values({ userId, data: emptyBank(name) }).onConflictDoNothing();
  }

  /** The user's bank. A missing one is created empty, which heals an account whose sign-up hook failed. */
  async read(userId: string): Promise<Bank> {
    const db = await this.db();
    let row = await this.select(db, userId);
    if (!row) {
      await db.insert(banks).values({ userId, data: emptyBank("") }).onConflictDoNothing();
      row = await this.select(db, userId);
    }
    if (!row) throw new AppError("Could not create a bank for this account", 500);
    const parsed = BankSchema.safeParse(row.data);
    if (!parsed.success) throw new AppError("Stored bank does not match the schema", 500, parsed.error.issues);
    return parsed.data;
  }

  private async select(db: Db, userId: string): Promise<{ data: unknown } | undefined> {
    const [row] = await db.select({ data: banks.data }).from(banks).where(eq(banks.userId, userId));
    return row;
  }

  async write(userId: string, bank: unknown): Promise<Bank> {
    const parsed = BankSchema.safeParse(bank);
    if (!parsed.success) throw new AppError("Bank does not match the schema", 400, parsed.error.issues);
    const db = await this.db();
    await db
      .insert(banks)
      .values({ userId, data: parsed.data })
      .onConflictDoUpdate({ target: banks.userId, set: { data: parsed.data } });
    return parsed.data;
  }
}
