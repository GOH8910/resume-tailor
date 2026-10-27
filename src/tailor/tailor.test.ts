import { cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApplicationRepository } from "@/applications/repository";
import { BankRepository } from "@/bank/repository";
import type { TailorModel, TailorRequest } from "./model";
import type { TailorResult } from "./schema";
import { createManualApplication, runTailor } from "./tailor";

let root: string;
let banks: BankRepository;
let applications: ApplicationRepository;

const fakeResult: TailorResult = {
  summary: "Go-focused summary.",
  education: [{ entryId: "e_edu1", rationale: "r", bullets: [{ bulletId: "b_edu1a", edited: null }] }],
  experience: [{ entryId: "e_exp1", rationale: "Go service", bullets: [{ bulletId: "b_exp1b", edited: "Cut latency." }] }],
  projects: [],
  skills: [{ name: "Programming", items: ["Go"] }],
  notes: "JD asks for Rust; bank has none.",
};

class FakeModel implements TailorModel {
  readonly id = "fake-model";
  requests: TailorRequest[] = [];
  constructor(private readonly result: TailorResult) {}
  async tailor(req: TailorRequest): Promise<TailorResult> {
    this.requests.push(req);
    return this.result;
  }
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "tailor-"));
  await cp("data/example", path.join(root, "example"), { recursive: true });
  banks = new BankRepository(root);
  applications = new ApplicationRepository(root);
});
afterEach(() => rm(root, { recursive: true, force: true }));

describe("runTailor", () => {
  it("calls the model with the bank, validates, and saves an application", async () => {
    const model = new FakeModel(fakeResult);
    const now = () => new Date(2026, 9, 27, 9); // local time: ids use the local date
    const app = await runTailor(
      { profile: "example", jobDescription: "We need Go.", company: "Acme Corp", roleTitle: "Backend" },
      { banks, applications, model, now },
    );
    expect(app.id).toMatch(/^2026-10-27-acme-corp-[0-9a-f]{8}$/);
    expect(app.model).toBe("fake-model");
    expect(app.notes).toContain("Rust");
    expect(app.resume.summary).toBe("Go-focused summary.");
    expect(app.resume.experience[0].bullets.map((b) => b.bulletId)).toEqual(["b_exp1a", "b_exp1b"]);
    expect(model.requests[0].user).toContain("We need Go.");
    expect(await applications.get("example", app.id)).toEqual(app);
  });

  it("rejects an empty job description or company", async () => {
    const deps = { banks, applications, model: new FakeModel(fakeResult) };
    await expect(runTailor({ profile: "example", jobDescription: " ", company: "Acme" }, deps)).rejects.toMatchObject({ status: 400 });
    await expect(runTailor({ profile: "example", jobDescription: "x", company: " " }, deps)).rejects.toMatchObject({ status: 400 });
  });
});

describe("createManualApplication", () => {
  it("saves the full bank as the starting state", async () => {
    const app = await createManualApplication({ profile: "example", jobDescription: "JD", company: "Acme" }, { banks, applications });
    expect(app.model).toBe("manual");
    expect(app.resume.experience).toHaveLength(2);
  });
});
