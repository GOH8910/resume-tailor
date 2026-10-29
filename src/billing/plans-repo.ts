import { eq } from "drizzle-orm";
import { userPlans } from "@/db/schema";
import type { Db } from "@/db/types";
import { AppError } from "@/lib/errors";
import type { Plan } from "./plan";

export type AccountPlan = { plan: Plan; credits: number };

/** One plan row per user. `db` is a getter so the connection opens lazily. */
export class PlansRepository {
  constructor(private readonly db: () => Promise<Db>) {}

  /**
   * The account's plan and credits. A missing row is created with `plan` (the plan the account would have been
   * given at sign-up), which heals an account whose sign-up hook failed or that predates plans; an existing row is
   * never changed.
   */
  async get(userId: string, plan: Plan): Promise<AccountPlan> {
    const db = await this.db();
    let row = await this.select(db, userId);
    if (!row) {
      await db.insert(userPlans).values({ userId, plan }).onConflictDoNothing();
      row = await this.select(db, userId);
    }
    if (!row) throw new AppError("Could not create a plan for this account", 500);
    return row;
  }

  /** Gives the account `plan` unless it already has one. */
  async ensure(userId: string, plan: Plan): Promise<void> {
    const db = await this.db();
    await db.insert(userPlans).values({ userId, plan }).onConflictDoNothing();
  }

  async setPlan(userId: string, plan: Plan): Promise<void> {
    const db = await this.db();
    await db.insert(userPlans).values({ userId, plan }).onConflictDoUpdate({ target: userPlans.userId, set: { plan } });
  }

  private async select(db: Db, userId: string): Promise<AccountPlan | undefined> {
    const [row] = await db
      .select({ plan: userPlans.plan, credits: userPlans.credits })
      .from(userPlans)
      .where(eq(userPlans.userId, userId));
    return row;
  }
}
