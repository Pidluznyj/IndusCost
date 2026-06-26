import React, { memo } from "react";
import { ChevronRight, DollarSign, Percent, Scale, TrendingUp } from "lucide-react";
import { MetricCard } from "@/src/components/ui/MetricCard";
import { MetricCardGrid } from "@/src/components/ui/MetricCardGrid";
import { SalesOrderKpiSection } from "@/src/components/sales/SalesOrderKpiSection";
import { SALES_ORDER_MGMT_KPI_SECTIONS } from "@/src/lib/salesOrderManagementKpiLabels";
import {
  formatOrderCountLabel,
  resolveMarginMoneyVariant,
  resolveMarginPercentVariant,
  toFiniteMetricNumber,
} from "@/src/lib/salesOrderManagementMetricCards";
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

  return (
    <SalesOrderKpiSection
      testId="sales-order-management-margin-overview"
      title={SALES_ORDER_MGMT_KPI_SECTIONS.margin.title}
      subtitle={SALES_ORDER_MGMT_KPI_SECTIONS.margin.subtitle}
    >
      <MetricCardGrid minColumnWidth={200}>
        <DrillCardButton
          testId="sales-order-management-margin-percent-card"
          onClick={onOpenEconomicsDetail}
        >
          <MetricCard
            label="Margem %"
            amount={marginPercent}
            amountFormat="percent"
            variant={resolveMarginPercentVariant(marginPercent)}
            icon={<Percent className="h-4 w-4" />}
            helperText="Ponderada por receita · clique para detalhar"
            loading={loading}
            className="h-full"
          />
        </DrillCardButton>
        <DrillCardButton
          testId="sales-order-management-margin-value-card"
          onClick={onOpenEconomicsDetail}
        >
          <MetricCard
            label="Margem R$"
            amount={marginValue}
            amountFormat="currency"
            variant={resolveMarginMoneyVariant(marginValue)}
            icon={<DollarSign className="h-4 w-4" />}
            helperText="Receita líquida − custo estimado"
            loading={loading}
            className="h-full"
          />
        </DrillCardButton>
        <MetricCard
          label="Receita líquida"
          amount={netRevenue}
          amountFormat="currency"
          variant="money"
          icon={<TrendingUp className="h-4 w-4" />}
          helperText="Base da margem consolidada"
          loading={loading}
        />
        <MetricCard
          label="Custo estimado"
          amount={totalCost}
          amountFormat="currency"
          variant="internal"
          icon={<Scale className="h-4 w-4" />}
          loading={loading}
        />
        <MetricCard
          label="Pedidos c/ margem"
          formattedValue={loading ? undefined : formatOrderCountLabel(ordersWithData)}
          variant="neutral"
          icon={<ChevronRight className="h-4 w-4" />}
          helperText="Com cálculo no filtro atual"
          compact
          loading={loading}
        />
      </MetricCardGrid>
    </SalesOrderKpiSection>
  );
});
