import { z } from "zod";
import { ResumeStateSchema } from "@/applications/schema";
import { applications } from "@/lib/deps";
import { handle, readJson, requireUser } from "@/lib/http";

type Context = { params: Promise<{ id: string }> };

const UpdateSchema = z.object({ resume: ResumeStateSchema });

export async function GET(request: Request, { params }: Context) {
  return handle(async () => {
    const user = await requireUser(request);
    const { id } = await params;
    return Response.json({ application: await applications.get(user.id, id) });
  });
}

export async function PUT(request: Request, { params }: Context) {
  return handle(async () => {
    const user = await requireUser(request);
    const { id } = await params;
    const body = UpdateSchema.parse(await readJson(request));
    const existing = await applications.get(user.id, id);
    const saved = await applications.save(user.id, { ...existing, resume: body.resume });
    return Response.json({ application: saved });
  });
}

export async function DELETE(request: Request, { params }: Context) {
  return handle(async () => {
    const user = await requireUser(request);
    const { id } = await params;
    await applications.delete(user.id, id);
    return Response.json({ ok: true });
  });
}
