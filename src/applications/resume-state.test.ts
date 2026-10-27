import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BankSchema } from "@/bank/schema";
import { renderContent } from "@/latex/build";
import type { TailorResult } from "@/tailor/schema";
import { fromTailorResult, fullStateFromBank, resolveResume } from "./resume-state";

const bank = BankSchema.parse(JSON.parse(readFileSync("data/example/bank.json", "utf8")));

const result: TailorResult = {
  summary: "Tailored.",
  education: [{ entryId: "e_edu1", rationale: "", bullets: [{ bulletId: "b_edu1a", edited: null }] }],
  experience: [
    {
      entryId: "e_exp1",
      rationale: "Backend",
      bullets: [
        { bulletId: "b_exp1b", edited: "Cut p95 latency to 120ms." },
        { bulletId: "b_exp1a", edited: null },
      ],
    },
  ],
  projects: [],
  skills: [{ name: "Programming", items: ["Go", "TypeScript"] }],
  notes: "",
};

describe("fromTailorResult", () => {
  it("keeps original text and applies edits", () => {
    const state = fromTailorResult(bank, result);
    const exp = state.experience[0];
    expect(exp.rationale).toBe("Backend");
    expect(exp.bullets[0]).toEqual({
      bulletId: "b_exp1b",
      original: "Cut p95 API latency from 800ms to 120ms by adding Redis caching and fixing N+1 queries.",
      text: "Cut p95 latency to 120ms.",
    });
    expect(exp.bullets[1].text).toBe(exp.bullets[1].original);
    expect(state.skills).toEqual([{ id: "s_lang", name: "Programming", items: ["Go", "TypeScript"] }]);
    expect(state.projects).toEqual([]);
  });
});

describe("fullStateFromBank", () => {
  it("includes every entry and bullet unchanged", () => {
    const state = fullStateFromBank(bank);
    expect(state.experience).toHaveLength(2);
    expect(state.experience[0].bullets).toHaveLength(4);
    expect(state.summary).toBe(bank.summary);
    expect(state.skills).toEqual(bank.skills);
    expect(state.skills).not.toBe(bank.skills);
  });
});

describe("resolveResume", () => {
  it("joins state with bank headers and renders", () => {
    const doc = resolveResume(bank, fromTailorResult(bank, result));
    expect(doc.experience[0].title).toBe("Software Engineer Intern");
    expect(doc.experience[0].org).toBe("Acme Corp");
    expect(doc.experience[0].bullets).toEqual([
      "Cut p95 latency to 120ms.",
      "Built a Go service that ingests 2M events/day from Kafka into PostgreSQL with exactly-once semantics.",
    ]);
    expect(renderContent(doc)).toContain("\\section{Experience}");
  });

  it("skips entries that no longer exist in the bank", () => {
    const state = fromTailorResult(bank, result);
    const doc = resolveResume({ ...bank, experience: [] }, state);
    expect(doc.experience).toEqual([]);
  });
});
