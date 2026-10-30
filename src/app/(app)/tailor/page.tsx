import { headers } from "next/headers";
import { currentPolicy } from "@/billing/policy";
import { getAuth } from "@/lib/auth";
import { env } from "@/lib/env";
import { accountPlan } from "@/lib/http";
import { type CostLine, TailorForm } from "@/ui/tailor/TailorForm";

/** Mirrors the form's own rule (credits charged and a cost above 0; the ad button when ads are available). */
async function expectedCostLine(): Promise<CostLine> {
  // headers() first: during `next build` it ends prerendering before getAuth() can open the database.
  const requestHeaders = await headers();
  const session = await getAuth().api.getSession({ headers: requestHeaders, query: { disableRefresh: true } });
  // The (app) layout sends a signed-out visitor to sign in.
  if (!session) return "none";
  const plan = await accountPlan(session.user);
  if (!currentPolicy(plan).chargesCredits || env.CREDITS_PER_TAILOR === 0) return "none";
  return env.adProvider === "none" ? "note" : "ad";
}

export default async function TailorPage() {
  return <TailorForm costLine={await expectedCostLine()} />;
}
