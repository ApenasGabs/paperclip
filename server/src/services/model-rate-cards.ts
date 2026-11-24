import { centsToUsd, unitsToCents, usdToUnits } from "@paperclipai/shared";
import type { AdapterUsageCheckpoint } from "@paperclipai/adapter-utils";

/** USD per 1M tokens: uncached input, cached input read, cache write, output (incl. thinking). */
export type TokenRates = readonly [string, string, string, string];
export type RateCardProvider = "anthropic" | "google" | "openai";
export type RateCard = { provider: RateCardProvider; model: string; version: string; evidence: string; rates: TokenRates };

const ANTHROPIC = { version: "anthropic-standard-2026-11-24", evidence: "https://platform.claude.com/docs/en/about-claude/pricing" };
const GOOGLE = { version: "google-standard-2026-11-24", evidence: "https://ai.google.dev/gemini-api/docs/pricing" };
const OPENAI = { version: "openai-standard-2026-11-24", evidence: "https://developers.openai.com/api/docs/pricing" };

// Immutable, reviewed rate cards. A changed price gets a new version so
// existing receipts keep the rates they were priced with.
// Anthropic cache writes use the one-hour rate (2x input): ACP aggregates
// writes without TTL. Gemini and OpenAI bill cache writes as regular input.
const CARDS: Record<RateCardProvider, Record<string, { version: string; evidence: string; rates: TokenRates }>> = {
  anthropic: {
    "claude-sonnet-5": { version: "anthropic-standard-2026-10-07", evidence: ANTHROPIC.evidence, rates: ["2", "0.2", "4", "10"] },
    "claude-fable-5-2": { ...ANTHROPIC, rates: ["8", "0.8", "16", "40"] },
    "claude-opus-5-5": { ...ANTHROPIC, rates: ["4", "0.2", "8", "20"] },
    "claude-opus-4-8": { ...ANTHROPIC, rates: ["5", "0.5", "10", "25"] },
    // Published cached-read range is $0.10-$0.20; use the upper bound.
    "claude-sonnet-5-5": { ...ANTHROPIC, rates: ["2", "0.2", "4", "10"] },
    "claude-sonnet-4-6": { ...ANTHROPIC, rates: ["3", "0.3", "6", "15"] },
    "claude-haiku-5-5": { ...ANTHROPIC, rates: ["0.1", "0.01", "0.2", "0.5"] },
    "claude-haiku-4-5": { ...ANTHROPIC, rates: ["1", "0.1", "2", "5"] },
  },
  google: {
    "gemini-4-argon": { ...GOOGLE, rates: ["2", "0.1", "2", "10"] },
    "gemini-4-neon": { ...GOOGLE, rates: ["3", "0.15", "3", "15"] },
    "gemini-4-hydrogen": { ...GOOGLE, rates: ["1.5", "0.075", "1.5", "7.5"] },
    "gemini-3.8-flash": { ...GOOGLE, rates: ["0.75", "0.075", "0.75", "3.75"] },
    "gemini-2.5-pro": { ...GOOGLE, rates: ["1.25", "0.125", "1.25", "10"] },
    "gemini-2.5-flash": { ...GOOGLE, rates: ["0.3", "0.03", "0.3", "2.5"] },
  },
  openai: {
    "gpt-6-astra": { version: "openai-standard-2026-09-30", evidence: OPENAI.evidence, rates: ["10", "1", "12.5", "50"] },
    "gpt-6-sol": { version: "openai-standard-2026-09-30", evidence: OPENAI.evidence, rates: ["2", "0.2", "2.5", "10"] },
    "gpt-6.1-sol": { version: "openai-standard-2026-09-30", evidence: OPENAI.evidence, rates: ["2", "0.1", "2.5", "10"] },
    "gpt-6-luna": { version: "openai-standard-2026-09-30", evidence: OPENAI.evidence, rates: ["0.1", "0.01", "0.125", "0.5"] },
    "gpt-5.6-sol": { version: "openai-standard-2026-09-30", evidence: OPENAI.evidence, rates: ["4", "0.4", "5", "20"] },
    "gpt-5": { ...OPENAI, rates: ["1.25", "0.125", "1.25", "10"] },
    "gpt-5-mini": { ...OPENAI, rates: ["0.25", "0.025", "0.25", "2"] },
    "gpt-5-nano": { ...OPENAI, rates: ["0.05", "0.005", "0.05", "0.4"] },
    "o3": { ...OPENAI, rates: ["2", "0.5", "2", "8"] },
    "o4-mini": { ...OPENAI, rates: ["1.1", "0.275", "1.1", "4.4"] },
  },
};
const ALIASES: Record<string, string> = { opus: "claude-opus-5-5" };

/** Reduce a reported model id to its rate-card key: drop routing prefixes
 * ("models/", "anthropic/"), dated snapshots and reasoning-effort suffixes.
 * Unknown ids stay unknown; there is deliberately no prefix matching. */
export function normalizePricingModel(model: string | null | undefined) {
  let id = (model ?? "").trim().toLowerCase();
  id = id.slice(id.lastIndexOf("/") + 1);
  id = id.replace(/-(?:xhigh|high|medium|low|minimal)$/, "").replace(/-\d{8}$/, "");
  return Object.hasOwn(ALIASES, id) ? ALIASES[id] : id;
}

export function lookupRateCard(provider: string | null | undefined, model: string | null | undefined): RateCard | undefined {
  if (provider !== "anthropic" && provider !== "google" && provider !== "openai") return undefined;
  const key = normalizePricingModel(model);
  const card = Object.hasOwn(CARDS[provider], key) ? CARDS[provider][key] : undefined;
  return card && { provider, model: key, ...card };
}

/** Exact token cost in billing units, or undefined for impossible counters. */
export function rateCardUnits(rates: TokenRates, usage: NonNullable<AdapterUsageCheckpoint["usage"]>) {
  const counts = [usage.inputTokens - (usage.cacheWriteTokens ?? 0), usage.cachedInputTokens ?? 0, usage.cacheWriteTokens ?? 0, usage.outputTokens];
  if (counts.some(count => !Number.isSafeInteger(count) || count < 0)) return undefined;
  return counts.reduce((total, count, index) => total + BigInt(count) * usdToUnits(rates[index]), 0n);
}

export function rateCardProvenance(card: RateCard, evidence: string) {
  const [input, cached, cacheWrite, output] = card.rates.map(rate => unitsToCents(usdToUnits(rate)));
  return { source: "rate_card" as const, version: card.version, evidence: `${card.evidence}; ${evidence}`,
    inputCentsPerMillion: input, cachedInputCentsPerMillion: cached, cacheWriteCentsPerMillion: cacheWrite, outputCentsPerMillion: output };
}

/** API-equivalent list price of a usage receipt, regardless of how it was
 * actually billed. Used to show what subscription-included work would have
 * cost on metered API; never written to the billed ledger. */
export function estimateApiCostUsd(input: { provider?: string | null; model?: string | null; usage?: AdapterUsageCheckpoint["usage"] }) {
  const card = lookupRateCard(input.provider, input.model);
  const units = card && input.usage ? rateCardUnits(card.rates, input.usage) : undefined;
  return units === undefined ? undefined : centsToUsd(unitsToCents((units + 500_000n) / 1_000_000n));
}
