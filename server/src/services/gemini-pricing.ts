import { centsToUsd, unitsToCents } from "@paperclipai/shared";
import type { AdapterUsageCheckpoint } from "@paperclipai/adapter-utils";
import { lookupRateCard, rateCardProvenance, rateCardUnits } from "./model-rate-cards.js";

/** Price complete, direct Gemini API receipts from the reviewed rate card.
 * Run totals cannot establish per-request prompt length, so the short-context
 * tier is assumed; context-cache storage hours are not included. */
export function priceGeminiReceipt(receipt: AdapterUsageCheckpoint): AdapterUsageCheckpoint {
  if (!receipt.complete || !receipt.usage || receipt.usageBasis !== "per_run"
    || receipt.provider !== "google" || receipt.biller !== "google"
    || !["api", "metered_api"].includes(receipt.billingType ?? "")
    || receipt.usageByModel?.length
    || receipt.costUsd != null || receipt.costUsdExact != null || receipt.cacheAdjustedCostUsd != null
    || (receipt.pricingContext?.serviceTier && !["standard", "default"].includes(receipt.pricingContext.serviceTier))
    || receipt.pricingContext?.contextTier === "long") return receipt;
  const card = lookupRateCard("google", receipt.model);
  const numerator = card && rateCardUnits(card.rates, receipt.usage);
  if (!card || numerator === undefined) return receipt;
  return { ...receipt, costUsdExact: centsToUsd(unitsToCents((numerator + 500_000n) / 1_000_000n)), costStatus: "estimated",
    pricingProvenance: { ...rateCardProvenance(card, "standard paid-tier pricing assumed; short per-request context assumed; cache storage excluded; not an invoice"),
      serviceTier: "standard", contextTier: "short" },
  };
}
