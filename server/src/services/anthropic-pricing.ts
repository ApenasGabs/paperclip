import { centsToUsd, unitsToCents } from "@paperclipai/shared";
import type { AdapterUsageCheckpoint } from "@paperclipai/adapter-utils";
import { lookupRateCard, rateCardProvenance, rateCardUnits } from "./model-rate-cards.js";

// Direct Anthropic API list prices: see model-rate-cards.ts.
// Only reviewed models and aliases are priced; other billers stay unknown.

/** A complete token receipt can receive an explicit estimate, never an invoice
 * claim. ACP aggregates cache writes without TTL; conservatively price them at
 * the documented one-hour rate rather than silently assume five-minute writes. */
export function priceAnthropicReceipt(receipt: AdapterUsageCheckpoint): AdapterUsageCheckpoint {
  if (!receipt.complete || !receipt.usage || receipt.usageBasis !== "per_run"
    || receipt.provider !== "anthropic" || receipt.biller !== "anthropic"
    || !["api", "metered_api"].includes(receipt.billingType ?? "")
    || receipt.usageByModel?.length
    || receipt.costUsd != null || receipt.costUsdExact != null || receipt.cacheAdjustedCostUsd != null
    || (receipt.pricingContext?.serviceTier && !["standard", "default"].includes(receipt.pricingContext.serviceTier))) return receipt;
  const card = lookupRateCard("anthropic", receipt.model);
  const usage = receipt.usage;
  if (!card || usage.cacheWriteTokens === undefined || usage.cachedInputTokens === undefined) return receipt;
  const numerator = rateCardUnits(card.rates, usage);
  if (numerator === undefined) return receipt;
  return { ...receipt, costUsdExact: centsToUsd(unitsToCents((numerator + 500_000n) / 1_000_000n)), costStatus: "estimated",
    pricingProvenance: { ...rateCardProvenance(card, "standard global API pricing assumed; cache-write TTL unavailable, one-hour upper rate used; not an invoice"),
      serviceTier: "standard" },
  };
}
