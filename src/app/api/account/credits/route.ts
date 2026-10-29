import { credits } from "@/lib/deps";
import { handle, requireUser } from "@/lib/http";

const LEDGER_ROWS = 50;

/** The account's balance and its latest ledger rows, newest first, for the account page. */
export async function GET(request: Request) {
  return handle(async () => {
    const user = await requireUser(request);
    const [balance, history] = await Promise.all([credits.balance(user.id), credits.history(user.id, LEDGER_ROWS)]);
    const events = history.map(({ kind, amount, ref, createdAt }) => ({ kind, amount, ref, createdAt }));
    return Response.json({ credits: balance, events });
  });
}
