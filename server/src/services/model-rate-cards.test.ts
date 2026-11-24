import { describe, expect, it } from "vitest";
import type { AdapterUsageCheckpoint } from "@paperclipai/adapter-utils";
import { estimateApiCostUsd, lookupRateCard, normalizePricingModel } from "./model-rate-cards.js";
import { priceAnthropicReceipt } from "./anthropic-pricing.js";
import { priceCodexReceipt } from "./codex-pricing.js";
import { priceGeminiReceipt } from "./gemini-pricing.js";

const million = { inputTokens: 1_000_000, cachedInputTokens: 1_000_000, cacheWriteTokens: 0, outputTokens: 1_000_000 };

describe("official model rate cards", () => {
  it.each([
    ["claude-opus-5-5", "claude-opus-5-5"], ["opus", "claude-opus-5-5"], ["Claude-Haiku-4-5-20251001", "claude-haiku-4-5"],
    ["models/gemini-2.5-pro", "gemini-2.5-pro"], ["o4-mini-high", "o4-mini"], ["gpt-5-medium", "gpt-5"], ["gpt-5-mini", "gpt-5-mini"],
    ["anthropic/claude-sonnet-5-5", "claude-sonnet-5-5"], ["claude-opus-5-5-20261001-high", "claude-opus-5-5"],
    ["constructor", "constructor"], ["__proto__", "__proto__"], ["hasownproperty", "hasownproperty"],
  ])("normalizes %s to %s", (raw, key) => expect(normalizePricingModel(raw)).toBe(key));

  it.each([
    ["anthropic", "claude-fable-5-2", "48.800000000"], ["anthropic", "opus", "24.200000000"], ["anthropic", "claude-haiku-5-5", "0.610000000"],
    ["google", "gemini-4-argon", "12.100000000"], ["google", "gemini-3.8-flash", "4.575000000"], ["google", "gemini-2.5-flash", "2.830000000"],
    ["openai", "gpt-5", "11.375000000"], ["openai", "gpt-5-nano", "0.455000000"], ["openai", "o3-high", "10.500000000"],
  ])("estimates %s %s at list price", (provider, model, usd) => expect(estimateApiCostUsd({ provider, model, usage: million })).toBe(usd));

  it("keeps unknown models, providers and impossible counters unpriced", () => {
    expect(lookupRateCard("anthropic", "claude-sonnet-latest")).toBeUndefined();
    expect(lookupRateCard("google", "gemini-2.5-flash-lite")).toBeUndefined();
    expect(lookupRateCard("aws_bedrock", "claude-opus-5-5")).toBeUndefined();
    expect(lookupRateCard("anthropic", "gpt-5")).toBeUndefined();
    expect(estimateApiCostUsd({ provider: "openai", model: "gpt-5", usage: { inputTokens: 1, outputTokens: 1, cacheWriteTokens: 2 } })).toBeUndefined();
  });
});

describe("provider receipt pricing", () => {
  const base = { complete: true, usageBasis: "per_run", billingType: "metered_api", costUsd: null, costStatus: "unpriced", usage: million } as const;

  it("prices metered Gemini receipts with short-context provenance", () => {
    const receipt: AdapterUsageCheckpoint = { ...base, provider: "google", biller: "google", model: "gemini-2.5-pro" };
    const priced = priceGeminiReceipt(receipt);
    expect(priced.costUsdExact).toBe("11.375000000");
    expect(priced.costStatus).toBe("estimated");
    expect(priced.pricingProvenance).toMatchObject({ source: "rate_card", version: "google-standard-2026-11-24", contextTier: "short" });
  });

  it.each<Partial<AdapterUsageCheckpoint>>([{ billingType: "subscription_included" }, { model: "gemini-unknown" }, { costUsd: 0.5 }, { pricingContext: { contextTier: "long" } }])(
    "leaves non-metered, unknown, reported or long-context Gemini receipts untouched: %j", override => {
      const receipt: AdapterUsageCheckpoint = { ...base, provider: "google", biller: "google", model: "gemini-2.5-pro", ...override };
      expect(priceGeminiReceipt(receipt)).toBe(receipt);
    });

  it("prices newly carded Anthropic and OpenAI models", () => {
    expect(priceAnthropicReceipt({ ...base, provider: "anthropic", biller: "anthropic", model: "claude-opus-4-8" }).costUsdExact).toBe("30.500000000");
    expect(priceCodexReceipt({ ...base, provider: "openai", biller: "openai", model: "gpt-5-mini-low" }).pricingProvenance)
      .toMatchObject({ version: "openai-standard-2026-11-24" });
    expect(priceCodexReceipt({ ...base, provider: "openai", biller: "openai", model: "gpt-6-sol" }).pricingProvenance)
      .toMatchObject({ version: "openai-standard-2026-09-30" });
  });
});
