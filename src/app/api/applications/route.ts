import { JobInputSchema, requireRoomForApplication } from "@/applications/input";
import { applications, banks } from "@/lib/deps";
import { handle, readJson, requireUser } from "@/lib/http";
import { limitUser } from "@/lib/limits";
import { createManualApplication } from "@/tailor/tailor";

export async function GET(request: Request) {
  return handle(async () => {
    const user = await requireUser(request);
    return Response.json({ applications: await applications.list(user.id) });
  });
}

/** Creates a manual (no-AI) application seeded with the whole bank. */
export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser(request);
    limitUser("applicationCreate", user);
    const body = JobInputSchema.parse(await readJson(request));
    await requireRoomForApplication(applications, user.id);
    const application = await createManualApplication({ userId: user.id, ...body }, { banks, applications });
    return Response.json({ application }, { status: 201 });
  });
}
