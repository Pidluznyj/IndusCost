import React from "react";
import { DollarSign, Percent, Scale, TrendingUp, Wallet } from "lucide-react";
import { MetricCard } from "@/src/components/ui/MetricCard";
import { MetricCardGrid } from "@/src/components/ui/MetricCardGrid";
import {
  resolveMarginMoneyVariant,
  resolveMarginPercentVariant,
  toFiniteMetricNumber,
} from "@/src/lib/salesOrderManagementMetricCards";
import type { SalesOrderMarginSummaryPayload } from "@/src/lib/salesOrderMarginTypes";

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
  revenueLabel = "Valor vendido",
  testId,
}: SalesOrderMarginMetricGridProps) {
  return (
    <div data-testid={testId}>
      <MetricCardGrid>
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
        label="Margem R$"
        amount={toFiniteMetricNumber(summary?.marginValue)}
        amountFormat="currency"
        variant={resolveMarginMoneyVariant(summary?.marginValue)}
        icon={<DollarSign className="h-4 w-4" />}
        loading={loading}
      />
      <MetricCard
        label="Margem %"
        amount={toFiniteMetricNumber(summary?.marginPercent)}
        amountFormat="percent"
        variant={resolveMarginPercentVariant(summary?.marginPercent)}
        icon={<Percent className="h-4 w-4" />}
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
      </MetricCardGrid>
    </div>
  );
}
