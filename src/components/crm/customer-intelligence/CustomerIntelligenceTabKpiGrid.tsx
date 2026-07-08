import React from "react";
import { FinanceExecutiveTotalizerCard } from "@/src/components/finance/shared/FinanceExecutiveTotalizerCard";
import { SummaryKpiGrid } from "@/src/components/ui/SummaryKpiGrid";
import { SYSTEM_TOTALIZER_GRID_CLASS } from "@/src/components/ui/SystemTotalizerCard";

export type CustomerIntelligenceTabKpiItem = {
  label: string;
  value: string;
  hint?: string;
  tone?: "neutral" | "success" | "warning" | "danger" | "info" | "money";
};

export function CustomerIntelligenceTabKpiGrid({
  items,
  ariaLabel,
  minColumnWidth = 168,
}: {
  items: CustomerIntelligenceTabKpiItem[];
  ariaLabel: string;
  minColumnWidth?: number;
}) {
  return (
    <section aria-label={ariaLabel}>
      <SummaryKpiGrid
      minColumnWidth={minColumnWidth}
      className={SYSTEM_TOTALIZER_GRID_CLASS}
      testId="customer-intelligence-tab-kpi-grid"
    >
      {items.map((item) => (
        <FinanceExecutiveTotalizerCard
          key={item.label}
          label={item.label}
          value={item.value}
          valueTitle={item.value}
          subtitle={item.hint}
          tone={item.tone}
        />
      ))}
    </SummaryKpiGrid>
    </section>
  );
}
