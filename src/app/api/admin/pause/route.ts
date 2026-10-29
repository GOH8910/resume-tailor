import { z } from "zod";
import { usage } from "@/lib/deps";
import { handle, readJson, requireAdmin } from "@/lib/http";

const Body = z.object({ paused: z.boolean() });

/** The operator's switch for free AI usage; it holds until switched back, across restarts. */
export async function POST(request: Request) {
  return handle(async () => {
    await requireAdmin(request);
    const { paused } = Body.parse(await readJson(request, 1_024));
    await usage.setFreePaused(paused);
    return Response.json({ paused });
  });
}
