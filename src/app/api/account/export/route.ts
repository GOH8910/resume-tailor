import { exportStream } from "@/account/export";
import { createExportSlots } from "@/account/export-slots";
import { getDb } from "@/db/client";
import { handle, requireUser } from "@/lib/http";
import { limitUser } from "@/lib/limits";

const exportSlots = createExportSlots(2);

/** "Download my data": everything the account has stored, streamed as a JSON file. */
export async function GET(request: Request) {
  return handle(async () => {
    const user = await requireUser(request);
    // Claimed before the rate limit, so a refused second click does not use up one of the hour's exports.
    const release = exportSlots.claim(user.id);
    try {
      limitUser("accountExport", user);
      const body = await exportStream(await getDb(), { id: user.id, email: user.email }, release);
      return new Response(body, {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": 'attachment; filename="resume-tailor-export.json"',
          "Cache-Control": "no-store",
        },
      });
    } catch (err) {
      release();
      throw err;
    }
  });
}
