import React from "react";
import { FinanceExecutiveTotalizerCard } from "@/src/components/finance/shared/FinanceExecutiveTotalizerCard";
import { SummaryKpiGrid } from "@/src/components/ui/SummaryKpiGrid";
import { SYSTEM_TOTALIZER_GRID_CLASS } from "@/src/components/ui/SystemTotalizerCard";

export type ExecutiveDashboardSummaryCard = {
  id?: string;
  label: string;
  formatted: string;
  compactFormatted?: string | null;
  hint?: string | null;
};

export function ExecutiveDashboardSummaryKpiGrid({
  cards,
  minColumnWidth = 168,
  testId,
}: {
  cards: ExecutiveDashboardSummaryCard[];
  minColumnWidth?: number;
  testId?: string;
}) {
  return (
    <SummaryKpiGrid
      minColumnWidth={minColumnWidth}
      className={SYSTEM_TOTALIZER_GRID_CLASS}
      testId={testId}
    >
      {cards.map((card) => (
        <FinanceExecutiveTotalizerCard
          key={card.id ?? card.label}
          label={card.label}
          value={card.compactFormatted ?? card.formatted}
          valueTitle={card.formatted}
          subtitle={card.hint ?? undefined}
        />
      ))}
    </SummaryKpiGrid>
  );
}
