import { z } from "zod";
import { banks } from "@/lib/deps";
import { handle } from "@/lib/http";

const CreateProfileSchema = z.object({ slug: z.string(), name: z.string().default("") });

export async function GET() {
  return handle(async () => Response.json({ profiles: await banks.listProfiles() }));
}

export async function POST(request: Request) {
  return handle(async () => {
    const body = CreateProfileSchema.parse(await request.json());
    const bank = await banks.createProfile(body.slug, body.name);
    return Response.json({ slug: body.slug, bank }, { status: 201 });
  });
}
