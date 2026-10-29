import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApplicationRepository } from "@/applications/repository";
import { fullStateFromBank } from "@/applications/resume-state";
import { BankRepository } from "@/bank/repository";
import { user } from "@/db/schema";
import { createTestDb } from "@/db/test-db";
import { createManualApplication } from "@/tailor/tailor";
import { usageFromError } from "@/billing/usage-error";
import type { ModelUsage } from "@/billing/usage-types";
import { AppError } from "@/lib/errors";
import { jsonBytes, MAX_BANK_JSON_BYTES } from "@/lib/input-caps";
import { checkChatMessages, runChat } from "./chat";
import type { ChatModel } from "./model";
import { type ChatResult, EMPTY_BANK_CHANGE, EMPTY_RESUME_CHANGE } from "./schema";

let close: () => Promise<void>;
let banks: BankRepository;
let applications: ApplicationRepository;
const USER = "user_1";

const fakeUsage: ModelUsage = { model: "fake", inputTokens: 4_000, outputTokens: 300 };

class FakeModel implements ChatModel {
  readonly id = "fake";
  systems: string[] = [];
  constructor(private readonly result: ChatResult) {}
  async chat(system: string) {
    this.systems.push(system);
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

describe("runChat", () => {
  it("applies bank changes, persists them, passes resume changes through when a resume is open, and reports the tokens used", async () => {
    const app = await createManualApplication({ userId: USER, jobDescription: "JD", company: "Acme" }, { banks, applications });
    const model = new FakeModel({
      reply: "Added it.",
      bankChanges: [{ ...EMPTY_BANK_CHANGE, kind: "addSkills", category: "Cloud", texts: ["AWS"] }],
      resumeChanges: [{ ...EMPTY_RESUME_CHANGE, kind: "setSummary", text: "New" }],
    });
    const { outcome, usage } = await runChat(
      { userId: USER, application: app, resume: fullStateFromBank(app.resume && (await banks.read(USER))), messages: [{ role: "user", content: "I know AWS; also shorten my summary" }] },
      { banks, model },
    );
    expect(usage).toEqual(fakeUsage);
    expect(outcome.bankChanged).toBe(true);
    expect(outcome.applied[0]).toContain("AWS");
    expect((await banks.read(USER)).skills.some((s) => s.name === "Cloud")).toBe(true);
    expect(outcome.resumeChanges).toHaveLength(1);
    expect(model.systems[0]).toContain("<resume>");
    expect(model.systems[0]).toContain("Acme");
  });

  it("ignores resume changes without an open resume and does not write an unchanged bank", async () => {
    const model = new FakeModel({ reply: "Hi", bankChanges: [], resumeChanges: [{ ...EMPTY_RESUME_CHANGE, kind: "setSummary", text: "x" }] });
    const { outcome } = await runChat({ userId: USER, messages: [{ role: "user", content: "hello" }] }, { banks, model });
    expect(outcome.bankChanged).toBe(false);
    expect(outcome.resumeChanges).toEqual([]);
    expect(outcome.warnings[0]).toContain("no resume is open");
    expect(model.systems[0]).not.toContain("<resume>");
  });

  it("rethrows a failure to save the bank after the model answered, tagged with the tokens it used", async () => {
    const failure = new AppError("Could not save", 500);
    vi.spyOn(banks, "write").mockRejectedValue(failure);
    const model = new FakeModel({
      reply: "Added it.",
      bankChanges: [{ ...EMPTY_BANK_CHANGE, kind: "addSkills", category: "Cloud", texts: ["AWS"] }],
      resumeChanges: [],
    });
    const err = await runChat({ userId: USER, messages: [{ role: "user", content: "I know AWS" }] }, { banks, model }).catch(
      (e: unknown) => e,
    );
    expect(err).toBe(failure);
    expect(usageFromError(err)).toEqual(fakeUsage);
  });

  it("skips the bank write, with a warning, when Claude's changes would take the bank over 300 KB", async () => {
    const before = await banks.read(USER);
    const filler = Array.from({ length: 460 }, (_, i) => ({ id: `f${i}`, text: "x".repeat(600) }));
    const full = { ...before, projects: [...before.projects, { id: "e_fill", title: "Filler", start: "", end: "", bullets: filler }] };
    await banks.write(USER, full);
    expect(jsonBytes(full)).toBeLessThanOrEqual(MAX_BANK_JSON_BYTES);
    const texts = Array.from({ length: 40 }, (_, i) => `${i} ${"y".repeat(590)}`);
    const model = new FakeModel({ reply: "Added them.", bankChanges: [{ ...EMPTY_BANK_CHANGE, kind: "addBullets", entryId: "e_fill", texts }], resumeChanges: [] });

    const { outcome } = await runChat({ userId: USER, messages: [{ role: "user", content: "add these" }] }, { banks, model });

    expect(outcome.bankChanged).toBe(false);
    expect(outcome.applied).toEqual([]);
    expect(outcome.warnings).toContain("Claude's changes would make your bank larger than 300 KB, so none were saved");
    expect(outcome.bank).toEqual(full);
    expect(await banks.read(USER)).toEqual(full);
  });

  it("cuts a reply over 16,000 characters, so it cannot block later requests", async () => {
    const model = new FakeModel({ reply: "r".repeat(20_000), bankChanges: [], resumeChanges: [] });
    const { outcome } = await runChat({ userId: USER, messages: [{ role: "user", content: "talk a lot" }] }, { banks, model });
    expect(outcome.reply).toHaveLength(16_000);
    expect(outcome.warnings).toContain("Claude's reply was cut to 16,000 characters");
  });

  it("rejects a conversation that does not end with a user message", async () => {
    const model = new FakeModel({ reply: "", bankChanges: [], resumeChanges: [] });
    await expect(runChat({ userId: USER, messages: [{ role: "assistant", content: "?" }] }, { banks, model })).rejects.toMatchObject({ status: 400 });
  });
});

describe("checkChatMessages", () => {
  it("accepts a conversation that ends with a user message", () => {
    expect(() => checkChatMessages([{ role: "assistant", content: "Hi" }, { role: "user", content: "Go on" }])).not.toThrow();
  });

  it.each([
    [[]],
    [[{ role: "assistant" as const, content: "?" }]],
    [[{ role: "user" as const, content: "   " }]],
  ])("refuses %j with a 400", (messages) => {
    expect(() => checkChatMessages(messages)).toThrow(expect.objectContaining({ status: 400 }));
  });
});
