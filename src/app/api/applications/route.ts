import { z } from "zod";
import { applications, banks } from "@/lib/deps";
import { handle, readJson, requireProfile } from "@/lib/http";
import { createManualApplication } from "@/tailor/tailor";

const CreateSchema = z.object({
  jobDescription: z.string(),
  company: z.string(),
  roleTitle: z.string().optional(),
});

export async function GET(request: Request) {
  return handle(async () => Response.json({ applications: await applications.list(requireProfile(request)) }));
}

/** Creates a manual (no-AI) application seeded with the whole bank. */
export async function POST(request: Request) {
  return handle(async () => {
    const profile = requireProfile(request);
    const body = CreateSchema.parse(await readJson(request));
    const application = await createManualApplication({ profile, ...body }, { banks, applications });
    return Response.json({ application }, { status: 201 });
  });
}
