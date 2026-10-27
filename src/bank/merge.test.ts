import { describe, expect, it } from "vitest";
import { type ExtractedBank, mergeBank } from "./merge";
import { emptyBank } from "./schema";

function counter() {
  let n = 0;
  return (prefix: string) => `${prefix}_${++n}`;
}

const extracted: ExtractedBank = {
  profile: { name: "Sam Smith", email: "sam@example.com", phone: "", linkedin: "https://linkedin.com/in/sam" },
  summary: "Extracted summary.",
  education: [],
  experience: [
    {
      title: "Software Engineer Intern",
      org: "Acme Corp",
      location: "London, UK",
      start: "Jul 2024",
      end: "Jan 2025",
      bullets: ["Built a Go service.", "Cut latency by 80%."],
    },
  ],
  projects: [{ title: "Trail Planner", start: "2024", end: "Present", bullets: ["Next.js app."] }],
  skills: [{ name: "Programming", items: ["Go", "typescript"] }],
};

describe("mergeBank", () => {
  it("fills an empty bank with ids", () => {
    const bank = mergeBank(emptyBank(), extracted, counter());
    expect(bank.profile).toEqual({ name: "Sam Smith", email: "sam@example.com", phone: "", linkedin: "https://linkedin.com/in/sam", github: undefined, website: undefined });
    expect(bank.summary).toBe("Extracted summary.");
    expect(bank.experience[0].id).toBe("e_1");
    expect(bank.experience[0].bullets.map((b) => b.id)).toEqual(["b_2", "b_3"]);
    expect(bank.projects[0].org).toBeUndefined();
    expect(bank.projects[0].id).toBe("e_4");
    expect(bank.skills).toEqual([{ id: "s_6", name: "Programming", items: ["Go", "typescript"] }]);
  });

  it("appends only new bullets to a matching entry and keeps existing profile and summary", () => {
    const existing = mergeBank(emptyBank(), extracted, counter());
    const again: ExtractedBank = {
      ...extracted,
      profile: { name: "Other Name", phone: "+44 1" },
      summary: "Different summary.",
      experience: [
        {
          ...extracted.experience[0],
          title: "software engineer intern",
          bullets: ["Built a Go service.", "  Shipped CI.  "],
        },
      ],
      skills: [{ name: "programming", items: ["GO", "Rust"] }],
    };
    const merged = mergeBank(existing, again, counter());
    expect(merged.profile.name).toBe("Sam Smith");
    expect(merged.profile.phone).toBe("+44 1");
    expect(merged.summary).toBe("Extracted summary.");
    expect(merged.experience).toHaveLength(1);
    expect(merged.experience[0].bullets.map((b) => b.text)).toEqual(["Built a Go service.", "Cut latency by 80%.", "Shipped CI."]);
    expect(merged.skills[0].items).toEqual(["Go", "typescript", "Rust"]);
    expect(existing.experience[0].bullets).toHaveLength(2);
  });

  it("skips entries with no title and blank bullets", () => {
    const bank = mergeBank(emptyBank(), { ...extracted, experience: [{ title: " ", start: "", end: "", bullets: ["x"] }], projects: [{ title: "P", start: "", end: "", bullets: ["", "  "] }] }, counter());
    expect(bank.experience).toEqual([]);
    expect(bank.projects[0].bullets).toEqual([]);
  });
});
