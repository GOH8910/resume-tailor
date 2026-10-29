import { describe, expect, it, vi } from "vitest";
import { JobInputSchema, requireRoomForApplication } from "./input";

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
