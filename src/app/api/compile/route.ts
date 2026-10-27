import { z } from "zod";
import { resolveResume } from "@/applications/resume-state";
import { ResumeStateSchema } from "@/applications/schema";
import { buildTex } from "@/latex/build";
import { compileTex } from "@/latex/compile";
import { loadTemplate } from "@/latex/template";
import { applications, banks } from "@/lib/deps";
import { handle, pdfResponse } from "@/lib/http";

const CompileRequestSchema = z.object({
  profile: z.string(),
  resume: ResumeStateSchema,
  applicationId: z.string().optional(),
});

export async function POST(request: Request) {
  return handle(async () => {
    const body = CompileRequestSchema.parse(await request.json());
    const bank = await banks.read(body.profile);
    const tex = buildTex(resolveResume(bank, body.resume), await loadTemplate());
    const result = await compileTex(tex);
    if (!result.ok) {
      return Response.json({ error: result.message, log: result.log }, { status: 422 });
    }
    if (body.applicationId) {
      await applications.savePdf(body.profile, body.applicationId, result.pdf);
    }
    return pdfResponse(result.pdf, result.pages, "resume.pdf");
  });
}
