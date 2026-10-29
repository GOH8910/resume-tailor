import { eq } from "drizzle-orm";
import { adSessions, session, user, userPlans } from "@/db/schema";
import type { Db } from "@/db/types";

/**
 * Deletes the account in one transaction: its sessions (signing it out everywhere), then the user row, which cascades
 * to its bank, applications, plan and sign-in accounts. The credits ledger, ad sessions and costed usage are kept with
 * their user cleared (the schema's `set null`), so the audit, the per-IP ad cap and the budget still count them.
 *
 * Locks are taken in the order an ad grant takes them (its ad session row, then the plan row), so a grant in flight
 * waits for the deletion, or the deletion for it, instead of the two deadlocking: deleting the user would otherwise
 * lock the plan row first and then wait on the session row the grant holds while it waits on the plan row.
 */
export async function deleteAccount(db: Db, userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.select({ id: adSessions.id }).from(adSessions).where(eq(adSessions.userId, userId)).orderBy(adSessions.id).for("update");
    await tx.select({ userId: userPlans.userId }).from(userPlans).where(eq(userPlans.userId, userId)).for("update");
    await tx.delete(session).where(eq(session.userId, userId));
    await tx.delete(user).where(eq(user.id, userId));
  });
}
