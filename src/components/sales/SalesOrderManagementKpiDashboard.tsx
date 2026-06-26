import React, { useMemo } from "react";
import {
  AlertTriangle,
  Clock,
  DollarSign,
  FileText,
  LayoutGrid,
  Package,
  Percent,
  Receipt,
  Scale,
  TrendingUp,
} from "lucide-react";
import { MetricCard } from "@/src/components/ui/MetricCard";
import { MetricCardGrid } from "@/src/components/ui/MetricCardGrid";
import { SalesOrderKpiSection } from "@/src/components/sales/SalesOrderKpiSection";
import { formatCompactCurrency } from "@/src/lib/formatFinancialMetric";
import { formatCurrency } from "@/src/lib/utils";
import { cn } from "@/src/lib/utils";
import {
  formatOrderCountLabel,
  metricCurrencySubtitle,
  resolveAlertCountVariant,
  resolveFulfillmentKpiVariant,
  resolveLogisticStatusCardVariant,
  resolveMarginMoneyVariant,
  resolveMarginPercentVariant,
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

const kpiIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  total: LayoutGrid,
  deliveredOnTime: Receipt,
  deliveredLate: Clock,
  overduePending: AlertTriangle,
  onTimePending: Package,
  finishedOrCancelled: AlertTriangle,
  reviewData: FileText,
};

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
};

export type SalesOrderManagementKpiFilterState = {
  selectedLogisticStatus: ManagementStatusCardId | "";
  invoiceFilter: string;
  reviewDataFilter: string;
  cutFilter: string;
  overdueOnly: boolean;
  partialOrCut: boolean;
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
        active && "ring-2 ring-primary shadow-md",
        disabled && "cursor-default opacity-90"
      )}
    >
      {children}
    </button>
  );
}

export function SalesOrderManagementKpiDashboard({
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
        label: "Pedidos com margem negativa",
        count: negativeMargin,
        variant: resolveNegativeMarginCountVariant(negativeMargin),
        filterable: false,
        active: false,
      },
      {
        key: "withoutCost" as AlertFilterKey,
        label: "Pedidos com item sem custo",
        count: withoutCost,
        variant: resolveAlertCountVariant(withoutCost),
        filterable: false,
        active: false,
      },
      {
        key: "withoutProduct" as AlertFilterKey,
        label: "Itens sem produto vinculado",
        count: withoutProduct,
        variant: resolveAlertCountVariant(withoutProduct),
        filterable: false,
        active: false,
      },
      {
        key: "overdueOnly" as const,
        label: "Atrasados",
        count: overdueDisplay,
        variant: resolveFulfillmentKpiVariant("late", overdueDisplay),
        filterable: true,
        active: filterState.overdueOnly,
        onClick: () => filterHandlers.onToggleOverdueOnly(!filterState.overdueOnly),
        helperText: "Pedidos com prazo vencido ou conclusão com atraso.",
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
    logisticCards,
    fulfillmentKpis,
    marginEconomics,
  ]);

  const totalOrders =
    toFiniteMetricNumber(fulfillmentKpis?.totalOrders) ??
    toFiniteMetricNumber(managementSummary?.totalOrdersCount);

  return (
    <div className="space-y-8" data-testid="sales-order-management-kpi-dashboard">
      <SalesOrderKpiSection
        testId="sales-order-management-overview"
        title={SALES_ORDER_MGMT_KPI_SECTIONS.overview.title}
        subtitle={SALES_ORDER_MGMT_KPI_SECTIONS.overview.subtitle}
      >
        <MetricCardGrid minColumnWidth={240}>
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
            variant="info"
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

      <SalesOrderKpiSection
        testId="sales-order-management-alerts"
        title={SALES_ORDER_MGMT_KPI_SECTIONS.alerts.title}
        subtitle={SALES_ORDER_MGMT_KPI_SECTIONS.alerts.subtitle}
      >
        <MetricCardGrid minColumnWidth={160}>
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
                    ? alert.helperText ?? "Clique para filtrar a lista."
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

      <SalesOrderKpiSection
        testId="sales-order-management-logistics"
        title={SALES_ORDER_MGMT_KPI_SECTIONS.logistics.title}
        subtitle={SALES_ORDER_MGMT_KPI_SECTIONS.logistics.subtitle}
      >
        <MetricCardGrid>
          {displayDashboardCards.map((card) => {
            const Icon = kpiIcons[card.key] ?? FileText;
            const isTotal = card.isTotal === true;
            const isActive = isTotal
              ? filterState.selectedLogisticStatus === ""
              : filterState.selectedLogisticStatus === card.logisticStatus;
            const countLabel = formatOrderCountLabel(card.count);
            const percentHint =
              card.percentOfTotal != null && !isTotal
                ? `${card.tooltip} (${card.percentOfTotal}% do total no filtro)`
                : card.tooltip;
            const footnote =
              !busy
                ? [formatCompactCurrency(card.totalNetValue), percentHint]
                    .filter(Boolean)
                    .join(" · ")
                : undefined;

            return (
              <button
                key={card.key}
                type="button"
                data-testid={
                  isTotal
                    ? "management-status-card-total"
                    : `management-status-card-${card.key}`
                }
                data-active={isActive ? "true" : "false"}
                onClick={() => {
                  if (isTotal) filterHandlers.onClearLogisticStatus();
                  else if (card.logisticStatus)
                    filterHandlers.onToggleLogisticStatus(card.logisticStatus);
                }}
                className={cn(
                  "text-left rounded-xl transition-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                  isActive && "ring-2 ring-primary shadow-md"
                )}
              >
                <MetricCard
                  label={card.label}
                  formattedValue={busy ? "—" : countLabel}
                  fullValue={metricCurrencySubtitle(card.totalNetValue)}
                  subtitle={footnote}
                  variant={resolveLogisticStatusCardVariant(card.key)}
                  icon={<Icon className="h-4 w-4" />}
                  loading={loading}
                  className="h-full"
                />
              </button>
            );
          })}
        </MetricCardGrid>

        <MetricCardGrid className="mt-4" minColumnWidth={160}>
          <MetricCard
            label="SLA médio"
            formattedValue={
              busy ||
              fulfillmentKpis?.averageSlaDays == null ||
              !Number.isFinite(fulfillmentKpis.averageSlaDays)
                ? "—"
                : `${fulfillmentKpis.averageSlaDays.toFixed(1)} dias`
            }
            helperText="Média de dias entre emissão do pedido e NF."
            variant="neutral"
            icon={<Clock className="h-4 w-4" />}
            compact
            loading={loading}
          />
          <MetricCard
            label="% atendimento médio"
            amount={toFiniteMetricNumber(fulfillmentKpis?.averageFulfilledPercent)}
            amountFormat="percent"
            variant="neutral"
            icon={<Percent className="h-4 w-4" />}
            compact
            loading={loading}
          />
        </MetricCardGrid>

        {!loading && !loadError && validPortfolioCount != null ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Carteira válida no filtro:{" "}
            <span className="font-semibold text-foreground">{validPortfolioCount}</span> pedido(s)
            {validPortfolioValue != null ? (
              <>
                {" "}
                ·{" "}
                <span className="font-semibold text-foreground">
                  {formatCurrency(validPortfolioValue)}
                </span>
              </>
            ) : null}{" "}
            não finalizados/cancelados (BI)
          </p>
        ) : null}
      </SalesOrderKpiSection>

      <SalesOrderKpiSection
        testId="sales-order-management-economic-summary"
        title={SALES_ORDER_MGMT_KPI_SECTIONS.economics.title}
        subtitle={SALES_ORDER_MGMT_KPI_SECTIONS.economics.subtitle}
      >
        {marginEconomics?.scopeNote ? (
          <p className="mb-2 text-[10px] text-muted-foreground">{marginEconomics.scopeNote}</p>
        ) : null}
        <MetricCardGrid minColumnWidth={200}>
          <MetricCard
            label="Custo estimado"
            amount={toFiniteMetricNumber(marginEconomics?.consolidated?.totalCost)}
            amountFormat="currency"
            variant="neutral"
            icon={<Scale className="h-4 w-4" />}
            loading={loading}
          />
          <MetricCard
            label="Margem R$"
            amount={toFiniteMetricNumber(marginEconomics?.consolidated?.marginValue)}
            amountFormat="currency"
            variant={resolveMarginMoneyVariant(marginEconomics?.consolidated?.marginValue)}
            icon={<DollarSign className="h-4 w-4" />}
            loading={loading}
          />
          <MetricCard
            label="Margem %"
            amount={toFiniteMetricNumber(marginEconomics?.consolidated?.marginPercent)}
            amountFormat="percent"
            variant={resolveMarginPercentVariant(marginEconomics?.consolidated?.marginPercent)}
            icon={<Percent className="h-4 w-4" />}
            helperText="Ponderada por receita líquida do filtro"
            loading={loading}
          />
        </MetricCardGrid>
      </SalesOrderKpiSection>

      <SalesOrderKpiSection
        testId="sales-order-management-fulfillment"
        title={SALES_ORDER_MGMT_KPI_SECTIONS.fulfillment.title}
        subtitle={SALES_ORDER_MGMT_KPI_SECTIONS.fulfillment.subtitle}
        collapsible
        defaultOpen={false}
      >
        <MetricCardGrid minColumnWidth={160}>
          <MetricCard
            label="Com NF"
            formattedValue={busy ? "—" : formatOrderCountLabel(fulfillmentKpis?.ordersWithNfe)}
            variant={resolveFulfillmentKpiVariant(
              "withNfe",
              toFiniteMetricNumber(fulfillmentKpis?.ordersWithNfe)
            )}
            icon={<Receipt className="h-4 w-4" />}
            compact
            loading={loading}
          />
          <MetricCard
            label="Sem NF"
            formattedValue={busy ? "—" : formatOrderCountLabel(fulfillmentKpis?.ordersWithoutNfe)}
            variant={resolveFulfillmentKpiVariant(
              "withoutNfe",
              toFiniteMetricNumber(fulfillmentKpis?.ordersWithoutNfe)
            )}
            icon={<FileText className="h-4 w-4" />}
            compact
            loading={loading}
          />
          <MetricCard
            label="% faturamento médio"
            amount={toFiniteMetricNumber(fulfillmentKpis?.averageInvoicedPercent)}
            amountFormat="percent"
            variant="neutral"
            icon={<Percent className="h-4 w-4" />}
            compact
            loading={loading}
          />
          <MetricCard
            label="Entregues/faturados no prazo"
            formattedValue={busy ? "—" : formatOrderCountLabel(fulfillmentKpis?.deliveredOnTime)}
            variant={resolveFulfillmentKpiVariant(
              "onTime",
              toFiniteMetricNumber(fulfillmentKpis?.deliveredOnTime)
            )}
            icon={<Receipt className="h-4 w-4" />}
            compact
            loading={loading}
          />
        </MetricCardGrid>
      </SalesOrderKpiSection>
    </div>
  );
}
