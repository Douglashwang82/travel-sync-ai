/**
 * Best-effort per-million-token prices for cost telemetry.
 * Numbers are USD per 1M tokens. Update when providers ship new tiers.
 *
 * Source of truth: each provider's pricing page. These figures are used to
 * populate llm_calls.cost_usd — they are NOT used for billing. Drift from
 * the provider's real-time price is acceptable.
 */

export interface ModelPricing {
  inputPerM: number;
  outputPerM: number;
  /** Optional cached-input price (Gemini context caching, Anthropic prompt cache hits). */
  cachedInputPerM?: number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  // Gemini 2.5 family
  "gemini-2.5-flash": { inputPerM: 0.075, outputPerM: 0.3, cachedInputPerM: 0.01875 },
  "gemini-2.5-pro": { inputPerM: 1.25, outputPerM: 10.0, cachedInputPerM: 0.3125 },
  "gemini-embedding-2": { inputPerM: 0.025, outputPerM: 0 },

  // Anthropic Claude 4 family
  "claude-opus-4-7": { inputPerM: 15.0, outputPerM: 75.0, cachedInputPerM: 1.5 },
  "claude-sonnet-4-6": { inputPerM: 3.0, outputPerM: 15.0, cachedInputPerM: 0.3 },
  "claude-haiku-4-5-20251001": { inputPerM: 1.0, outputPerM: 5.0, cachedInputPerM: 0.1 },
};

export function estimateCostUsd(
  model: string,
  tokensIn: number,
  tokensOut: number,
  cachedTokensIn = 0,
): number | null {
  const price = MODEL_PRICING[model];
  if (!price) return null;
  const freshIn = Math.max(0, tokensIn - cachedTokensIn);
  const cached = price.cachedInputPerM ?? price.inputPerM;
  const cost =
    (freshIn / 1_000_000) * price.inputPerM +
    (cachedTokensIn / 1_000_000) * cached +
    (tokensOut / 1_000_000) * price.outputPerM;
  return Number(cost.toFixed(6));
}
