import { describe, expect, it, vi } from "vitest";
import { type Bank, BankInputSchema, type Bullet, emptyBank } from "@/bank/schema";
import { jsonBytes, MAX_BANK_JSON_BYTES } from "@/lib/input-caps";
import { JobInputSchema, requireResumeWithinSize, requireRoomForApplication } from "./input";
import { fullStateFromBank } from "./resume-state";

const job = { company: "Acme", jobDescription: "We need Go engineers." };

describe("JobInputSchema", () => {
  it.each([
    ["jobDescription", 20_000],
    ["company", 200],
    ["roleTitle", 200],
  ] as const)("accepts %s at %i characters and refuses one more", (field, max) => {
    expect(JobInputSchema.safeParse({ ...job, [field]: "x".repeat(max) }).success).toBe(true);
    expect(JobInputSchema.safeParse({ ...job, [field]: "x".repeat(max + 1) }).success).toBe(false);
  });

  it("keeps roleTitle optional", () => {
    expect(JobInputSchema.parse(job)).toEqual(job);
  });
});

describe("requireRoomForApplication", () => {
  it("passes below 200 saved resumes", async () => {
    const count = vi.fn().mockResolvedValue(199);
    await expect(requireRoomForApplication({ count }, "u1")).resolves.toBeUndefined();
    expect(count).toHaveBeenCalledWith("u1");
  });

  it("refuses the 201st with a 409 that says what to do", async () => {
    await expect(requireRoomForApplication({ count: async () => 200 }, "u1")).rejects.toMatchObject({
      status: 409,
      message: "You have 200 saved resumes; delete some first",
    });
  });
});

describe("requireResumeWithinSize", () => {
  const resumeOf = (bullets: number) => ({
    summary: "",
    education: [],
    experience: [
      { entryId: "e1", rationale: "", bullets: Array.from({ length: bullets }, (_, i) => ({ bulletId: `b${i}`, original: "", text: "x".repeat(600) })) },
    ],
    projects: [],
    skills: [],
  });

  it("passes a resume up to 700 KB as JSON, and no resume at all", () => {
    expect(() => requireResumeWithinSize(resumeOf(1_000))).not.toThrow();
    expect(() => requireResumeWithinSize(undefined)).not.toThrow();
  });

  it("refuses a larger one with a 413", () => {
    expect(() => requireResumeWithinSize(resumeOf(1_200))).toThrow(
      expect.objectContaining({ status: 413, message: "The resume is too large: keep it under 700 KB" }),
    );
  });

  // "Start from full bank" copies every bullet into the resume twice (original and text).
  it("passes a full-bank resume built from a bank at the 300 KB cap", () => {
    const bullets: Bullet[] = [];
    const bank = (): Bank => ({ ...emptyBank("Ada"), summary: "s".repeat(2_000), experience: [{ id: "e1", title: "Engineer", start: "", end: "", bullets }] });
    while (jsonBytes(bank()) + 700 <= MAX_BANK_JSON_BYTES) bullets.push({ id: `b${bullets.length}`, text: "é".repeat(300) });
    expect(jsonBytes(bank())).toBeGreaterThan(MAX_BANK_JSON_BYTES - 700);
    expect(BankInputSchema.safeParse(bank()).success).toBe(true);
    expect(() => requireResumeWithinSize(fullStateFromBank(bank()))).not.toThrow();
  });
});
