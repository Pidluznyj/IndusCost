import React, { memo } from "react";
import { Package, Percent, Receipt, ShoppingBag, Ticket } from "lucide-react";
import { MetricCard } from "@/src/components/ui/MetricCard";
import { SummaryKpiGrid } from "@/src/components/ui/SummaryKpiGrid";
import { SalesOrderKpiSection } from "@/src/components/sales/SalesOrderKpiSection";
import { SalesOrderMarginInfoTooltip } from "@/src/components/sales/SalesOrderMarginInfoTooltip";
import { SALES_ORDER_LIST_KPI_SECTION } from "@/src/lib/salesOrderManagementKpiLabels";
import { formatSalesOrderMarginPercent } from "@/src/lib/salesOrderMarginDisplay";
import { formatCompactCurrency } from "@/src/lib/formatFinancialMetric";
import type { SalesOrderListSummary } from "@/src/lib/salesOrdersListSummary";
import type { SalesOrderListMarginSummary } from "@/src/lib/salesOrderListMarginSummary";
import "./sales-order-list-summary-cards.css";

const METRIC_CARD_CLASS = "sales-order-list-summary-metric-card";

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
      <SummaryKpiGrid minColumnWidth={168} className="sales-order-list-summary-grid">
        <MetricCard
          className={METRIC_CARD_CLASS}
          label="Pedidos filtrados"
          amount={loading ? null : summary.totalOrders}
          amountFormat="number"
          variant="info"
          icon={<ShoppingBag className="h-3.5 w-3.5" />}
          helperText="Quantidade de pedidos que atendem aos filtros aplicados."
          loading={loading}
        />
        <MetricCard
          className={METRIC_CARD_CLASS}
          label="Valor vendido"
          amount={loading ? null : summary.totalNetAmount}
          amountFormat="currency"
          variant="money"
          icon={<Receipt className="h-3.5 w-3.5" />}
          helperText="Soma do valor líquido dos pedidos filtrados."
          loading={loading}
        />
        <MetricCard
          className={METRIC_CARD_CLASS}
          label="Itens"
          amount={loading ? null : summary.totalItems}
          amountFormat="number"
          variant="neutral"
          icon={<Package className="h-3.5 w-3.5" />}
          helperText="Quantidade de itens nos pedidos filtrados."
          loading={loading}
        />
        <MetricCard
          className={METRIC_CARD_CLASS}
          label="Ticket médio"
          amount={loading || summary.totalOrders <= 0 ? null : summary.averageTicket}
          amountFormat="currency"
          variant="neutral"
          icon={<Ticket className="h-3.5 w-3.5" />}
          helperText="Valor líquido total ÷ quantidade de pedidos."
          loading={loading}
        />
        {showMarginCard ? (
          <div data-testid="sales-order-list-general-margin-card" className="min-w-0">
            <MetricCard
              className={METRIC_CARD_CLASS}
              label="Margem geral"
            formattedValue={loading ? undefined : marginPercentLabel}
            subtitle={loading ? undefined : marginMoneyLabel}
            variant={marginUnavailable ? "neutral" : marginPartial ? "warning" : "margin"}
            icon={<Percent className="h-3.5 w-3.5" />}
            helperText={
              marginUnavailable
                ? "Sem custo suficiente para calcular."
                : marginPartial
                  ? "Há itens sem custo resolvido."
                  : "Margem ponderada dos pedidos filtrados."
            }
            labelAccessory={
              marginSummary?.tooltipSummary && !loading ? (
                <SalesOrderMarginInfoTooltip
                  summary={marginSummary.tooltipSummary}
                  titleOverride="Margem geral ponderada"
                  testId="sales-order-list-general-margin-tooltip"
                />
              ) : undefined
            }
            footer={
              marginPartial && !loading && !marginUnavailable ? (
                <span
                  className="sales-order-list-summary-margin-badge"
                  data-testid="sales-order-list-general-margin-partial-badge"
                >
                  Margem parcial
                </span>
              ) : undefined
            }
            loading={loading}
            />
          </div>
        ) : null}
      </SummaryKpiGrid>
    </SalesOrderKpiSection>
  );
});
