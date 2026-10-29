import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApplicationRepository } from "@/applications/repository";
import { BankRepository } from "@/bank/repository";
import { user } from "@/db/schema";
import { createTestDb } from "@/db/test-db";
import { AppError } from "@/lib/errors";
import { DEFAULT_LIMITS } from "./limits";
import type { ModelUsage } from "@/billing/usage-types";
import type { TailorModel, TailorRequest } from "./model";
import { buildSystemPrompt } from "./prompt";
import type { TailorResult } from "./schema";
import { createManualApplication, runTailor } from "./tailor";

let close: () => Promise<void>;
let banks: BankRepository;
let applications: ApplicationRepository;
const USER = "user_1";

const fakeResult: TailorResult = {
  summary: "Go-focused summary.",
  education: [{ entryId: "e_edu1", rationale: "r", bullets: [{ bulletId: "b_edu1a", edited: null }] }],
  experience: [{ entryId: "e_exp1", rationale: "Go service", bullets: [{ bulletId: "b_exp1b", edited: "Cut latency." }] }],
  projects: [],
  skills: [{ name: "Programming", items: ["Go"] }],
  notes: "JD asks for Rust; bank has none.",
};

const fakeUsage: ModelUsage = { model: "fake-model", inputTokens: 10_000, outputTokens: 2_500 };

class FakeModel implements TailorModel {
  readonly id = "fake-model";
  requests: TailorRequest[] = [];
  constructor(private readonly result: TailorResult) {}
  async tailor(req: TailorRequest) {
    this.requests.push(req);
    return { result: this.result, usage: fakeUsage };
  }
}

beforeEach(async () => {
  const t = await createTestDb();
  close = t.close;
  await t.db.insert(user).values({ id: USER, name: "Ed", email: "ed@example.com" });
  banks = new BankRepository(async () => t.db);
  applications = new ApplicationRepository(async () => t.db);
  await banks.write(USER, JSON.parse(await readFile("data/example/bank.json", "utf8")));
});
afterEach(() => close());

describe("runTailor", () => {
  it("calls the model with the bank, validates, saves an application and reports the tokens used", async () => {
    const model = new FakeModel(fakeResult);
    const now = () => new Date(2026, 9, 27, 9); // local time: ids use the local date
    const { application: app, usage } = await runTailor(
      { userId: USER, jobDescription: "We need Go.", company: "Acme Corp", roleTitle: "Backend" },
      { banks, applications, model, now },
    );
    expect(usage).toEqual(fakeUsage);
    expect(app.id).toMatch(/^2026-10-27-acme-corp-[0-9a-f]{8}$/);
    expect(app.model).toBe("fake-model");
    expect(app.notes).toContain("Rust");
    expect(app.resume.summary).toBe("Go-focused summary.");
    expect(app.resume.experience[0].bullets.map((b) => b.bulletId)).toEqual(["b_exp1a", "b_exp1b"]);
    expect(model.requests[0].system).toBe(buildSystemPrompt(DEFAULT_LIMITS));
    expect(model.requests[0].user).toContain("We need Go.");
    expect(model.requests[0].user).toContain('"id":"b_exp1a"');
    expect(await applications.get(USER, app.id)).toEqual(app);
  });

  it("rejects an empty job description or company", async () => {
    const deps = { banks, applications, model: new FakeModel(fakeResult) };
    await expect(runTailor({ userId: USER, jobDescription: " ", company: "Acme" }, deps)).rejects.toMatchObject({ status: 400 });
    await expect(runTailor({ userId: USER, jobDescription: "x", company: " " }, deps)).rejects.toMatchObject({ status: 400 });
  });
});

describe("runTailor when the model fails", () => {
  it("rethrows and saves nothing", async () => {
    const failure = new AppError("boom", 502);
    const model: TailorModel = {
      id: "fake-model",
      tailor: async () => {
        throw failure;
      },
    };
    await expect(runTailor({ userId: USER, jobDescription: "We need Go.", company: "Acme" }, { banks, applications, model })).rejects.toBe(failure);
    expect(await applications.list(USER)).toEqual([]);
  });
});

describe("createManualApplication", () => {
  it("saves the full bank as the starting state", async () => {
    const app = await createManualApplication({ userId: USER, jobDescription: "JD", company: "Acme" }, { banks, applications });
    expect(app.model).toBe("manual");
    expect(app.resume.experience).toHaveLength(2);
  });
});
