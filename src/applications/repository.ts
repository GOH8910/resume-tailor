import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { applications } from "@/db/schema";
import type { Db } from "@/db/types";
import { AppError } from "@/lib/errors";
import { assertApplicationId } from "./ids";
import { type Application, ApplicationSchema, type ApplicationSummary } from "./schema";

export class ApplicationRepository {
  constructor(private readonly db: () => Promise<Db>) {}

  async list(userId: string): Promise<ApplicationSummary[]> {
    const db = await this.db();
    const rows = await db
      .select({
        id: applications.id,
        createdAt: sql<string>`${applications.data}->>'createdAt'`,
        company: sql<string>`${applications.data}->>'company'`,
        roleTitle: sql<string>`coalesce(${applications.data}->>'roleTitle', '')`,
        model: sql<string>`${applications.data}->>'model'`,
        hasPdf: isNotNull(applications.pdf),
      })
      .from(applications)
      .where(eq(applications.userId, userId))
      .orderBy(desc(sql`${applications.data}->>'createdAt'`), desc(applications.id));
    return rows.map((r) => ({ ...r, hasPdf: Boolean(r.hasPdf) }));
  }

  async get(userId: string, id: string): Promise<Application> {
    const db = await this.db();
    const [row] = await db
      .select({ data: applications.data })
      .from(applications)
      .where(and(eq(applications.userId, userId), eq(applications.id, assertApplicationId(id))));
    if (!row) throw new AppError(`Application "${id}" not found`, 404);
    const parsed = ApplicationSchema.safeParse(row.data);
    if (!parsed.success) throw new AppError("Stored application does not match the schema", 500, parsed.error.issues);
    return parsed.data;
  }

  async save(userId: string, application: unknown): Promise<Application> {
    const parsed = ApplicationSchema.safeParse(application);
    if (!parsed.success) throw new AppError("Application does not match the schema", 400, parsed.error.issues);
    const db = await this.db();
    await db
      .insert(applications)
      .values({ userId, id: parsed.data.id, data: parsed.data })
      .onConflictDoUpdate({ target: [applications.userId, applications.id], set: { data: parsed.data } });
    return parsed.data;
  }

  async delete(userId: string, id: string): Promise<void> {
    const db = await this.db();
    await db.delete(applications).where(and(eq(applications.userId, userId), eq(applications.id, assertApplicationId(id))));
  }

  async savePdf(userId: string, id: string, pdf: Buffer, pages: number): Promise<void> {
    const db = await this.db();
    const updated = await db
      .update(applications)
      .set({ pdf, pdfPages: pages })
      .where(and(eq(applications.userId, userId), eq(applications.id, assertApplicationId(id))))
      .returning({ id: applications.id });
    if (updated.length === 0) throw new AppError(`Application "${id}" not found`, 404);
  }

  async readPdf(userId: string, id: string): Promise<{ pdf: Buffer; pages: number } | null> {
    const db = await this.db();
    const [row] = await db
      .select({ pdf: applications.pdf, pages: applications.pdfPages })
      .from(applications)
      .where(and(eq(applications.userId, userId), eq(applications.id, assertApplicationId(id))));
    if (!row?.pdf) return null;
    return { pdf: row.pdf, pages: row.pages ?? 0 };
  }
}
