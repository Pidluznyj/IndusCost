import React from "react";
import { ExecutiveSummarySection } from "@/src/components/ui/ExecutiveSummarySection";
import { MetricCard, type MetricCardVariant } from "@/src/components/ui/MetricCard";
import { SummaryKpiGrid } from "@/src/components/ui/SummaryKpiGrid";
import { cn } from "@/src/lib/utils";
import "./nomus-sync-metric-cards.css";

export const NOMUS_SYNC_METRIC_GRID_CLASS = "nomus-sync-metric-grid";
export const NOMUS_SYNC_METRIC_GRID_SECONDARY_CLASS = "nomus-sync-metric-grid--secondary";

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
  nomusSyncMetrics = false,
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
  /** Aplica tipografia executiva suave (Logs de Sincronização Nomus). */
  nomusSyncMetrics?: boolean;
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
        className={nomusSyncMetrics ? NOMUS_SYNC_METRIC_GRID_CLASS : undefined}
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
  valueWrap?: boolean;
};

/** Grid responsivo de MetricCard compactos para painéis técnicos/admin. */
export function AdminMetricGrid({
  items,
  minColumnWidth = 168,
  testId,
  nomusSyncMetrics = false,
  secondary = false,
}: {
  items: AdminMetricItem[];
  minColumnWidth?: number;
  testId?: string;
  nomusSyncMetrics?: boolean;
  /** Contadores e detalhes com menor destaque visual. */
  secondary?: boolean;
}) {
  return (
    <SummaryKpiGrid
      minColumnWidth={minColumnWidth}
      testId={testId}
      className={cn(
        nomusSyncMetrics && NOMUS_SYNC_METRIC_GRID_CLASS,
        nomusSyncMetrics && secondary && NOMUS_SYNC_METRIC_GRID_SECONDARY_CLASS
      )}
    >
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
          valueWrap={item.valueWrap}
        />
      ))}
    </SummaryKpiGrid>
  );
}
