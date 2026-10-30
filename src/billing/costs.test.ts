import { afterEach, describe, expect, it, vi } from "vitest";
import { parseEnv } from "@/lib/env";
import { MODEL_IDS } from "@/tailor/model";
import { estimateCostGbp, knownModel, warnUnpricedModels } from "./costs";

afterEach(() => vi.restoreAllMocks());

// A typical tailor: ~10k tokens in, ~2.5k out.
const tailor = { inputTokens: 10_000, outputTokens: 2_500 };

describe("estimateCostGbp", () => {
  it("prices each model per million tokens and converts to GBP", () => {
    expect(estimateCostGbp("claude-haiku-5-5", tailor, 0.78)).toBe(0.001755); // $0.00225
    expect(estimateCostGbp("claude-sonnet-5-5", tailor, 0.78)).toBe(0.0351); // $0.045
    expect(estimateCostGbp("claude-opus-5-5", tailor, 0.78)).toBe(0.0702); // $0.09
  });

  it("prices cache reads at a tenth of the input price and cache writes at 125%", () => {
    const million = 1_000_000;
    expect(estimateCostGbp("claude-sonnet-5-5", { inputTokens: 0, outputTokens: 0, cacheReadTokens: million }, 1)).toBe(0.2);
    expect(estimateCostGbp("claude-sonnet-5-5", { inputTokens: 0, outputTokens: 0, cacheWriteTokens: million }, 1)).toBe(2.5);
  });

  it("prices Haiku at its long-prompt rates once the prompt is over 100k tokens", () => {
    // At a rate of 2 the odd token count still costs a whole number of millionths.
    expect(estimateCostGbp("claude-haiku-5-5", { inputTokens: 100_000, outputTokens: 100_000 }, 2)).toBe(0.12); // $0.10/$0.50
    expect(estimateCostGbp("claude-haiku-5-5", { inputTokens: 100_001, outputTokens: 100_000 }, 2)).toBe(0.600001); // $0.50/$2.50
  });

  it("counts cached prompt tokens towards the long-prompt threshold", () => {
    const at = (cacheReadTokens: number) => estimateCostGbp("claude-haiku-5-5", { inputTokens: 50_000, outputTokens: 0, cacheReadTokens }, 2);
    expect(at(50_000)).toBe(0.011); // (50k × 0.10 + 50k × 0.01) × 2 / 1M
    expect(at(50_001)).toBe(0.055); // (50k × 0.50 + 50,001 × 0.05) × 2 / 1M
  });

  it("rounds to six decimals, the precision the ledger stores", () => {
    // One Sonnet input token: $0.000002 × 0.78 = £0.00000156.
    expect(estimateCostGbp("claude-sonnet-5-5", { inputTokens: 1, outputTokens: 0 }, 0.78)).toBe(0.000002);
    expect(estimateCostGbp("claude-haiku-5-5", { inputTokens: 1, outputTokens: 0 }, 0.78)).toBe(0);
  });

  it("prices an unknown model as Opus, and warns once per model id", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const opus = estimateCostGbp("claude-opus-5-5", tailor, 0.78);
    expect(estimateCostGbp("claude-mystery-1", tailor, 0.78)).toBe(opus);
    expect(estimateCostGbp("claude-mystery-1", tailor, 0.78)).toBe(opus);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("claude-mystery-1"));
    estimateCostGbp("claude-mystery-2", tailor, 0.78);
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe("knownModel", () => {
  it("knows the priced models and nothing else", () => {
    expect(knownModel("claude-haiku-5-5")).toBe(true);
    expect(knownModel("claude-opus-5-5")).toBe(true);
    expect(knownModel("claude-opus-5-5-20261001")).toBe(false);
    expect(knownModel("toString")).toBe(false);
  });

  // Catches a model added to the picker or a default changed without a price.
  it("prices every model the app offers or defaults to", () => {
    const defaults = parseEnv({});
    for (const id of [...MODEL_IDS, defaults.FREE_MODEL, defaults.UNLIMITED_MODEL]) expect(knownModel(id), id).toBe(true);
  });
});

describe("warnUnpricedModels", () => {
  it("names each configured model without a price once, with the fallback pricing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    warnUnpricedModels(["claude-haiku-5-5", "claude-mystery-3", "claude-mystery-3"]);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/claude-mystery-3.*claude-opus-5-5/));
    // The first call it is costed for does not warn again.
    estimateCostGbp("claude-mystery-3", tailor, 0.78);
    expect(warn).toHaveBeenCalledOnce();
  });
});
