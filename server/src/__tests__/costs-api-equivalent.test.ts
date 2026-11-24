import { describe, expect, it } from "vitest";
import { estimateApiEquivalentCost } from "../services/costs.ts";

describe("estimateApiEquivalentCost", () => {
  it("prices subscription-included token sums from the rate cards", () => {
    expect(estimateApiEquivalentCost([
      // 1M input × $3 + 2M cached × $0.30 + 100k output × $15 = $5.10
      { provider: "anthropic", model: "claude-sonnet-4-6-20260101", inputTokens: 1_000_000, cachedInputTokens: 2_000_000, outputTokens: 100_000, eventCount: 3 },
      // 1M input × $0.30 + 1M output × $2.50 = $2.80
      { provider: "google", model: "models/gemini-2.5-flash", inputTokens: 1_000_000, cachedInputTokens: 0, outputTokens: 1_000_000, eventCount: 2 },
    ])).toEqual({ estimatedApiCostCents: 790, estimatedApiCostCentsExact: "790.0000000", estimatedApiCostUnpricedEventCount: 0 });
  });

  it("counts events without a rate card instead of guessing a price", () => {
    expect(estimateApiEquivalentCost([
      { provider: "openai", model: "gpt-5.6-terra", inputTokens: 10, cachedInputTokens: 0, outputTokens: 10, eventCount: 4 },
      { provider: "cursor", model: "auto", inputTokens: 10, cachedInputTokens: 0, outputTokens: 10, eventCount: 1 },
    ])).toEqual({ estimatedApiCostCents: 0, estimatedApiCostCentsExact: "0.0000000", estimatedApiCostUnpricedEventCount: 5 });
  });

  it("returns zero for no groups", () => {
    expect(estimateApiEquivalentCost([])).toEqual({ estimatedApiCostCents: 0, estimatedApiCostCentsExact: "0.0000000", estimatedApiCostUnpricedEventCount: 0 });
  });
});
