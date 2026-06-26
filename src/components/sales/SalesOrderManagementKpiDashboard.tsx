import React, { memo, useCallback, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  DollarSign,
  LayoutGrid,
  Percent,
  Receipt,
  TrendingUp,
} from "lucide-react";
import { MetricCard } from "@/src/components/ui/MetricCard";
import { MetricCardGrid } from "@/src/components/ui/MetricCardGrid";
import { SalesOrderKpiSection } from "@/src/components/sales/SalesOrderKpiSection";
import { SalesOrderManagementKpiSecondaryPanel } from "@/src/components/sales/SalesOrderManagementKpiSecondaryPanel";
import type { SalesOrderManagementSecondaryTab } from "@/src/components/sales/SalesOrderManagementKpiSecondaryPanel";
import { SalesOrderManagementMarginOverview } from "@/src/components/sales/SalesOrderManagementMarginOverview";
import type { SalesOrderMarginStatusFilter } from "@/src/lib/salesOrderManagementMargin";
import {
  formatOrderCountLabel,
  resolveAlertCountVariant,
  resolveFulfillmentKpiVariant,
  resolveNegativeMarginCountVariant,
  toFiniteMetricNumber,
} from "@/src/lib/salesOrderManagementMetricCards";
import { SALES_ORDER_MGMT_KPI_SECTIONS } from "@/src/lib/salesOrderManagementKpiLabels";
import type {
  SalesOrderManagementCards,
  SalesOrderManagementMarginEconomics,
  SalesOrderManagementSummary,
} from "@/src/lib/salesOrderManagementTypes";
import type { SalesOrderFulfillmentKpis } from "@/src/lib/salesOrderManagementFulfillment";
import type {
  ManagementDashboardCard,
  ManagementStatusCardId,
} from "@/src/lib/salesOrderManagementStatus";
import { cn } from "@/src/lib/utils";

type AlertFilterKey =
  | "withoutNfe"
  | "pendingLate"
  | "withCut"
  | "reviewData"
  | "overdueOnly"
  | "partialOrCut"
  | "negativeMargin"
  | "withoutCost"
  | "withoutProduct";

export type SalesOrderManagementKpiFilterHandlers = {
  onToggleLogisticStatus: (status: ManagementStatusCardId) => void;
  onClearLogisticStatus: () => void;
  onToggleInvoiceFilter: (value: "false" | "") => void;
  onToggleReviewDataFilter: (value: "true" | "") => void;
  onToggleCutFilter: (value: "true" | "") => void;
  onToggleOverdueOnly: (value: boolean) => void;
  onTogglePartialOrCut: (value: boolean) => void;
  onToggleMarginStatusFilter: (status: SalesOrderMarginStatusFilter) => void;
};

export type SalesOrderManagementKpiFilterState = {
  selectedLogisticStatus: ManagementStatusCardId | "";
  invoiceFilter: string;
  reviewDataFilter: string;
  cutFilter: string;
  overdueOnly: boolean;
  partialOrCut: boolean;
  marginStatusFilter: SalesOrderMarginStatusFilter;
};

function AlertCardButton({
  testId,
  active,
  disabled,
  onClick,
  children,
}: {
  testId: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      data-active={active ? "true" : "false"}
      data-filter-disabled={disabled ? "true" : "false"}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "text-left rounded-xl transition-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-primary w-full",
        !disabled && "cursor-pointer",
        active && "ring-2 ring-primary shadow-md",
        disabled && "cursor-default"
      )}
    >
      {children}
    </button>
  );
}

export const SalesOrderManagementKpiDashboard = memo(function SalesOrderManagementKpiDashboard({
  loading,
  loadError,
  fulfillmentKpis,
  marginEconomics,
  managementSummary,
  displayDashboardCards,
  logisticCards,
  filterState,
  filterHandlers,
  validPortfolioCount,
  validPortfolioValue,
}: {
  loading: boolean;
  loadError: string | null;
  fulfillmentKpis: SalesOrderFulfillmentKpis | null;
  marginEconomics: SalesOrderManagementMarginEconomics | null;
  managementSummary: SalesOrderManagementSummary | null;
  displayDashboardCards: ManagementDashboardCard[];
  logisticCards: SalesOrderManagementCards;
  filterState: SalesOrderManagementKpiFilterState;
  filterHandlers: SalesOrderManagementKpiFilterHandlers;
  validPortfolioCount: number | null;
  validPortfolioValue: number | null;
}) {
  const busy = loading || !!loadError;
  const secondaryPanelRef = useRef<HTMLElement>(null);
  const [secondaryTab, setSecondaryTab] = useState<SalesOrderManagementSecondaryTab>("logistics");
  const showMarginOverview = Boolean(marginEconomics?.consolidated) || loading;

  const openEconomicsDetail = useCallback(() => {
    setSecondaryTab("economics");
    requestAnimationFrame(() => {
      secondaryPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, []);

  const openMarginStatusDrillDown = useCallback(
    (status: SalesOrderMarginStatusFilter) => {
      setSecondaryTab("economics");
      filterHandlers.onToggleMarginStatusFilter(status);
      requestAnimationFrame(() => {
        secondaryPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    },
    [filterHandlers]
  );

  const alertCards = useMemo(() => {
    const pendingLate = toFiniteMetricNumber(fulfillmentKpis?.pendingLate);
    const withoutNfe = toFiniteMetricNumber(fulfillmentKpis?.ordersWithoutNfe);
    const withCut = toFiniteMetricNumber(fulfillmentKpis?.withCutCount);
    const review = toFiniteMetricNumber(fulfillmentKpis?.needsReviewCount);
    const negativeMargin = toFiniteMetricNumber(marginEconomics?.ordersWithNegativeMargin);
    const withoutCost = toFiniteMetricNumber(marginEconomics?.ordersWithoutCost);
    const withoutProduct = toFiniteMetricNumber(marginEconomics?.ordersWithoutProduct);
    const partial = toFiniteMetricNumber(fulfillmentKpis?.partialCount);

    const overdueDisplay =
      (toFiniteMetricNumber(logisticCards.overduePending) ?? 0) +
      (toFiniteMetricNumber(logisticCards.deliveredLate) ?? 0);

    return [
      {
        key: "pendingLate" as const,
        label: "Pendentes atrasados",
        count: pendingLate,
        variant: resolveFulfillmentKpiVariant("pendingLate", pendingLate),
        filterable: true,
        active: filterState.selectedLogisticStatus === "overduePending",
        onClick: () => filterHandlers.onToggleLogisticStatus("overduePending"),
      },
      {
        key: "withoutNfe" as const,
        label: "Sem NF",
        count: withoutNfe,
        variant: resolveFulfillmentKpiVariant("withoutNfe", withoutNfe),
        filterable: true,
        active: filterState.invoiceFilter === "false",
        onClick: () =>
          filterHandlers.onToggleInvoiceFilter(filterState.invoiceFilter === "false" ? "" : "false"),
      },
      {
        key: "withCut" as const,
        label: "Com corte",
        count: withCut,
        variant: resolveFulfillmentKpiVariant("cut", withCut),
        filterable: true,
        active: filterState.cutFilter === "true",
        onClick: () =>
          filterHandlers.onToggleCutFilter(filterState.cutFilter === "true" ? "" : "true"),
      },
      {
        key: "reviewData" as const,
        label: "Pedidos para revisar",
        count: review,
        variant: resolveFulfillmentKpiVariant("review", review),
        filterable: true,
        active: filterState.reviewDataFilter === "true",
        onClick: () =>
          filterHandlers.onToggleReviewDataFilter(
            filterState.reviewDataFilter === "true" ? "" : "true"
          ),
      },
      {
        key: "negativeMargin" as AlertFilterKey,
        label: "Margem negativa",
        count: negativeMargin,
        variant: resolveNegativeMarginCountVariant(negativeMargin),
        filterable: true,
        active: filterState.marginStatusFilter === "MARGEM_NEGATIVA",
        onClick: () =>
          openMarginStatusDrillDown(
            filterState.marginStatusFilter === "MARGEM_NEGATIVA" ? "" : "MARGEM_NEGATIVA"
          ),
      },
      {
        key: "withoutCost" as AlertFilterKey,
        label: "Sem custo",
        count: withoutCost,
        variant: resolveAlertCountVariant(withoutCost),
        filterable: true,
        active: filterState.marginStatusFilter === "SEM_CUSTO",
        onClick: () =>
          openMarginStatusDrillDown(
            filterState.marginStatusFilter === "SEM_CUSTO" ? "" : "SEM_CUSTO"
          ),
      },
      {
        key: "withoutProduct" as AlertFilterKey,
        label: "Sem produto",
        count: withoutProduct,
        variant: resolveAlertCountVariant(withoutProduct),
        filterable: true,
        active: filterState.marginStatusFilter === "SEM_PRODUTO_VINCULADO",
        onClick: () =>
          openMarginStatusDrillDown(
            filterState.marginStatusFilter === "SEM_PRODUTO_VINCULADO"
              ? ""
              : "SEM_PRODUTO_VINCULADO"
          ),
      },
      {
        key: "overdueOnly" as const,
        label: "Atrasados",
        count: overdueDisplay,
        variant: resolveFulfillmentKpiVariant("late", overdueDisplay),
        filterable: true,
        active: filterState.overdueOnly,
        onClick: () => filterHandlers.onToggleOverdueOnly(!filterState.overdueOnly),
        helperText: "Prazo vencido ou conclusão com atraso.",
      },
      {
        key: "partialOrCut" as const,
        label: "Parciais",
        count: partial,
        variant: resolveFulfillmentKpiVariant("partial", partial),
        filterable: true,
        active: filterState.partialOrCut,
        onClick: () => filterHandlers.onTogglePartialOrCut(!filterState.partialOrCut),
      },
    ];
  }, [
    filterHandlers,
    filterState.cutFilter,
    filterState.invoiceFilter,
    filterState.overdueOnly,
    filterState.partialOrCut,
    filterState.reviewDataFilter,
    filterState.selectedLogisticStatus,
    filterState.marginStatusFilter,
    openMarginStatusDrillDown,
    logisticCards,
    fulfillmentKpis,
    marginEconomics,
  ]);

  const totalOrders =
    toFiniteMetricNumber(fulfillmentKpis?.totalOrders) ??
    toFiniteMetricNumber(managementSummary?.totalOrdersCount);

  return (
    <div className="space-y-5" data-testid="sales-order-management-kpi-dashboard">
      <SalesOrderKpiSection
        testId="sales-order-management-overview"
        title={SALES_ORDER_MGMT_KPI_SECTIONS.overview.title}
        subtitle={SALES_ORDER_MGMT_KPI_SECTIONS.overview.subtitle}
      >
        <MetricCardGrid minColumnWidth={200}>
          <MetricCard
            label="Total de pedidos"
            amount={totalOrders}
            amountFormat="number"
            variant="info"
            icon={<LayoutGrid className="h-4 w-4" />}
            helperText="Pedidos únicos no filtro atual."
            loading={loading}
          />
          <MetricCard
            label="Valor vendido"
            amount={toFiniteMetricNumber(fulfillmentKpis?.totalSoldValue)}
            amountFormat="currency"
            variant="money"
            icon={<DollarSign className="h-4 w-4" />}
            loading={loading}
          />
          <MetricCard
            label="Valor faturado"
            amount={toFiniteMetricNumber(fulfillmentKpis?.totalInvoicedValue)}
            amountFormat="currency"
            variant="success"
            icon={<Receipt className="h-4 w-4" />}
            loading={loading}
          />
          <MetricCard
            label="Gap vendido × faturado"
            amount={toFiniteMetricNumber(fulfillmentKpis?.soldInvoicedGap)}
            amountFormat="currency"
            variant={resolveFulfillmentKpiVariant(
              "gap",
              toFiniteMetricNumber(fulfillmentKpis?.soldInvoicedGap)
            )}
            icon={<TrendingUp className="h-4 w-4" />}
            helperText="Valor vendido ainda não convertido em NF."
            loading={loading}
          />
          <MetricCard
            label="% no prazo"
            amount={toFiniteMetricNumber(fulfillmentKpis?.onTimePercent)}
            amountFormat="percent"
            variant={resolveFulfillmentKpiVariant(
              "onTimePct",
              toFiniteMetricNumber(fulfillmentKpis?.onTimePercent)
            )}
            icon={<Percent className="h-4 w-4" />}
            loading={loading}
          />
        </MetricCardGrid>
      </SalesOrderKpiSection>

      {showMarginOverview ? (
        <SalesOrderManagementMarginOverview
          marginEconomics={marginEconomics}
          loading={loading}
          onOpenEconomicsDetail={openEconomicsDetail}
        />
      ) : null}

      <SalesOrderKpiSection
        testId="sales-order-management-alerts"
        title={SALES_ORDER_MGMT_KPI_SECTIONS.alerts.title}
        subtitle={SALES_ORDER_MGMT_KPI_SECTIONS.alerts.subtitle}
      >
        <MetricCardGrid minColumnWidth={150}>
          {alertCards.map((alert) => (
            <AlertCardButton
              key={alert.key}
              testId={`sales-order-alert-card-${alert.key}`}
              active={alert.active}
              disabled={!alert.filterable}
              onClick={alert.filterable ? alert.onClick : undefined}
            >
              <MetricCard
                label={alert.label}
                formattedValue={busy ? "—" : formatOrderCountLabel(alert.count)}
                helperText={
                  alert.filterable
                    ? alert.helperText ?? "Clique para filtrar."
                    : "Filtro dedicado ainda não disponível."
                }
                variant={alert.variant}
                icon={<AlertTriangle className="h-4 w-4" />}
                compact
                loading={loading}
                className="h-full"
              />
            </AlertCardButton>
          ))}
        </MetricCardGrid>
      </SalesOrderKpiSection>

      <SalesOrderManagementKpiSecondaryPanel
        loading={loading}
        loadError={loadError}
        fulfillmentKpis={fulfillmentKpis}
        marginEconomics={marginEconomics}
        displayDashboardCards={displayDashboardCards}
        selectedLogisticStatus={filterState.selectedLogisticStatus}
        marginStatusFilter={filterState.marginStatusFilter}
        filterHandlers={filterHandlers}
        validPortfolioCount={validPortfolioCount}
        validPortfolioValue={validPortfolioValue}
        activeTab={secondaryTab}
        onActiveTabChange={setSecondaryTab}
        sectionRef={secondaryPanelRef}
      />
    </div>
  );
});
