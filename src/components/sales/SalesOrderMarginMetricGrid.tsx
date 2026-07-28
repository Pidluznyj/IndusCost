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
  SALES_ORDER_MARGIN_DISPLAY_LABELS,
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
 * Métrica principal: margem comercial do Pedido; gerencial fica secundária.
 */
export function SalesOrderMarginMetricGrid({
  summary,
  loading = false,
  showMarkup = true,
  revenueLabel = "Valor vendido",
  testId,
}: SalesOrderMarginMetricGridProps) {
  const commercial = summary?.commercialMargin;
  const commercialAvailable =
    commercial != null &&
    commercial.commercialMarginTotalPercent != null &&
    commercial.itemsCalculated > 0;
  const commercialPartial = commercialAvailable && !commercial.isComplete;

  const coverageHint =
    commercialAvailable && commercial
      ? commercialPartial
        ? `Margem comercial parcial: ${commercial.itemsCalculated} de ${commercial.itemsActive} itens calculados. Cobertura de ${commercial.commercialMarginCoveragePercent ?? "—"}% do valor vendido. ${commercial.itemsUnavailable} item(ns) com margem não calculada.`
        : "Margem calculada sobre o preço efetivamente vendido, com formação de preço histórica."
      : summary != null
        ? buildSalesOrderMarginCoverageHint(summary, (value) =>
            value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
          )
        : undefined;

  const moneyLabel = commercialAvailable
    ? commercialPartial
      ? "Margem comercial parcial (R$)"
      : SALES_ORDER_MARGIN_DISPLAY_LABELS.commercialTitle + " (R$)"
    : resolveSalesOrderMarginMoneyLabel(summary);
  const percentLabel = commercialAvailable
    ? commercialPartial
      ? "Margem comercial parcial (%)"
      : SALES_ORDER_MARGIN_DISPLAY_LABELS.commercialTitle + " (%)"
    : resolveSalesOrderMarginPercentLabel(summary);

  const marginValue = commercialAvailable
    ? commercial.commercialMarginTotalValue
    : summary?.marginValue;
  const marginPercent = commercialAvailable
    ? commercial.commercialMarginTotalPercent
    : summary?.marginPercent;
  const soldValue = commercialAvailable
    ? commercial.commercialSoldTotalValue
    : summary?.netRevenue;

  return (
    <div data-testid={testId}>
      <SummaryKpiGrid>
      <MetricCard
        label={revenueLabel}
        amount={toFiniteMetricNumber(soldValue)}
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
        label={moneyLabel}
        amount={toFiniteMetricNumber(marginValue)}
        amountFormat="currency"
        variant={resolveMarginMoneyVariant(marginValue)}
        icon={<DollarSign className="h-4 w-4" />}
        helperText={coverageHint}
        loading={loading}
      />
      <MetricCard
        label={percentLabel}
        amount={toFiniteMetricNumber(marginPercent)}
        amountFormat="percent"
        variant={resolveMarginPercentVariant(marginPercent)}
        icon={<Percent className="h-4 w-4" />}
        helperText={
          coverageHint ??
          (commercialAvailable
            ? "Ponderada pelo valor efetivamente vendido"
            : "Ponderada por receita com custo")
        }
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
          helperText={
            summary?.marginPercent != null
              ? `${SALES_ORDER_MARGIN_DISPLAY_LABELS.managerialTitle}: ${Number(summary.marginPercent).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`
              : undefined
          }
          loading={loading}
        />
      ) : null}
      </SummaryKpiGrid>
    </div>
  );
}
