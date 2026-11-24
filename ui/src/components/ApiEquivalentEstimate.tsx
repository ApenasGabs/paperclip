import type { ApiEquivalentCostEstimate } from "@paperclipai/shared";
import { cn, formatCents } from "../lib/utils";

export const API_EQUIVALENT_ESTIMATE_HINT = "Estimated API list price of subscription-included usage, from published per-1M-token rates. Not billed; excluded from spend and budgets.";

/** What this group's subscription-included usage would cost on metered API.
 * Always shown apart from billed spend; never add it to costCents. */
export function ApiEquivalentEstimate({
  estimatedApiCostCents,
  estimatedApiCostUnpricedEventCount,
  className,
}: ApiEquivalentCostEstimate & { className?: string }) {
  const unpriced = estimatedApiCostUnpricedEventCount ?? 0;
  if (!estimatedApiCostCents && !unpriced) return null;
  return (
    <div className={cn("whitespace-nowrap text-xs text-muted-foreground", className)} title={API_EQUIVALENT_ESTIMATE_HINT}>
      ≈ <span className="font-mono tabular-nums">{formatCents(estimatedApiCostCents ?? 0)}</span> API equivalent (est.)
      {unpriced > 0 ? ` · ${unpriced} without rate` : null}
    </div>
  );
}
