import React, { memo } from "react";
import { ChevronRight, DollarSign, Percent, Scale, TrendingUp } from "lucide-react";
import {
  SYSTEM_TOTALIZER_GRID_CLASS,
  SYSTEM_TOTALIZER_METRIC_CARD_CLASS,
  SystemTotalizerCard,
} from "@/src/components/ui/SystemTotalizerCard";
import { SummaryKpiGrid } from "@/src/components/ui/SummaryKpiGrid";
import { SalesOrderKpiSection } from "@/src/components/sales/SalesOrderKpiSection";
import { SALES_ORDER_MGMT_KPI_SECTIONS } from "@/src/lib/salesOrderManagementKpiLabels";
import {
  formatOrderCountLabel,
  metricVariantToTotalizerTone,
  resolveMarginCardShortSubtitle,
  resolveMarginMoneyVariant,
  resolveMarginPercentVariant,
  toFiniteMetricNumber,
} from "@/src/lib/salesOrderManagementMetricCards";
import {
  resolveSalesOrderMarginMoneyLabel,
  resolveSalesOrderMarginPercentLabel,
} from "@/src/lib/salesOrderMarginDisplay";
import { SalesOrderMarginInfoTooltip } from "@/src/components/sales/SalesOrderMarginInfoTooltip";
import type { SalesOrderManagementMarginEconomics } from "@/src/lib/salesOrderManagementTypes";
import { cn } from "@/src/lib/utils";

function DrillCardButton({
  testId,
  onClick,
  children,
}: {
  testId: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className={cn(
        "min-w-0 w-full text-left rounded-xl transition-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        "cursor-pointer hover:shadow-md"
      )}
    >
      {children}
    </button>
  );
}

export const SalesOrderManagementMarginOverview = memo(function SalesOrderManagementMarginOverview({
  marginEconomics,
  loading,
  onOpenEconomicsDetail,
}: {
  marginEconomics: SalesOrderManagementMarginEconomics | null;
  loading: boolean;
  onOpenEconomicsDetail: () => void;
}) {
  const consolidated = marginEconomics?.consolidated;
  if (!consolidated && !loading) return null;

  const marginPercent = toFiniteMetricNumber(consolidated?.marginPercent);
  const marginValue = toFiniteMetricNumber(consolidated?.marginValue);
  const totalCost = toFiniteMetricNumber(consolidated?.totalCost);
  const netRevenue = toFiniteMetricNumber(consolidated?.netRevenue);
  const ordersWithData = marginEconomics?.ordersWithMarginData ?? null;
  const marginSubtitle = resolveMarginCardShortSubtitle(consolidated);

  return (
    <SalesOrderKpiSection
      testId="sales-order-management-margin-overview"
      title={
        <span className="inline-flex items-center gap-2">
          {SALES_ORDER_MGMT_KPI_SECTIONS.margin.title}
          {consolidated ? (
            <SalesOrderMarginInfoTooltip
              summary={consolidated}
              testId="sales-order-management-margin-tooltip"
            />
          ) : null}
        </span>
      }
      subtitle={marginEconomics?.scopeNote ?? SALES_ORDER_MGMT_KPI_SECTIONS.margin.subtitle}
    >
      <SummaryKpiGrid minColumnWidth={168} className={SYSTEM_TOTALIZER_GRID_CLASS}>
        <DrillCardButton
          testId="sales-order-management-margin-percent-card"
          onClick={onOpenEconomicsDetail}
        >
          <SystemTotalizerCard
            className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
            label={resolveSalesOrderMarginPercentLabel(consolidated)}
            amount={marginPercent}
            amountFormat="percent"
            tone={metricVariantToTotalizerTone(resolveMarginPercentVariant(marginPercent))}
            icon={Percent}
            subtitle={marginSubtitle}
            helperText="Margem gerencial · clique para detalhar"
            loading={loading}
          />
        </DrillCardButton>
        <DrillCardButton
          testId="sales-order-management-margin-value-card"
          onClick={onOpenEconomicsDetail}
        >
          <SystemTotalizerCard
            className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
            label={resolveSalesOrderMarginMoneyLabel(consolidated)}
            amount={marginValue}
            amountFormat="currency"
            tone={metricVariantToTotalizerTone(resolveMarginMoneyVariant(marginValue))}
            icon={DollarSign}
            subtitle={marginSubtitle}
            labelAccessory={
              consolidated ? (
                <SalesOrderMarginInfoTooltip
                  summary={consolidated}
                  testId="sales-order-management-margin-value-tooltip"
                />
              ) : undefined
            }
            helperText="Margem gerencial consolidada"
            loading={loading}
          />
        </DrillCardButton>
        <SystemTotalizerCard
          className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
          label="Receita líquida"
          amount={netRevenue}
          amountFormat="currency"
          tone="money"
          icon={TrendingUp}
          helperText="Receita com custo usada na margem"
          loading={loading}
        />
        <SystemTotalizerCard
          className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
          label="Custo estimado"
          amount={totalCost}
          amountFormat="currency"
          tone="internal"
          icon={Scale}
          loading={loading}
        />
        <SystemTotalizerCard
          className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
          label="Pedidos c/ margem"
          value={loading ? undefined : formatOrderCountLabel(ordersWithData)}
          tone="neutral"
          icon={ChevronRight}
          helperText="Com cálculo no filtro atual"
          compact
          loading={loading}
        />
      </SummaryKpiGrid>
    </SalesOrderKpiSection>
  );
});
