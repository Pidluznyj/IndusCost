import React, { memo, useState } from "react";
import {
  AlertTriangle,
  Clock,
  DollarSign,
  FileText,
  Package,
  Percent,
  Receipt,
  Scale,
} from "lucide-react";
import { MetricCard } from "@/src/components/ui/MetricCard";
import { MetricCardGrid } from "@/src/components/ui/MetricCardGrid";
import { formatCompactCurrency } from "@/src/lib/formatFinancialMetric";
import { formatCurrency } from "@/src/lib/utils";
import { cn } from "@/src/lib/utils";
import {
  formatOrderCountLabel,
  metricCurrencySubtitle,
  resolveFulfillmentKpiVariant,
  resolveLogisticStatusCardVariant,
  resolveMarginMoneyVariant,
  resolveMarginPercentVariant,
  toFiniteMetricNumber,
} from "@/src/lib/salesOrderManagementMetricCards";
import { SALES_ORDER_MGMT_KPI_SECTIONS } from "@/src/lib/salesOrderManagementKpiLabels";
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

const kpiIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  total: Package,
  deliveredOnTime: Receipt,
  deliveredLate: Clock,
  overduePending: AlertTriangle,
  onTimePending: Package,
  finishedOrCancelled: AlertTriangle,
  reviewData: FileText,
};

type SecondaryTab = "logistics" | "economics" | "fulfillment";

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
      <MetricCardGrid minColumnWidth={180}>
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
                "text-left rounded-xl transition-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-primary w-full",
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
    </div>
  );
});

type EconomicsBlockProps = {
  marginEconomics: SalesOrderManagementMarginEconomics | null;
  loading: boolean;
};

const EconomicsKpiBlock = memo(function EconomicsKpiBlock({
  marginEconomics,
  loading,
}: EconomicsBlockProps) {
  if (!marginEconomics?.consolidated) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="sales-order-management-economic-summary">
        Análise econômica indisponível para o filtro ou permissão atual.
      </p>
    );
  }

  return (
    <div data-testid="sales-order-management-economic-summary">
      {marginEconomics.scopeNote ? (
        <p className="mb-3 text-[10px] text-muted-foreground">{marginEconomics.scopeNote}</p>
      ) : null}
      <MetricCardGrid minColumnWidth={200}>
        <MetricCard
          label="Margem R$"
          amount={toFiniteMetricNumber(marginEconomics.consolidated.marginValue)}
          amountFormat="currency"
          variant={resolveMarginMoneyVariant(marginEconomics.consolidated.marginValue)}
          icon={<DollarSign className="h-4 w-4" />}
          loading={loading}
        />
        <MetricCard
          label="Margem %"
          amount={toFiniteMetricNumber(marginEconomics.consolidated.marginPercent)}
          amountFormat="percent"
          variant={resolveMarginPercentVariant(marginEconomics.consolidated.marginPercent)}
          icon={<Percent className="h-4 w-4" />}
          helperText="Ponderada por receita líquida do filtro"
          loading={loading}
        />
        <MetricCard
          label="Custo estimado"
          amount={toFiniteMetricNumber(marginEconomics.consolidated.totalCost)}
          amountFormat="currency"
          variant="internal"
          icon={<Scale className="h-4 w-4" />}
          loading={loading}
        />
      </MetricCardGrid>
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
      </MetricCardGrid>
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
  filterHandlers,
  validPortfolioCount,
  validPortfolioValue,
}: {
  loading: boolean;
  loadError: string | null;
  fulfillmentKpis: SalesOrderFulfillmentKpis | null;
  marginEconomics: SalesOrderManagementMarginEconomics | null;
  displayDashboardCards: ManagementDashboardCard[];
  selectedLogisticStatus: ManagementStatusCardId | "";
  filterHandlers: SalesOrderManagementKpiFilterHandlers;
  validPortfolioCount: number | null;
  validPortfolioValue: number | null;
}) {
  const [activeTab, setActiveTab] = useState<SecondaryTab>("logistics");
  const [mountedTabs, setMountedTabs] = useState<Set<SecondaryTab>>(() => new Set(["logistics"]));
  const busy = loading || !!loadError;
  const showEconomics = Boolean(marginEconomics?.consolidated);

  const selectTab = (tab: SecondaryTab) => {
    setActiveTab(tab);
    setMountedTabs((prev) => {
      if (prev.has(tab)) return prev;
      const next = new Set(prev);
      next.add(tab);
      return next;
    });
  };

  return (
    <section
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
          <EconomicsKpiBlock marginEconomics={marginEconomics} loading={loading} />
        ) : null}
        {mountedTabs.has("fulfillment") && activeTab === "fulfillment" ? (
          <FulfillmentKpiBlock busy={busy} fulfillmentKpis={fulfillmentKpis} loading={loading} />
        ) : null}
      </div>
    </section>
  );
});
