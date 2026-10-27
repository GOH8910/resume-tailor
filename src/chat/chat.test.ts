import { cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApplicationRepository } from "@/applications/repository";
import { fullStateFromBank } from "@/applications/resume-state";
import { BankRepository } from "@/bank/repository";
import { createManualApplication } from "@/tailor/tailor";
import { runChat } from "./chat";
import type { ChatModel } from "./model";
import { type ChatResult, EMPTY_BANK_CHANGE, EMPTY_RESUME_CHANGE } from "./schema";

let root: string;
let banks: BankRepository;
let applications: ApplicationRepository;

class FakeModel implements ChatModel {
  readonly id = "fake";
  systems: string[] = [];
  constructor(private readonly result: ChatResult) {}
  async chat(system: string): Promise<ChatResult> {
    this.systems.push(system);
    return this.result;
  }
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "chat-"));
  await cp("data/example", path.join(root, "example"), { recursive: true });
  banks = new BankRepository(root);
  applications = new ApplicationRepository(root);
});
afterEach(() => rm(root, { recursive: true, force: true }));

describe("runChat", () => {
  it("applies bank changes, persists them, and passes resume changes through when a resume is open", async () => {
    const app = await createManualApplication({ profile: "example", jobDescription: "JD", company: "Acme" }, { banks, applications });
    const model = new FakeModel({
      reply: "Added it.",
      bankChanges: [{ ...EMPTY_BANK_CHANGE, kind: "addSkills", category: "Cloud", texts: ["AWS"] }],
      resumeChanges: [{ ...EMPTY_RESUME_CHANGE, kind: "setSummary", text: "New" }],
    });
    const outcome = await runChat(
      { profile: "example", applicationId: app.id, resume: fullStateFromBank(app.resume && (await banks.read("example"))), messages: [{ role: "user", content: "I know AWS; also shorten my summary" }] },
      { banks, applications, model },
    );
    expect(outcome.bankChanged).toBe(true);
    expect(outcome.applied[0]).toContain("AWS");
    expect((await banks.read("example")).skills.some((s) => s.name === "Cloud")).toBe(true);
    expect(outcome.resumeChanges).toHaveLength(1);
    expect(model.systems[0]).toContain("<resume>");
    expect(model.systems[0]).toContain("Acme");
  });

  it("ignores resume changes without an open resume and does not write an unchanged bank", async () => {
    const model = new FakeModel({ reply: "Hi", bankChanges: [], resumeChanges: [{ ...EMPTY_RESUME_CHANGE, kind: "setSummary", text: "x" }] });
    const outcome = await runChat({ profile: "example", messages: [{ role: "user", content: "hello" }] }, { banks, applications, model });
    expect(outcome.bankChanged).toBe(false);
    expect(outcome.resumeChanges).toEqual([]);
    expect(outcome.warnings[0]).toContain("no resume is open");
    expect(model.systems[0]).not.toContain("<resume>");
  });

  it("rejects a conversation that does not end with a user message", async () => {
    const model = new FakeModel({ reply: "", bankChanges: [], resumeChanges: [] });
    await expect(runChat({ profile: "example", messages: [{ role: "assistant", content: "?" }] }, { banks, applications, model })).rejects.toMatchObject({ status: 400 });
  });
});
