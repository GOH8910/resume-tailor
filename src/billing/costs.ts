import type { ModelUsage } from "./usage-types";

type Rates = { input: number; output: number };
/** `longContext` replaces both rates for a call whose prompt, cached tokens included, is over `threshold` tokens. */
type Price = Rates & { longContext?: Rates & { threshold: number } };

/** List prices in USD per million tokens. A model missing here is costed at FALLBACK_MODEL's price. */
const PRICES: Record<string, Price> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5, longContext: { threshold: 100_000, input: 0.5, output: 2.5 } },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-opus-5-5": { input: 4, output: 20 },
};

// The most expensive model: an unpriced one must not let free usage run past the daily budget.
export const FALLBACK_MODEL = "claude-opus-5-5";

const CACHE_READ_FACTOR = 0.1;
const CACHE_WRITE_FACTOR = 1.25;

const warnedModels = new Set<string>();

export type TokenCounts = Omit<ModelUsage, "model">;

export function knownModel(id: string): boolean {
  return Object.hasOwn(PRICES, id);
}

/** Pounds rounded to the six decimals the usage ledger stores. */
export function roundGbp(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

/** What a call cost in GBP at list prices, rounded to six decimals. */
export function estimateCostGbp(model: string, usage: TokenCounts, usdToGbp: number): number {
  const price = ratesFor(priceOf(model), usage);
  const perMillion =
    usage.inputTokens * price.input +
    usage.outputTokens * price.output +
    (usage.cacheReadTokens ?? 0) * price.input * CACHE_READ_FACTOR +
    (usage.cacheWriteTokens ?? 0) * price.input * CACHE_WRITE_FACTOR;
  return roundGbp((perMillion / 1_000_000) * usdToGbp);
}

/** Warns at boot about configured models without a price, so the operator learns before the first call is costed. */
export function warnUnpricedModels(ids: string[]): void {
  for (const id of ids) {
    if (!knownModel(id)) warnUnpriced(id);
  }
}

function ratesFor(price: Price, usage: TokenCounts): Rates {
  const prompt = usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
  return price.longContext && prompt > price.longContext.threshold ? price.longContext : price;
}

function priceOf(model: string): Price {
  if (knownModel(model)) return PRICES[model];
  warnUnpriced(model);
  return PRICES[FALLBACK_MODEL];
}

function warnUnpriced(model: string): void {
  if (warnedModels.has(model)) return;
  warnedModels.add(model);
  const { input, output } = PRICES[FALLBACK_MODEL];
  console.warn(
    `[costs] no price for model "${model}"; costing its calls at ${FALLBACK_MODEL} prices ($${input}/$${output} per million input/output tokens)`,
  );
}
