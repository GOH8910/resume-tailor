import { adminSummary } from "@/admin/summary";
import { getDb } from "@/db/client";
import { usage } from "@/lib/deps";
import { env } from "@/lib/env";
import { handle, requireAdmin } from "@/lib/http";

/** Today's and this month's spend, credits, ads and the budget, for /admin. */
export async function GET(request: Request) {
  return handle(async () => {
    await requireAdmin(request);
    return Response.json(await adminSummary({ db: await getDb(), usage, freeDailyBudgetGbp: env.FREE_DAILY_BUDGET_GBP }));
  });
}
