import React, { memo, useEffect, useState, type RefObject } from "react";
import {
  AlertTriangle,
  Clock,
  DollarSign,
  FileText,
  Package,
  Percent,
  Receipt,
  Scale,
  TrendingUp,
} from "lucide-react";
import { MetricCard } from "@/src/components/ui/MetricCard";
import { SummaryKpiGrid } from "@/src/components/ui/SummaryKpiGrid";
import { formatCompactCurrency } from "@/src/lib/formatFinancialMetric";
import { formatCurrency } from "@/src/lib/utils";
import { cn } from "@/src/lib/utils";
import type { SalesOrderMarginStatusFilter } from "@/src/lib/salesOrderManagementMargin";
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
import {
  buildSalesOrderMarginCoverageHint,
  resolveSalesOrderMarginMoneyLabel,
  resolveSalesOrderMarginPercentLabel,
} from "@/src/lib/salesOrderMarginDisplay";
import { SalesOrderMarginInfoTooltip } from "@/src/components/sales/SalesOrderMarginInfoTooltip";
import type {
  SalesOrderManagementCards,
  SalesOrderManagementMarginEconomics,
} from "@/src/lib/salesOrderManagementTypes";
import type { SalesOrderFulfillmentKpis } from "@/src/lib/salesOrderManagementFulfillment";
import type {
  ManagementDashboardCard,
  ManagementStatusCardId,
} from "@/src/lib/salesOrderManagementStatus";
import type { SalesOrderManagementKpiFilterHandlers } from "@/src/components/sales/SalesOrderManagementKpiDashboard";

export type SalesOrderManagementSecondaryTab = "logistics" | "economics" | "fulfillment";

const kpiIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  total: Package,
  deliveredOnTime: Receipt,
  deliveredLate: Clock,
  overduePending: AlertTriangle,
  onTimePending: Package,
  finishedOrCancelled: AlertTriangle,
  reviewData: FileText,
};

type SecondaryTab = SalesOrderManagementSecondaryTab;

const TAB_LABELS: Record<SecondaryTab, string> = {
  logistics: "Logística",
  economics: "Margem",
  fulfillment: "NF-e",
};

type LogisticsBlockProps = {
  busy: boolean;
  displayDashboardCards: ManagementDashboardCard[];
  fulfillmentKpis: SalesOrderFulfillmentKpis | null;
  selectedLogisticStatus: ManagementStatusCardId | "";
  filterHandlers: SalesOrderManagementKpiFilterHandlers;
  validPortfolioCount: number | null;
  validPortfolioValue: number | null;
  loadError: string | null;
  loading: boolean;
};

const LogisticsKpiBlock = memo(function LogisticsKpiBlock({
  busy,
  displayDashboardCards,
  fulfillmentKpis,
  selectedLogisticStatus,
  filterHandlers,
  validPortfolioCount,
  validPortfolioValue,
  loadError,
  loading,
}: LogisticsBlockProps) {
  return (
    <div data-testid="sales-order-management-logistics">
      <SummaryKpiGrid minColumnWidth={180}>
        {displayDashboardCards.map((card) => {
          const Icon = kpiIcons[card.key] ?? FileText;
          const isTotal = card.isTotal === true;
          const isActive = isTotal
            ? selectedLogisticStatus === ""
            : selectedLogisticStatus === card.logisticStatus;
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
                isTotal ? "management-status-card-total" : `management-status-card-${card.key}`
              }
              data-active={isActive ? "true" : "false"}
              onClick={() => {
                if (isTotal) filterHandlers.onClearLogisticStatus();
                else if (card.logisticStatus)
                  filterHandlers.onToggleLogisticStatus(card.logisticStatus);
              }}
              className={cn(
                "min-w-0 w-full text-left rounded-xl transition-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
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
                compact
                loading={loading}
                className="h-full"
              />
            </button>
          );
        })}
      </SummaryKpiGrid>

      <SummaryKpiGrid className="mt-4" minColumnWidth={160}>
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
        <MetricCard
          label="% no prazo"
          amount={toFiniteMetricNumber(fulfillmentKpis?.onTimePercent)}
          amountFormat="percent"
          variant={resolveFulfillmentKpiVariant(
            "onTimePct",
            toFiniteMetricNumber(fulfillmentKpis?.onTimePercent)
          )}
          icon={<Percent className="h-4 w-4" />}
          compact
          loading={loading}
        />
      </SummaryKpiGrid>

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
    </div>
  );
});

type EconomicsBlockProps = {
  marginEconomics: SalesOrderManagementMarginEconomics | null;
  loading: boolean;
  marginStatusFilter: SalesOrderMarginStatusFilter;
  onToggleMarginStatusFilter: (status: SalesOrderMarginStatusFilter) => void;
};

const EconomicsKpiBlock = memo(function EconomicsKpiBlock({
  marginEconomics,
  loading,
  marginStatusFilter,
  onToggleMarginStatusFilter,
}: EconomicsBlockProps) {
  if (!marginEconomics?.consolidated) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="sales-order-management-economic-summary">
        Análise econômica indisponível para o filtro ou permissão atual.
      </p>
    );
  }

  const consolidated = marginEconomics.consolidated;
  const coverageHint = buildSalesOrderMarginCoverageHint(consolidated, formatCurrency);
  const drillCards = [
    {
      key: "MARGEM_NEGATIVA" as const,
      label: "Margem negativa",
      count: marginEconomics.ordersWithNegativeMargin,
      variant: resolveNegativeMarginCountVariant(marginEconomics.ordersWithNegativeMargin),
      helper: "Filtrar pedidos com margem negativa",
    },
    {
      key: "SEM_CUSTO" as const,
      label: "Sem custo",
      count: marginEconomics.ordersWithoutCost,
      variant: resolveAlertCountVariant(marginEconomics.ordersWithoutCost),
      helper: "Filtrar pedidos com item sem custo",
    },
    {
      key: "SEM_PRODUTO_VINCULADO" as const,
      label: "Sem produto",
      count: marginEconomics.ordersWithoutProduct,
      variant: resolveAlertCountVariant(marginEconomics.ordersWithoutProduct),
      helper: "Filtrar pedidos com item sem produto",
    },
  ];

  return (
    <div data-testid="sales-order-management-economic-summary">
      {marginEconomics.scopeNote ? (
        <p className="mb-3 text-[10px] text-muted-foreground">{marginEconomics.scopeNote}</p>
      ) : null}
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
          Margem gerencial (filtro)
        </span>
        <SalesOrderMarginInfoTooltip
          summary={consolidated}
          testId="sales-order-management-economic-margin-tooltip"
        />
      </div>
      <SummaryKpiGrid minColumnWidth={200}>
        <MetricCard
          label={resolveSalesOrderMarginMoneyLabel(consolidated)}
          amount={toFiniteMetricNumber(consolidated.marginValue)}
          amountFormat="currency"
          variant={resolveMarginMoneyVariant(consolidated.marginValue)}
          icon={<DollarSign className="h-4 w-4" />}
          helperText={coverageHint}
          loading={loading}
        />
        <MetricCard
          label={resolveSalesOrderMarginPercentLabel(consolidated)}
          amount={toFiniteMetricNumber(consolidated.marginPercent)}
          amountFormat="percent"
          variant={resolveMarginPercentVariant(consolidated.marginPercent)}
          icon={<Percent className="h-4 w-4" />}
          helperText={coverageHint ?? "Ponderada por receita com custo"}
          loading={loading}
        />
        <MetricCard
          label="Custo estimado"
          amount={toFiniteMetricNumber(consolidated.totalCost)}
          amountFormat="currency"
          variant="internal"
          icon={<Scale className="h-4 w-4" />}
          loading={loading}
        />
        <MetricCard
          label="Receita líquida"
          amount={toFiniteMetricNumber(consolidated.netRevenue)}
          amountFormat="currency"
          variant="money"
          icon={<TrendingUp className="h-4 w-4" />}
          loading={loading}
        />
      </SummaryKpiGrid>

      <p className="mt-4 mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Drill-down por status de margem
      </p>
      <SummaryKpiGrid minColumnWidth={150}>
        {drillCards.map((card) => {
          const active = marginStatusFilter === card.key;
          return (
            <button
              key={card.key}
              type="button"
              data-testid={`sales-order-margin-drill-${card.key.toLowerCase()}`}
              data-active={active ? "true" : "false"}
              onClick={() => onToggleMarginStatusFilter(active ? "" : card.key)}
              className={cn(
                "min-w-0 w-full text-left rounded-xl transition-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                active && "ring-2 ring-primary shadow-md"
              )}
            >
              <MetricCard
                label={card.label}
                formattedValue={formatOrderCountLabel(card.count)}
                helperText={card.helper}
                variant={card.variant}
                icon={<AlertTriangle className="h-4 w-4" />}
                compact
                loading={loading}
                className="h-full"
              />
            </button>
          );
        })}
      </SummaryKpiGrid>

      {marginEconomics.itemCounts.itemsWithoutCost > 0 ||
      marginEconomics.itemCounts.itemsWithoutProduct > 0 ||
      marginEconomics.itemCounts.itemsWithNegativeMargin > 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Itens no filtro:{" "}
          {marginEconomics.itemCounts.itemsWithNegativeMargin > 0 ? (
            <span className="font-medium text-foreground">
              {marginEconomics.itemCounts.itemsWithNegativeMargin} com margem negativa
            </span>
          ) : null}
          {marginEconomics.itemCounts.itemsWithoutCost > 0 ? (
            <span className="font-medium text-foreground">
              {marginEconomics.itemCounts.itemsWithNegativeMargin > 0 ? " · " : ""}
              {marginEconomics.itemCounts.itemsWithoutCost} sem custo
            </span>
          ) : null}
          {marginEconomics.itemCounts.itemsWithoutProduct > 0 ? (
            <span className="font-medium text-foreground">
              {(marginEconomics.itemCounts.itemsWithNegativeMargin > 0 ||
                marginEconomics.itemCounts.itemsWithoutCost > 0)
                ? " · "
                : ""}
              {marginEconomics.itemCounts.itemsWithoutProduct} sem produto
            </span>
          ) : null}
        </p>
      ) : null}
    </div>
  );
});

type FulfillmentBlockProps = {
  busy: boolean;
  fulfillmentKpis: SalesOrderFulfillmentKpis | null;
  loading: boolean;
};

const FulfillmentKpiBlock = memo(function FulfillmentKpiBlock({
  busy,
  fulfillmentKpis,
  loading,
}: FulfillmentBlockProps) {
  return (
    <div data-testid="sales-order-management-fulfillment">
      <SummaryKpiGrid minColumnWidth={160}>
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
          label="% faturado"
          amount={toFiniteMetricNumber(fulfillmentKpis?.averageInvoicedPercent)}
          amountFormat="percent"
          variant="neutral"
          icon={<Percent className="h-4 w-4" />}
          compact
          loading={loading}
        />
        <MetricCard
          label="Entregues no prazo"
          formattedValue={busy ? "—" : formatOrderCountLabel(fulfillmentKpis?.deliveredOnTime)}
          variant={resolveFulfillmentKpiVariant(
            "onTime",
            toFiniteMetricNumber(fulfillmentKpis?.deliveredOnTime)
          )}
          icon={<Receipt className="h-4 w-4" />}
          compact
          loading={loading}
        />
      </SummaryKpiGrid>
    </div>
  );
});

export const SalesOrderManagementKpiSecondaryPanel = memo(function SalesOrderManagementKpiSecondaryPanel({
  loading,
  loadError,
  fulfillmentKpis,
  marginEconomics,
  displayDashboardCards,
  selectedLogisticStatus,
  marginStatusFilter,
  filterHandlers,
  validPortfolioCount,
  validPortfolioValue,
  activeTab: controlledTab,
  onActiveTabChange,
  sectionRef,
}: {
  loading: boolean;
  loadError: string | null;
  fulfillmentKpis: SalesOrderFulfillmentKpis | null;
  marginEconomics: SalesOrderManagementMarginEconomics | null;
  displayDashboardCards: ManagementDashboardCard[];
  selectedLogisticStatus: ManagementStatusCardId | "";
  marginStatusFilter: SalesOrderMarginStatusFilter;
  filterHandlers: SalesOrderManagementKpiFilterHandlers;
  validPortfolioCount: number | null;
  validPortfolioValue: number | null;
  activeTab?: SecondaryTab;
  onActiveTabChange?: (tab: SecondaryTab) => void;
  sectionRef?: RefObject<HTMLElement | null>;
}) {
  const [internalTab, setInternalTab] = useState<SecondaryTab>("logistics");
  const [mountedTabs, setMountedTabs] = useState<Set<SecondaryTab>>(() => new Set(["logistics"]));
  const activeTab = controlledTab ?? internalTab;
  const busy = loading || !!loadError;
  const showEconomics = Boolean(marginEconomics?.consolidated);

  const selectTab = (tab: SecondaryTab) => {
    if (onActiveTabChange) onActiveTabChange(tab);
    else setInternalTab(tab);
    setMountedTabs((prev) => {
      if (prev.has(tab)) return prev;
      const next = new Set(prev);
      next.add(tab);
      return next;
    });
  };

  useEffect(() => {
    if (controlledTab) {
      setMountedTabs((prev) => {
        if (prev.has(controlledTab)) return prev;
        const next = new Set(prev);
        next.add(controlledTab);
        return next;
      });
    }
  }, [controlledTab]);

  return (
    <section
      ref={sectionRef}
      data-testid="sales-order-management-secondary"
      className="rounded-xl border border-border bg-card shadow-sm p-4"
    >
      <div className="mb-3">
        <h2 className="text-sm font-bold text-foreground">Detalhes operacionais</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {SALES_ORDER_MGMT_KPI_SECTIONS.logistics.subtitle}
        </p>
      </div>

      <div
        role="tablist"
        aria-label="Detalhes operacionais"
        className="flex flex-wrap gap-2 border-b border-border pb-3 mb-4"
      >
        {(Object.keys(TAB_LABELS) as SecondaryTab[]).map((tab) => {
          if (tab === "economics" && !showEconomics) return null;
          return (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              data-testid={`sales-order-secondary-tab-${tab}`}
              onClick={() => selectTab(tab)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
                activeTab === tab
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              )}
            >
              {TAB_LABELS[tab]}
            </button>
          );
        })}
      </div>

      <div role="tabpanel">
        {mountedTabs.has("logistics") && activeTab === "logistics" ? (
          <LogisticsKpiBlock
            busy={busy}
            displayDashboardCards={displayDashboardCards}
            fulfillmentKpis={fulfillmentKpis}
            selectedLogisticStatus={selectedLogisticStatus}
            filterHandlers={filterHandlers}
            validPortfolioCount={validPortfolioCount}
            validPortfolioValue={validPortfolioValue}
            loadError={loadError}
            loading={loading}
          />
        ) : null}
        {mountedTabs.has("economics") && activeTab === "economics" && showEconomics ? (
          <EconomicsKpiBlock
            marginEconomics={marginEconomics}
            loading={loading}
            marginStatusFilter={marginStatusFilter}
            onToggleMarginStatusFilter={filterHandlers.onToggleMarginStatusFilter}
          />
        ) : null}
        {mountedTabs.has("fulfillment") && activeTab === "fulfillment" ? (
          <FulfillmentKpiBlock busy={busy} fulfillmentKpis={fulfillmentKpis} loading={loading} />
        ) : null}
      </div>
    </section>
  );
});
