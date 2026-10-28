import { z } from "zod";
import { resolveResume } from "@/applications/resume-state";
import { ResumeStateSchema } from "@/applications/schema";
import { buildTex } from "@/latex/build";
import { compileTex } from "@/latex/compile";
import { compileQueue } from "@/latex/queue";
import { loadTemplate } from "@/latex/template";
import { applications, banks } from "@/lib/deps";
import { handle, pdfResponse, readJson, requireUser } from "@/lib/http";

const CompileRequestSchema = z.object({
  resume: ResumeStateSchema,
  applicationId: z.string().optional(),
});

export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser(request);
    const body = CompileRequestSchema.parse(await readJson(request));
    // Fail fast with a 404 for a deleted application instead of compiling a PDF that cannot be saved.
    if (body.applicationId) await applications.get(user.id, body.applicationId);
    const bank = await banks.read(user.id);
    const tex = buildTex(resolveResume(bank, body.resume), await loadTemplate());
    const result = await compileQueue.run(() => compileTex(tex));
    if (!result.ok) {
      return Response.json({ error: result.message, log: result.log }, { status: 422 });
    }
    if (body.applicationId) {
      await applications.savePdf(user.id, body.applicationId, result.pdf, result.pages);
    }
    return pdfResponse(result.pdf, result.pages, "resume.pdf");
  });
}
