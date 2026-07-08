import React from "react";
import { cn } from "@/src/lib/utils";
import {
  MATERIAL_MARKET_CRITICALITY_LABELS,
  materialMarketCriticalityBadgeClass,
  type MaterialMarketCriticality,
} from "@/src/lib/materialMarketMonitoring";

type Props = {
  isMarketMonitored?: boolean | null;
  marketCriticality?: MaterialMarketCriticality | string | null;
  compact?: boolean;
};

export function MaterialMarketMonitoringBadge({
  isMarketMonitored,
  marketCriticality,
  compact = false,
}: Props) {
  if (!isMarketMonitored) {
    return (
      <span
        className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
        data-testid="material-market-monitoring-off"
      >
        {compact ? "—" : "Não monitorada"}
      </span>
    );
  }

  const criticality =
    marketCriticality && marketCriticality in MATERIAL_MARKET_CRITICALITY_LABELS
      ? (marketCriticality as MaterialMarketCriticality)
      : "MEDIUM";

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
        materialMarketCriticalityBadgeClass(criticality)
      )}
      data-testid="material-market-monitoring-badge"
      title="Monitorada pela Inteligência de Mercado"
    >
      {MATERIAL_MARKET_CRITICALITY_LABELS[criticality]}
    </span>
  );
}
