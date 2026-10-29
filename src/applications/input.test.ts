import { describe, expect, it, vi } from "vitest";
import { JobInputSchema, requireResumeWithinSize, requireRoomForApplication } from "./input";

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

  it("passes a resume up to 200 KB as JSON, and no resume at all", () => {
    expect(() => requireResumeWithinSize(resumeOf(300))).not.toThrow();
    expect(() => requireResumeWithinSize(undefined)).not.toThrow();
  });

  it("refuses a larger one with a 413", () => {
    expect(() => requireResumeWithinSize(resumeOf(400))).toThrow(
      expect.objectContaining({ status: 413, message: "The resume is too large: keep it under 200 KB" }),
    );
  });
});
