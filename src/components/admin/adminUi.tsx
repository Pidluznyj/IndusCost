import React from "react";
import { ExecutiveSummarySection } from "@/src/components/ui/ExecutiveSummarySection";
import { MetricCard, type MetricCardVariant } from "@/src/components/ui/MetricCard";
import { SummaryKpiGrid } from "@/src/components/ui/SummaryKpiGrid";

/** Bloco executivo de KPI — padrão "Resumo geral dos centros filtrados". */
export function AdminKpiSection({
  title,
  eyebrow,
  children,
  testId,
  className,
  footer,
  actions,
  minColumnWidth = 200,
  embedded = false,
}: {
  title: string;
  eyebrow?: string;
  children: React.ReactNode;
  testId?: string;
  className?: string;
  footer?: React.ReactNode;
  actions?: React.ReactNode;
  minColumnWidth?: number;
  embedded?: boolean;
}) {
  return (
    <ExecutiveSummarySection
      title={title}
      eyebrow={eyebrow}
      testId={testId ?? "admin-kpi-summary"}
      className={className}
      footer={footer}
      actions={actions}
      embedded={embedded}
    >
      <SummaryKpiGrid
        minColumnWidth={minColumnWidth}
        testId={testId ? `${testId}-grid` : undefined}
      >
        {children}
      </SummaryKpiGrid>
    </ExecutiveSummarySection>
  );
}

export type AdminMetricItem = {
  label: string;
  value: string;
  subtitle?: string;
  variant?: MetricCardVariant;
  className?: string;
  loading?: boolean;
};

/** Grid responsivo de MetricCard compactos para painéis técnicos/admin. */
export function AdminMetricGrid({
  items,
  minColumnWidth = 168,
  testId,
}: {
  items: AdminMetricItem[];
  minColumnWidth?: number;
  testId?: string;
}) {
  return (
    <SummaryKpiGrid minColumnWidth={minColumnWidth} testId={testId}>
      {items.map((item) => (
        <MetricCard
          key={item.label}
          label={item.label}
          value={item.value}
          subtitle={item.subtitle}
          variant={item.variant ?? "neutral"}
          compact
          loading={item.loading}
          className={item.className}
        />
      ))}
    </SummaryKpiGrid>
  );
}
