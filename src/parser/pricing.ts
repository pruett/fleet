/**
 * Model pricing table for estimating API costs from token usage.
 *
 * Prices are in USD per million tokens (MTok).
 * Source: https://platform.claude.com/docs/en/about-claude/pricing
 */

export interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheWritePerMTok: number;
  cacheReadPerMTok: number;
}

const OPUS_NEW: ModelPricing = {
  inputPerMTok: 5,
  outputPerMTok: 25,
  cacheWritePerMTok: 6.25,
  cacheReadPerMTok: 0.5,
};

const OPUS_LEGACY: ModelPricing = {
  inputPerMTok: 15,
  outputPerMTok: 75,
  cacheWritePerMTok: 18.75,
  cacheReadPerMTok: 1.5,
};

const SONNET: ModelPricing = {
  inputPerMTok: 3,
  outputPerMTok: 15,
  cacheWritePerMTok: 3.75,
  cacheReadPerMTok: 0.3,
};

const HAIKU_45: ModelPricing = {
  inputPerMTok: 1,
  outputPerMTok: 5,
  cacheWritePerMTok: 1.25,
  cacheReadPerMTok: 0.1,
};

const HAIKU_35: ModelPricing = {
  inputPerMTok: 0.8,
  outputPerMTok: 4,
  cacheWritePerMTok: 1,
  cacheReadPerMTok: 0.08,
};

const HAIKU_3: ModelPricing = {
  inputPerMTok: 0.25,
  outputPerMTok: 1.25,
  cacheWritePerMTok: 0.3,
  cacheReadPerMTok: 0.03,
};

/**
 * Ordered prefix rules for matching model IDs to pricing tiers.
 * More specific prefixes appear first to prevent shorter prefixes
 * from matching longer model IDs incorrectly.
 */
const PRICING_RULES: ReadonlyArray<[prefix: string, pricing: ModelPricing]> = [
  // Opus: 4.5+ → $5/$25, older → $15/$75
  ["claude-opus-4-6", OPUS_NEW],
  ["claude-opus-4-5", OPUS_NEW],
  ["claude-opus-4", OPUS_LEGACY],
  // Sonnet: all versions → $3/$15
  ["claude-sonnet-", SONNET],
  // Haiku: 4.5 → $1/$5, 3.5 → $0.80/$4, 3 → $0.25/$1.25
  ["claude-haiku-4", HAIKU_45],
  // Claude 3.x naming convention (claude-{ver}-{family})
  ["claude-3-opus", OPUS_LEGACY],
  ["claude-3-5-sonnet", SONNET],
  ["claude-3-7-sonnet", SONNET],
  ["claude-3-5-haiku", HAIKU_35],
  ["claude-3-haiku", HAIKU_3],
];

/**
 * Look up pricing for a model ID. Returns null for unknown models.
 */
export function lookupPricing(model: string): ModelPricing | null {
  for (const [prefix, pricing] of PRICING_RULES) {
    if (model.startsWith(prefix)) return pricing;
  }
  return null;
}

/**
 * Compute estimated cost in USD for a single API response.
 * Returns 0 for unknown models.
 */
export function computeCost(
  inputTokens: number,
  outputTokens: number,
  cacheCreationInputTokens: number,
  cacheReadInputTokens: number,
  model: string,
): number {
  const pricing = lookupPricing(model);
  if (!pricing) return 0;

  return (
    (inputTokens / 1_000_000) * pricing.inputPerMTok +
    (outputTokens / 1_000_000) * pricing.outputPerMTok +
    (cacheCreationInputTokens / 1_000_000) * pricing.cacheWritePerMTok +
    (cacheReadInputTokens / 1_000_000) * pricing.cacheReadPerMTok
  );
}
