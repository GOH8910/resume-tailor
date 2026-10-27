import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { assertProfileSlug } from "@/bank/repository";
import { AppError } from "@/lib/errors";
import { exists, isEnoent, writeFileAtomic, writeJsonAtomic } from "@/lib/fs";
import { APPLICATION_ID, assertApplicationId } from "./ids";
import { type Application, ApplicationSchema, type ApplicationSummary } from "./schema";

export class ApplicationRepository {
  constructor(readonly root: string) {}

  dir(slug: string): string {
    return path.join(this.root, assertProfileSlug(slug), "applications");
  }

  jsonPath(slug: string, id: string): string {
    return path.join(this.dir(slug), `${assertApplicationId(id)}.json`);
  }

  pdfPath(slug: string, id: string): string {
    return path.join(this.dir(slug), `${assertApplicationId(id)}.pdf`);
  }

  async list(slug: string): Promise<ApplicationSummary[]> {
    let names: string[];
    try {
      names = await readdir(this.dir(slug));
    } catch (err) {
      if (isEnoent(err)) return [];
      throw err;
    }
    const ids = names
      .filter((n) => n.endsWith(".json"))
      .map((n) => n.slice(0, -".json".length))
      .filter((stem) => APPLICATION_ID.test(stem));
    // One unreadable file must not break the whole listing, so skip it with a warning.
    const summaries = await Promise.all(
      ids.map(async (id): Promise<ApplicationSummary | null> => {
        try {
          const app = await this.get(slug, id);
          return {
            id: app.id,
            createdAt: app.createdAt,
            company: app.company,
            roleTitle: app.roleTitle,
            model: app.model,
            hasPdf: await exists(this.pdfPath(slug, id)),
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.warn(`Skipping unreadable application ${this.jsonPath(slug, id)}: ${message}`);
          return null;
        }
      }),
    );
    return summaries
      .filter((s): s is ApplicationSummary => s !== null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  }

  async get(slug: string, id: string): Promise<Application> {
    const file = this.jsonPath(slug, id);
    let raw: string;
    try {
      raw = await readFile(file, "utf8");
    } catch (err) {
      if (isEnoent(err)) throw new AppError(`Application "${id}" not found`, 404);
      throw err;
    }
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new AppError(`${file} is not valid JSON`, 500);
    }
    const parsed = ApplicationSchema.safeParse(json);
    if (!parsed.success) throw new AppError(`${file} does not match the application schema`, 500, parsed.error.issues);
    if (parsed.data.id !== id) {
      throw new AppError(`${file} contains id "${parsed.data.id}", expected "${id}"`, 500);
    }
    return parsed.data;
  }

  async save(slug: string, application: unknown): Promise<Application> {
    const parsed = ApplicationSchema.safeParse(application);
    if (!parsed.success) throw new AppError("Application does not match the schema", 400, parsed.error.issues);
    await writeJsonAtomic(this.jsonPath(slug, parsed.data.id), parsed.data);
    return parsed.data;
  }

  async delete(slug: string, id: string): Promise<void> {
    // PDF first: if the second removal fails, the application stays listed and can be retried.
    await rm(this.pdfPath(slug, id), { force: true });
    await rm(this.jsonPath(slug, id), { force: true });
  }

  async savePdf(slug: string, id: string, pdf: Buffer): Promise<void> {
    const file = this.pdfPath(slug, id);
    if (!(await exists(this.jsonPath(slug, id)))) throw new AppError(`Application "${id}" not found`, 404);
    await writeFileAtomic(file, pdf);
  }

  async readPdf(slug: string, id: string): Promise<Buffer | null> {
    try {
      return await readFile(this.pdfPath(slug, id));
    } catch (err) {
      if (isEnoent(err)) return null;
      throw err;
    }
  }
}
