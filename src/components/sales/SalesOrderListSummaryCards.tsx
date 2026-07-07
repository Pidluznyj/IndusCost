import React, { memo } from "react";
import { Package, Percent, Receipt, ShoppingBag, Ticket } from "lucide-react";
import { MetricCard } from "@/src/components/ui/MetricCard";
import { SummaryKpiGrid } from "@/src/components/ui/SummaryKpiGrid";
import { SalesOrderKpiSection } from "@/src/components/sales/SalesOrderKpiSection";
import { SalesOrderMarginInfoTooltip } from "@/src/components/sales/SalesOrderMarginInfoTooltip";
import { SALES_ORDER_LIST_KPI_SECTION } from "@/src/lib/salesOrderManagementKpiLabels";
import {
  formatSalesOrderMarginPercent,
} from "@/src/lib/salesOrderMarginDisplay";
import { formatCompactCurrency } from "@/src/lib/formatFinancialMetric";
import type { SalesOrderListSummary } from "@/src/lib/salesOrdersListSummary";
import type { SalesOrderListMarginSummary } from "@/src/lib/salesOrderListMarginSummary";
import { cn } from "@/src/lib/utils";

export const SalesOrderListSummaryCards = memo(function SalesOrderListSummaryCards({
  summary,
  marginSummary,
  showMarginCard = false,
  loading,
}: {
  summary: SalesOrderListSummary;
  marginSummary?: SalesOrderListMarginSummary | null;
  showMarginCard?: boolean;
  loading: boolean;
}) {
  const marginPartial = marginSummary?.marginCoverage === "PARTIAL";
  const marginUnavailable = !marginSummary?.available;
  const marginPercentLabel = marginUnavailable
    ? "Indisponível"
    : formatSalesOrderMarginPercent(marginSummary?.totalMarginPercentage);
  const marginMoneyLabel = marginUnavailable
    ? "—"
    : formatCompactCurrency(marginSummary?.totalMarginValue ?? null);

  return (
    <SalesOrderKpiSection
      testId="sales-order-list-overview"
      title={SALES_ORDER_LIST_KPI_SECTION.title}
      subtitle={SALES_ORDER_LIST_KPI_SECTION.subtitle}
    >
      <SummaryKpiGrid minColumnWidth={180}>
        <MetricCard
          label="Pedidos filtrados"
          amount={loading ? null : summary.totalOrders}
          amountFormat="number"
          variant="info"
          icon={<ShoppingBag className="h-4 w-4" />}
          helperText="Quantidade de pedidos que atendem aos filtros aplicados."
          loading={loading}
        />
        <MetricCard
          label="Valor vendido"
          amount={loading ? null : summary.totalNetAmount}
          amountFormat="currency"
          variant="money"
          icon={<Receipt className="h-4 w-4" />}
          helperText="Soma do valor líquido dos pedidos filtrados."
          loading={loading}
        />
        <MetricCard
          label="Itens"
          amount={loading ? null : summary.totalItems}
          amountFormat="number"
          variant="neutral"
          icon={<Package className="h-4 w-4" />}
          compact
          loading={loading}
        />
        <MetricCard
          label="Ticket médio"
          amount={loading || summary.totalOrders <= 0 ? null : summary.averageTicket}
          amountFormat="currency"
          variant="neutral"
          icon={<Ticket className="h-4 w-4" />}
          helperText="Valor líquido total ÷ quantidade de pedidos."
          compact
          loading={loading}
        />
        {showMarginCard ? (
          <div className="relative min-w-0" data-testid="sales-order-list-general-margin-card">
            <MetricCard
              label="Margem geral"
              formattedValue={loading ? undefined : marginPercentLabel}
              subtitle={loading ? undefined : marginMoneyLabel}
              variant={
                marginUnavailable ? "neutral" : marginPartial ? "warning" : "margin"
              }
              icon={<Percent className="h-4 w-4" />}
              helperText={
                marginUnavailable
                  ? "Sem custo suficiente para calcular."
                  : marginPartial
                    ? "Há itens sem custo resolvido."
                    : "Margem ponderada dos pedidos filtrados."
              }
              loading={loading}
              compact
            />
            {marginPartial && !loading && !marginUnavailable ? (
              <span
                className={cn(
                  "absolute top-2 right-10 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase",
                  "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200"
                )}
                data-testid="sales-order-list-general-margin-partial-badge"
              >
                Margem parcial
              </span>
            ) : null}
            {marginSummary?.tooltipSummary && !loading ? (
              <div className="absolute top-2 right-2">
                <SalesOrderMarginInfoTooltip
                  summary={marginSummary.tooltipSummary}
                  titleOverride="Margem geral ponderada"
                  testId="sales-order-list-general-margin-tooltip"
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </SummaryKpiGrid>
    </SalesOrderKpiSection>
  );
});
