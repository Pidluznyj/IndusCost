import React from "react";
import type { CustomerIntelligenceReport } from "@/src/lib/customerIntelligenceTypes";
import { buildCustomerIntelligenceKpiItems } from "@/src/lib/customerIntelligenceKpiItems";
import { ExecutiveSummarySection } from "@/src/components/ui/ExecutiveSummarySection";
import { SummaryKpiGrid } from "@/src/components/ui/SummaryKpiGrid";
import { FinanceExecutiveTotalizerCard } from "@/src/components/finance/shared/FinanceExecutiveTotalizerCard";
import { SYSTEM_TOTALIZER_GRID_CLASS } from "@/src/components/ui/SystemTotalizerCard";

export { buildCustomerIntelligenceKpiItems } from "@/src/lib/customerIntelligenceKpiItems";

function resolveCustomerIntelligenceKpiTone(
  label: string
): "neutral" | "success" | "warning" | "danger" | "info" | "money" | "margin" {
  const normalized = label.toLowerCase();
  if (normalized.includes("vencido") || normalized.includes("alto risco")) return "danger";
  if (
    normalized.includes("receita") ||
    normalized.includes("carteira") ||
    normalized.includes("ticket")
  ) {
    return "money";
  }
  if (normalized.includes("margem")) return "margin";
  if (normalized.includes("status financeiro")) return "info";
  return "neutral";
}

export function CustomerIntelligenceKpiGrid({ report }: { report: CustomerIntelligenceReport }) {
  const items = buildCustomerIntelligenceKpiItems(report);

  return (
    <ExecutiveSummarySection
      title="Resumo comercial do cliente"
      eyebrow="Indicadores principais no filtro aplicado"
      testId="customer-intelligence-kpi-summary"
    >
      <SummaryKpiGrid
        minColumnWidth={220}
        testId="customer-intelligence-kpi-grid"
        className={SYSTEM_TOTALIZER_GRID_CLASS}
      >
        {items.map((item) => (
          <FinanceExecutiveTotalizerCard
            key={item.label}
            label={item.label}
            value={item.value}
            valueTitle={item.valueTitle}
            helperText={item.hint}
            tone={resolveCustomerIntelligenceKpiTone(item.label)}
          />
        ))}
      </SummaryKpiGrid>
    </ExecutiveSummarySection>
  );
}
