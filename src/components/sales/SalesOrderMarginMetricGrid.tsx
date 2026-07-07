import React from "react";
import { DollarSign, Percent, Scale, TrendingUp, Wallet } from "lucide-react";
import { MetricCard } from "@/src/components/ui/MetricCard";
import { SummaryKpiGrid } from "@/src/components/ui/SummaryKpiGrid";
import {
  resolveMarginMoneyVariant,
  resolveMarginPercentVariant,
  toFiniteMetricNumber,
} from "@/src/lib/salesOrderManagementMetricCards";
import type { SalesOrderMarginSummaryPayload } from "@/src/lib/salesOrderMarginTypes";
import {
  buildSalesOrderMarginCoverageHint,
  resolveSalesOrderMarginMoneyLabel,
  resolveSalesOrderMarginPercentLabel,
} from "@/src/lib/salesOrderMarginDisplay";

type SalesOrderMarginMetricGridProps = {
  summary?: SalesOrderMarginSummaryPayload | null;
  loading?: boolean;
  showMarkup?: boolean;
  revenueLabel?: string;
  testId?: string;
};

/**
 * Grid de margem econômica — Design System MetricCard (sem cálculo no frontend).
 */
export function SalesOrderMarginMetricGrid({
  summary,
  loading = false,
  showMarkup = true,
  revenueLabel = "Receita com custo",
  testId,
}: SalesOrderMarginMetricGridProps) {
  const coverageHint =
    summary != null
      ? buildSalesOrderMarginCoverageHint(summary, (value) =>
          value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
        )
      : undefined;

  return (
    <div data-testid={testId}>
      <SummaryKpiGrid>
      <MetricCard
        label={revenueLabel}
        amount={toFiniteMetricNumber(summary?.netRevenue)}
        amountFormat="currency"
        variant="info"
        icon={<Wallet className="h-4 w-4" />}
        loading={loading}
      />
      <MetricCard
        label="Custo estimado"
        amount={toFiniteMetricNumber(summary?.totalCost)}
        amountFormat="currency"
        variant="neutral"
        icon={<Scale className="h-4 w-4" />}
        loading={loading}
      />
      <MetricCard
        label={resolveSalesOrderMarginMoneyLabel(summary)}
        amount={toFiniteMetricNumber(summary?.marginValue)}
        amountFormat="currency"
        variant={resolveMarginMoneyVariant(summary?.marginValue)}
        icon={<DollarSign className="h-4 w-4" />}
        helperText={coverageHint}
        loading={loading}
      />
      <MetricCard
        label={resolveSalesOrderMarginPercentLabel(summary)}
        amount={toFiniteMetricNumber(summary?.marginPercent)}
        amountFormat="percent"
        variant={resolveMarginPercentVariant(summary?.marginPercent)}
        icon={<Percent className="h-4 w-4" />}
        helperText={coverageHint ?? "Ponderada por receita com custo"}
        loading={loading}
      />
      {showMarkup ? (
        <MetricCard
          label="Markup"
          formattedValue={
            summary?.markup != null && Number.isFinite(summary.markup) && summary.markup > 0
              ? `${Number(summary.markup).toFixed(2)}x`
              : "—"
          }
          variant="neutral"
          icon={<TrendingUp className="h-4 w-4" />}
          loading={loading}
        />
      ) : null}
      </SummaryKpiGrid>
    </div>
  );
}
