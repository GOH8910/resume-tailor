import { and, eq, inArray, isNull, lt, ne, or } from "drizzle-orm";
import { startOfUtcDay } from "@/credits/day";
import { adSessions, creditEvents, session, user, userPlans } from "@/db/schema";
import type { Db } from "@/db/types";

/**
 * Deletes the account in one transaction: its sessions (signing it out everywhere), then the user row, which cascades
 * to its bank, applications, plan and sign-in accounts. The credits ledger, ad sessions and costed usage are kept with
 * their user cleared (the schema's `set null`), so the audit, the per-IP ad cap and the budget still count them. Of
 * what is kept, the ledger loses its references to the account's resumes (their ids carry the company's name) and the
 * ad sessions their IPs, except today's grants, which the per-IP cap counts until midnight UTC.
 *
 * Locks are taken in the order an ad grant takes them (its ad session row, then the plan row), so a grant in flight
 * waits for the deletion, or the deletion for it, instead of the two deadlocking: deleting the user would otherwise
 * lock the plan row first and then wait on the session row the grant holds while it waits on the plan row.
 */
export async function deleteAccount(db: Db, userId: string, now = new Date()): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.select({ id: adSessions.id }).from(adSessions).where(eq(adSessions.userId, userId)).orderBy(adSessions.id).for("update");
    await tx.select({ userId: userPlans.userId }).from(userPlans).where(eq(userPlans.userId, userId)).for("update");
    const notGrantedToday = or(ne(adSessions.status, "granted"), isNull(adSessions.grantedAt), lt(adSessions.grantedAt, startOfUtcDay(now)));
    await tx.update(adSessions).set({ ip: "" }).where(and(eq(adSessions.userId, userId), notGrantedToday));
    await tx
      .update(creditEvents)
      .set({ ref: null })
      .where(and(eq(creditEvents.userId, userId), inArray(creditEvents.kind, ["tailor", "chat"])));
    await tx.delete(session).where(eq(session.userId, userId));
    await tx.delete(user).where(eq(user.id, userId));
  });
}
