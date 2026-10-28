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

  async read(userId: string): Promise<Bank> {
    const db = await this.db();
    const [row] = await db.select({ data: banks.data }).from(banks).where(eq(banks.userId, userId));
    if (!row) throw new AppError("No bank for this account yet", 404);
    const parsed = BankSchema.safeParse(row.data);
    if (!parsed.success) throw new AppError("Stored bank does not match the schema", 500, parsed.error.issues);
    return parsed.data;
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
