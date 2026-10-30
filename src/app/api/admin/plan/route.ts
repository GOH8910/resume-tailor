import { z } from "zod";
import { PLANS } from "@/billing/plan";
import { findUserIdByEmail } from "@/db/users";
import { plans } from "@/lib/deps";
import { AppError } from "@/lib/errors";
import { handle, readJson, requireAdmin } from "@/lib/http";

const Body = z.object({ email: z.string().trim().toLowerCase().pipe(z.email().max(320)), plan: z.enum(PLANS) });

/**
 * Moves an existing account to another plan. ADMIN_EMAILS only picks the plan when an account is first used, so
 * this is how the operator promotes or demotes an account afterwards.
 */
export async function POST(request: Request) {
  return handle(async () => {
    await requireAdmin(request);
    const { email, plan } = Body.parse(await readJson(request, 4_096));
    const userId = await findUserIdByEmail(email);
    if (!userId) throw new AppError("No account uses that email", 404);
    await plans.setPlan(userId, plan);
    return Response.json({ email, plan });
  });
}
