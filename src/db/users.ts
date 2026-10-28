import { eq } from "drizzle-orm";
import { getDb } from "./client";
import { user } from "./schema";

export async function findUserIdByEmail(email: string): Promise<string | null> {
  const db = await getDb();
  const [row] = await db.select({ id: user.id }).from(user).where(eq(user.email, email.toLowerCase().trim()));
  return row?.id ?? null;
}
