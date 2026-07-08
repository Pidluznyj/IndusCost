import React from "react";
import { ExecutiveSummarySection } from "@/src/components/ui/ExecutiveSummarySection";
import { SummaryKpiGrid } from "@/src/components/ui/SummaryKpiGrid";
import {
  SYSTEM_TOTALIZER_GRID_CLASS,
  SYSTEM_TOTALIZER_GRID_SECONDARY_CLASS,
  SYSTEM_TOTALIZER_METRIC_CARD_CLASS,
  SystemTotalizerCard,
  type SystemTotalizerTone,
} from "@/src/components/ui/SystemTotalizerCard";
import type { MetricCardVariant } from "@/src/components/ui/MetricCard";
import { cn } from "@/src/lib/utils";
import "./nomus-sync-metric-cards.css";

export const NOMUS_SYNC_METRIC_GRID_CLASS = "nomus-sync-metric-grid";
export const NOMUS_SYNC_METRIC_GRID_SECONDARY_CLASS = "nomus-sync-metric-grid--secondary";

/** Bloco executivo de KPI — padrão Cards Totalizadores Executivos. */
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
        className={cn(
          SYSTEM_TOTALIZER_GRID_CLASS,
          nomusSyncMetrics && NOMUS_SYNC_METRIC_GRID_CLASS
        )}
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

/** Grid responsivo de cards executivos para painéis técnicos/admin. */
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
  const toneFromVariant = (variant?: MetricCardVariant): SystemTotalizerTone => {
    if (!variant || variant === "default") return "neutral";
    return variant as SystemTotalizerTone;
  };

  return (
    <SummaryKpiGrid
      minColumnWidth={minColumnWidth}
      testId={testId}
      className={cn(
        SYSTEM_TOTALIZER_GRID_CLASS,
        nomusSyncMetrics && NOMUS_SYNC_METRIC_GRID_CLASS,
        secondary && SYSTEM_TOTALIZER_GRID_SECONDARY_CLASS,
        secondary && nomusSyncMetrics && NOMUS_SYNC_METRIC_GRID_SECONDARY_CLASS
      )}
    >
      {items.map((item) => (
        <SystemTotalizerCard
          key={item.label}
          label={item.label}
          value={item.value}
          subtitle={item.subtitle}
          tone={toneFromVariant(item.variant)}
          loading={item.loading}
          valueWrap={item.valueWrap}
          compact
          className={cn(SYSTEM_TOTALIZER_METRIC_CARD_CLASS, item.className)}
        />
      ))}
    </SummaryKpiGrid>
  );
}
