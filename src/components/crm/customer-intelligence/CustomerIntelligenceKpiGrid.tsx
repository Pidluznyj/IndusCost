import React from "react";
import type { CustomerIntelligenceReport } from "@/src/lib/customerIntelligenceTypes";
import { buildCustomerIntelligenceKpiItems } from "@/src/lib/customerIntelligenceKpiItems";
import { ExecutiveSummarySection } from "@/src/components/ui/ExecutiveSummarySection";
import { MetricCard, type MetricCardVariant } from "@/src/components/ui/MetricCard";
import { SummaryKpiGrid } from "@/src/components/ui/SummaryKpiGrid";

export { buildCustomerIntelligenceKpiItems } from "@/src/lib/customerIntelligenceKpiItems";

function resolveCustomerIntelligenceKpiVariant(label: string): MetricCardVariant {
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
      <SummaryKpiGrid minColumnWidth={220} testId="customer-intelligence-kpi-grid">
        {items.map((item) => (
          <MetricCard
            key={item.label}
            label={item.label}
            formattedValue={item.value}
            fullValue={item.valueTitle}
            helperText={item.hint}
            variant={resolveCustomerIntelligenceKpiVariant(item.label)}
          />
        ))}
      </SummaryKpiGrid>
    </ExecutiveSummarySection>
  );
}
