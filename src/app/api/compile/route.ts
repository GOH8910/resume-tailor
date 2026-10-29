import { z } from "zod";
import { requireResumeWithinSize } from "@/applications/input";
import { resolveResume } from "@/applications/resume-state";
import { ResumeStateInputSchema } from "@/applications/schema";
import { buildTex } from "@/latex/build";
import { compileTex } from "@/latex/compile";
import { compileQueue } from "@/latex/queue";
import { slotIdentity } from "@/latex/slot-user";
import { loadTemplate } from "@/latex/template";
import { applications, banks } from "@/lib/deps";
import { env } from "@/lib/env";
import { handle, pdfResponse, readJson, requireUser } from "@/lib/http";
import { limitUser } from "@/lib/limits";

const CompileRequestSchema = z.object({
  resume: ResumeStateInputSchema,
  applicationId: z.string().optional(),
});

export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser(request);
    limitUser("compile", user);
    const body = CompileRequestSchema.parse(await readJson(request));
    requireResumeWithinSize(body.resume);
    // Fail fast with a 404 for a deleted application instead of compiling a PDF that cannot be saved.
    if (body.applicationId) await applications.get(user.id, body.applicationId);
    const bank = await banks.read(user.id);
    const tex = buildTex(resolveResume(bank, body.resume), await loadTemplate());
    // A full queue answers 503 with details.retryAfter, which handle() also sends as Retry-After.
    const result = await compileQueue.run((slot) => compileTex(tex, slotIdentity(env.LATEX_RUN_AS, slot)));
    if (!result.ok) {
      return Response.json({ error: result.message, log: result.log }, { status: 422 });
    }
    if (body.applicationId) {
      await applications.savePdf(user.id, body.applicationId, result.pdf, result.pages);
    }
    return pdfResponse(result.pdf, result.pages, "resume.pdf");
  });
}
