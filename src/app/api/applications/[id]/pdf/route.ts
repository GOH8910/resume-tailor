import { AppError } from "@/lib/errors";
import { applications } from "@/lib/deps";
import { handle, pdfResponse, requireUser } from "@/lib/http";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  return handle(async () => {
    const user = await requireUser(request);
    const { id } = await params;
    const stored = await applications.readPdf(user.id, id);
    if (!stored) throw new AppError("No PDF has been compiled for this application yet", 404);
    return pdfResponse(stored.pdf, stored.pages, `${id}.pdf`);
  });
}
