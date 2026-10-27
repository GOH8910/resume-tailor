import { AppError } from "@/lib/errors";
import { applications } from "@/lib/deps";
import { handle, pdfResponse, requireProfile } from "@/lib/http";
import { countPdfPages } from "@/latex/page-count";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  return handle(async () => {
    const { id } = await params;
    const profile = requireProfile(request);
    const pdf = await applications.readPdf(profile, id);
    if (!pdf) throw new AppError("No PDF has been compiled for this application yet", 404);
    return pdfResponse(pdf, countPdfPages(pdf), `${id}.pdf`);
  });
}
