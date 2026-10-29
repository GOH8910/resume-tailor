import { exportAccount } from "@/account/export";
import { getDb } from "@/db/client";
import { handle, requireUser } from "@/lib/http";
import { limitUser } from "@/lib/limits";

/** "Download my data": everything the account has stored, as a JSON file. */
export async function GET(request: Request) {
  return handle(async () => {
    const user = await requireUser(request);
    limitUser("accountExport", user);
    const data = await exportAccount(await getDb(), { id: user.id, email: user.email });
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": 'attachment; filename="resume-tailor-export.json"',
        "Cache-Control": "no-store",
      },
    });
  });
}
