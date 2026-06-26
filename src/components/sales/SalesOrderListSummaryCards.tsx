import React, { memo } from "react";
import { Package, Receipt, ShoppingBag, Ticket } from "lucide-react";
import { MetricCard } from "@/src/components/ui/MetricCard";
import { MetricCardGrid } from "@/src/components/ui/MetricCardGrid";
import { SalesOrderKpiSection } from "@/src/components/sales/SalesOrderKpiSection";
import { SALES_ORDER_LIST_KPI_SECTION } from "@/src/lib/salesOrderManagementKpiLabels";
import type { SalesOrderListSummary } from "@/src/lib/salesOrdersListSummary";

export const SalesOrderListSummaryCards = memo(function SalesOrderListSummaryCards({
  summary,
  loading,
}: {
  summary: SalesOrderListSummary;
  loading: boolean;
}) {
  return (
    <SalesOrderKpiSection
      testId="sales-order-list-overview"
      title={SALES_ORDER_LIST_KPI_SECTION.title}
      subtitle={SALES_ORDER_LIST_KPI_SECTION.subtitle}
    >
      <MetricCardGrid minColumnWidth={180}>
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
      </MetricCardGrid>
    </SalesOrderKpiSection>
  );
});
