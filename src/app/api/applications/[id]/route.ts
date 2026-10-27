import { z } from "zod";
import { ResumeStateSchema } from "@/applications/schema";
import { applications } from "@/lib/deps";
import { handle, readJson, requireProfile } from "@/lib/http";

type Context = { params: Promise<{ id: string }> };

const UpdateSchema = z.object({ resume: ResumeStateSchema });

export async function GET(request: Request, { params }: Context) {
  return handle(async () => {
    const { id } = await params;
    return Response.json({ application: await applications.get(requireProfile(request), id) });
  });
}

export async function PUT(request: Request, { params }: Context) {
  return handle(async () => {
    const { id } = await params;
    const profile = requireProfile(request);
    const body = UpdateSchema.parse(await readJson(request));
    const existing = await applications.get(profile, id);
    const saved = await applications.save(profile, { ...existing, resume: body.resume });
    return Response.json({ application: saved });
  });
}

export async function DELETE(request: Request, { params }: Context) {
  return handle(async () => {
    const { id } = await params;
    await applications.delete(requireProfile(request), id);
    return Response.json({ ok: true });
  });
}
