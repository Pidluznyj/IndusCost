import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  DollarSign,
  Loader2,
  Package,
  Percent,
  Scale,
  TrendingDown,
  TrendingUp,
  Users,
  Download,
  Wallet,
} from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { cn, formatCurrency, formatNumber } from "@/src/lib/utils";
import { ExecutiveSummarySection } from "@/src/components/ui/ExecutiveSummarySection";
import { SummaryKpiGrid } from "@/src/components/ui/SummaryKpiGrid";
import {
  SYSTEM_TOTALIZER_GRID_CLASS,
  SYSTEM_TOTALIZER_METRIC_CARD_CLASS,
  SystemTotalizerCard,
} from "@/src/components/ui/SystemTotalizerCard";
import { SalesOrderMarginStatusBadge } from "@/src/components/sales/SalesOrderMarginStatusBadge";
import {
  formatSalesOrderMarginPercent,
  formatSalesOrderMarkup,
  resolveSalesOrderMarginMoneyLabel,
  resolveSalesOrderMarginPercentLabel,
} from "@/src/lib/salesOrderMarginDisplay";
import { SalesOrderMarginInfoTooltip } from "@/src/components/sales/SalesOrderMarginInfoTooltip";
import {
  getSalesOrderMarginIndicatorsApiPath,
  type SalesOrderMarginIndicatorsPayload,
} from "@/src/lib/salesOrderMarginIndicatorsTypes";
import {
  downloadInternalMarginExport,
  getSalesOrderIndicatorsInternalMarginExportUrl,
} from "@/src/lib/salesOrderInternalMarginExportUi";
import { SALES_ORDER_INTERNAL_MARGIN_REPORT_DISCLAIMER } from "@/src/lib/salesOrderInternalMarginExport";
import {
  buildSalesOrderYearOptions,
  SALES_ORDER_MONTH_OPTIONS,
} from "@/src/lib/salesOrderPeriodFilter";
import { ContextualDashboardLayout } from "./ContextualDashboardLayout";
import { ContextualDashboardEmpty } from "./ContextualDashboardEmpty";

function RankingTable({
  title,
  testId,
  headers,
  rows,
  emptyMessage,
}: {
  title: string;
  testId: string;
  headers: string[];
  rows: React.ReactNode[][];
  emptyMessage: string;
}) {
  return (
    <div
      className="rounded-2xl border border-border bg-card overflow-hidden shadow-sm"
      data-testid={testId}
    >
      <div className="border-b border-border bg-accent/30 px-4 py-3">
        <h4 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">{title}</h4>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm min-w-[640px]">
          <thead className="bg-muted/40 border-b border-border">
            <tr>
              {headers.map((h) => (
                <th key={h} className="p-3 font-semibold text-xs uppercase tracking-wide">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={headers.length} className="p-6 text-center text-muted-foreground">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              rows.map((cells, i) => (
                <tr key={i} className="hover:bg-accent/20">
                  {cells.map((cell, j) => (
                    <td key={j} className="p-3 align-middle">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function SalesOrdersIndicatorsDashboard() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(String(currentYear));
  const [month, setMonth] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [responsible, setResponsible] = useState("");
  const [payload, setPayload] = useState<SalesOrderMarginIndicatorsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportingInternal, setExportingInternal] = useState(false);

  const yearOptions = useMemo(() => buildSalesOrderYearOptions(currentYear), [currentYear]);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (year) params.set("year", year);
    if (month) params.set("month", month);
    if (customerId.trim()) params.set("customerId", customerId.trim());
    if (responsible.trim()) params.set("responsible", responsible.trim());
    return params.toString();
  }, [year, month, customerId, responsible]);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchJsonOk<SalesOrderMarginIndicatorsPayload>(
        getSalesOrderMarginIndicatorsApiPath(queryString),
        { signal }
      );
      setPayload(data);
    } catch (e) {
      if (signal?.aborted || (e instanceof DOMException && e.name === "AbortError")) return;
      setError(e instanceof Error ? e.message : "Erro ao carregar indicadores de margem.");
      setPayload(null);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [queryString]);

  useEffect(() => {
    const ac = new AbortController();
    void load(ac.signal);
    return () => ac.abort();
  }, [load]);

  const handleExportInternal = useCallback(async () => {
    setExportingInternal(true);
    try {
      await downloadInternalMarginExport(
        getSalesOrderIndicatorsInternalMarginExportUrl(queryString),
        "pedidos-venda-margem-interno-indicators.xlsx"
      );
    } catch {
      setError("Não foi possível exportar o relatório interno de margem.");
    } finally {
      setExportingInternal(false);
    }
  }, [queryString]);

  const summary = payload?.summary;
  const alerts = payload?.alerts;
  const marginSummaryPayload = summary as
    | import("@/src/lib/salesOrderMarginTypes").SalesOrderMarginSummaryPayload
    | undefined;
  const marginPartial = summary?.costCoverageStatus === "PARTIAL";
  const marginNone = summary?.costCoverageStatus === "NONE";
  const marginMoneySubtitle = marginPartial
    ? "Cobertura parcial de custos."
    : marginNone
      ? "Sem cobertura de custo no escopo."
      : undefined;

  const customerRows = useMemo(
    () =>
      (payload?.byCustomer ?? []).map((row) => [
        <span key="name" className="font-medium">{row.customerName}</span>,
        <span key="rev" className="tabular-nums">{formatCurrency(row.netRevenue)}</span>,
        <span key="cost" className="tabular-nums">{formatCurrency(row.totalCost)}</span>,
        <span key="margin" className="tabular-nums font-medium">{formatCurrency(row.marginValue)}</span>,
        <span key="pct" className="tabular-nums">{formatSalesOrderMarginPercent(row.marginPercent)}</span>,
        <span key="orders" className="tabular-nums">{row.ordersCount}</span>,
        <SalesOrderMarginStatusBadge key="status" label={row.statusLabel} status={row.status} />,
      ]),
    [payload?.byCustomer]
  );

  const sellerRows = useMemo(
    () =>
      (payload?.bySeller ?? []).map((row) => [
        <span key="name" className="font-medium">{row.sellerName}</span>,
        <span key="rev" className="tabular-nums">{formatCurrency(row.netRevenue)}</span>,
        <span key="cost" className="tabular-nums">{formatCurrency(row.totalCost)}</span>,
        <span key="margin" className="tabular-nums font-medium">{formatCurrency(row.marginValue)}</span>,
        <span key="pct" className="tabular-nums">{formatSalesOrderMarginPercent(row.marginPercent)}</span>,
        <span key="orders" className="tabular-nums">{row.ordersCount}</span>,
        <span key="customers" className="tabular-nums">{row.customersCount}</span>,
      ]),
    [payload?.bySeller]
  );

  const productRows = useMemo(
    () =>
      (payload?.byProduct ?? []).map((row) => [
        <div key="prod">
          <div className="font-medium">{row.productName}</div>
          <div className="text-xs text-muted-foreground font-mono">{row.sku}</div>
        </div>,
        <span key="qty" className="tabular-nums">{formatNumber(row.quantitySold, 2)}</span>,
        <span key="rev" className="tabular-nums">{formatCurrency(row.netRevenue)}</span>,
        <span key="margin" className="tabular-nums font-medium">{formatCurrency(row.marginValue)}</span>,
        <span key="pct" className="tabular-nums">{formatSalesOrderMarginPercent(row.marginPercent)}</span>,
        <span key="orders" className="tabular-nums">{row.ordersCount}</span>,
        <SalesOrderMarginStatusBadge key="status" label={row.statusLabel} status={row.status} />,
      ]),
    [payload?.byProduct]
  );

  if (error) {
    return (
      <ContextualDashboardLayout moduleLabel="Pedidos de venda — indicadores" backPath="/sales-orders">
        <p className="text-sm text-destructive" data-testid="sales-order-indicators-error">{error}</p>
      </ContextualDashboardLayout>
    );
  }

  return (
    <ContextualDashboardLayout moduleLabel="Pedidos de venda — indicadores" backPath="/sales-orders">
      <div>
        <h3 className="text-lg font-bold tracking-tight">Indicadores de margem</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Análise consolidada por período, cliente, vendedor e produto. Margem % ponderada por receita
          líquida.
        </p>
        {payload?.scopeNote ? (
          <p className="text-xs text-muted-foreground mt-2">{payload.scopeNote}</p>
        ) : null}
      </div>

      <div
        className="rounded-lg border border-amber-300/80 bg-amber-50/80 px-4 py-2 text-xs text-amber-950"
        data-testid="sales-order-internal-margin-disclaimer"
      >
        {SALES_ORDER_INTERNAL_MARGIN_REPORT_DISCLAIMER}
      </div>

      <div className="flex flex-wrap gap-3 items-end rounded-xl border border-border bg-card p-4">
        <label className="text-xs font-semibold">
          Ano
          <select
            className="mt-1 block rounded-lg border border-border bg-background px-3 py-2 text-sm"
            value={year}
            onChange={(e) => setYear(e.target.value)}
          >
            {yearOptions.map((y) => (
              <option key={y} value={String(y)}>{y}</option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold">
          Mês
          <select
            className="mt-1 block rounded-lg border border-border bg-background px-3 py-2 text-sm"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          >
            <option value="">Todos</option>
            {SALES_ORDER_MONTH_OPTIONS.map((m) => (
              <option key={m.value} value={String(m.value)}>{m.label}</option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold flex-1 min-w-[160px]">
          Cliente (ID)
          <input
            className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            placeholder="UUID do cliente"
          />
        </label>
        <label className="text-xs font-semibold flex-1 min-w-[160px]">
          Vendedor
          <input
            className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            value={responsible}
            onChange={(e) => setResponsible(e.target.value)}
            placeholder="Nome do vendedor"
          />
        </label>
        <button
          type="button"
          data-testid="sales-order-indicators-export-internal-margin"
          disabled={exportingInternal || loading}
          onClick={() => void handleExportInternal()}
          className="rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-sm font-medium hover:bg-primary/10 disabled:opacity-50"
        >
          {exportingInternal ? (
            <>
              <Loader2 className="inline h-4 w-4 animate-spin mr-1" />
              Exportando…
            </>
          ) : (
            <>
              <Download className="inline h-4 w-4 mr-1" />
              Excel interno (margem)
            </>
          )}
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground py-8">
          <Loader2 className="h-5 w-5 animate-spin" />
          Carregando indicadores…
        </div>
      ) : !summary || summary.ordersCount === 0 ? (
        <ContextualDashboardEmpty message="Não há pedidos no período/filtro para consolidar indicadores de margem." />
      ) : (
        <>
          <ExecutiveSummarySection
            title="Margem gerencial consolidada"
            eyebrow="Indicadores consolidados do filtro aplicado"
            testId="sales-order-margin-indicator-summary"
            actions={
              <SalesOrderMarginInfoTooltip
                summary={summary as import("@/src/lib/salesOrderMarginTypes").SalesOrderMarginSummaryPayload}
                testId="sales-order-indicators-margin-tooltip"
              />
            }
          >
            <SummaryKpiGrid
              minColumnWidth={168}
              className={SYSTEM_TOTALIZER_GRID_CLASS}
            >
              <SystemTotalizerCard
                className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
                testId="sales-order-margin-kpi-total-revenue"
                icon={DollarSign}
                label="Valor vendido (total)"
                amount={summary.totalSalesRevenueInScope}
                amountFormat="currency"
                tone="money"
                helperText="Soma do valor vendido no filtro aplicado."
              />
              <SystemTotalizerCard
                className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
                testId="sales-order-margin-kpi-revenue-covered"
                icon={Wallet}
                label="Receita com custo"
                amount={summary.marginRevenueCovered}
                amountFormat="currency"
                tone="info"
                subtitle={
                  marginPartial && summary.marginCoveragePercent != null
                    ? `${summary.marginCoveragePercent.toFixed(2)}% da receita vendida`
                    : undefined
                }
                helperText="Receita com custo de produção resolvido."
              />
              <SystemTotalizerCard
                className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
                testId="sales-order-margin-kpi-total-cost"
                icon={Scale}
                label="Custo estimado"
                amount={summary.totalCost}
                amountFormat="currency"
                tone="neutral"
                helperText="Custo de produção estimado no escopo."
              />
              <SystemTotalizerCard
                className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
                testId="sales-order-margin-kpi-margin-money"
                icon={DollarSign}
                label={resolveSalesOrderMarginMoneyLabel(summary)}
                amount={summary.marginValue}
                amountFormat="currency"
                tone={marginPartial || marginNone ? "warning" : "margin"}
                subtitle={marginMoneySubtitle}
                labelAccessory={
                  marginSummaryPayload ? (
                    <SalesOrderMarginInfoTooltip
                      summary={marginSummaryPayload}
                      testId="sales-order-margin-kpi-margin-money-tooltip"
                    />
                  ) : undefined
                }
                footer={
                  marginPartial ? (
                    <span
                      className="system-totalizer-badge system-totalizer-badge--warning"
                      data-testid="sales-order-margin-kpi-partial-badge"
                    >
                      Margem parcial
                    </span>
                  ) : undefined
                }
              />
              <SystemTotalizerCard
                className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
                testId="sales-order-margin-kpi-margin-percent"
                icon={Percent}
                label={resolveSalesOrderMarginPercentLabel(summary)}
                amount={summary.marginPercent}
                amountFormat="percent"
                tone={marginPartial || marginNone ? "warning" : "margin"}
                helperText="Ponderada por receita com custo."
              />
              <SystemTotalizerCard
                className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
                testId="sales-order-margin-kpi-markup"
                icon={TrendingUp}
                label="Markup"
                value={formatSalesOrderMarkup(summary.markup)}
                tone="neutral"
                helperText="Receita com custo ÷ custo estimado."
              />
              <SystemTotalizerCard
                className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
                testId="sales-order-margin-kpi-orders"
                icon={Package}
                label="Pedidos"
                amount={summary.ordersCount}
                amountFormat="number"
                tone="info"
                helperText="Pedidos no filtro aplicado."
              />
              <SystemTotalizerCard
                className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
                testId="sales-order-margin-kpi-negative-items"
                icon={TrendingDown}
                label="Itens margem negativa"
                amount={summary.itemsWithNegativeMargin}
                amountFormat="number"
                tone={summary.itemsWithNegativeMargin > 0 ? "danger" : "neutral"}
                helperText="Linhas com margem negativa no escopo."
              />
              <SystemTotalizerCard
                className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
                testId="sales-order-margin-kpi-missing-cost"
                icon={AlertTriangle}
                label="Itens sem custo"
                amount={summary.itemsWithoutCost}
                amountFormat="number"
                tone={summary.itemsWithoutCost > 0 ? "warning" : "neutral"}
                helperText="Linhas sem custo de produção resolvido."
              />
              <SystemTotalizerCard
                className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
                testId="sales-order-margin-kpi-missing-product"
                icon={Users}
                label="Itens sem produto"
                amount={summary.itemsWithoutProduct}
                amountFormat="number"
                tone={summary.itemsWithoutProduct > 0 ? "warning" : "neutral"}
                helperText="Linhas sem produto vinculado."
              />
            </SummaryKpiGrid>
          </ExecutiveSummarySection>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <RankingTable
              title="Ranking por cliente"
              testId="sales-order-margin-ranking-customer"
              headers={["Cliente", "Valor vendido", "Custo", "Margem R$", "Margem %", "Pedidos", "Status"]}
              rows={customerRows}
              emptyMessage="Nenhum cliente no filtro."
            />
            <RankingTable
              title="Ranking por vendedor"
              testId="sales-order-margin-ranking-seller"
              headers={["Vendedor", "Valor vendido", "Custo", "Margem R$", "Margem %", "Pedidos", "Clientes"]}
              rows={sellerRows}
              emptyMessage="Nenhum vendedor no filtro."
            />
          </div>

          <RankingTable
            title="Ranking por produto"
            testId="sales-order-margin-ranking-product"
            headers={["Produto", "Qtd vendida", "Valor vendido", "Margem R$", "Margem %", "Pedidos", "Status"]}
            rows={productRows}
            emptyMessage="Nenhum produto no filtro."
          />

          <div
            className="rounded-2xl border border-border bg-card p-4 space-y-4"
            data-testid="sales-order-margin-alerts"
          >
            <h4 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
              Alertas de revisão
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
              <AlertBlock
                title="Margem negativa"
                count={alerts?.negativeMarginItems.length ?? 0}
                tone="danger"
                items={alerts?.negativeMarginItems ?? []}
              />
              <AlertBlock
                title="Sem custo"
                count={alerts?.missingCostItems.length ?? 0}
                tone="warning"
                items={alerts?.missingCostItems ?? []}
              />
              <AlertBlock
                title="Sem produto vinculado"
                count={alerts?.missingProductItems.length ?? 0}
                tone="warning"
                items={alerts?.missingProductItems ?? []}
              />
            </div>
            {(alerts?.lowMarginCustomers.length ?? 0) > 0 ? (
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-2">Clientes com margem baixa</p>
                <ul className="text-sm space-y-1">
                  {alerts!.lowMarginCustomers.map((row) => (
                    <li key={row.key} className="flex justify-between gap-2">
                      <span>{row.name}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {formatSalesOrderMarginPercent(row.marginPercent)} · {formatCurrency(row.netRevenue)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {(alerts?.lowMarginProducts.length ?? 0) > 0 ? (
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-2">Produtos com margem baixa</p>
                <ul className="text-sm space-y-1">
                  {alerts!.lowMarginProducts.map((row) => (
                    <li key={row.key} className="flex justify-between gap-2">
                      <span>{row.name}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {formatSalesOrderMarginPercent(row.marginPercent)} · {formatCurrency(row.netRevenue)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </>
      )}
    </ContextualDashboardLayout>
  );
}

function AlertBlock({
  title,
  count,
  tone,
  items,
}: {
  title: string;
  count: number;
  tone: "danger" | "warning";
  items: Array<{ orderCode: string; productName: string; sku: string; statusLabel: string }>;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border p-3",
        tone === "danger"
          ? "border-red-200 bg-red-50/80 dark:border-red-900 dark:bg-red-950/20"
          : "border-amber-200 bg-amber-50/80 dark:border-amber-900 dark:bg-amber-950/20"
      )}
    >
      <p className="font-semibold">{title}</p>
      <p className="text-2xl font-bold tabular-nums mt-1">{count}</p>
      {items.length > 0 ? (
        <ul className="mt-2 space-y-1 text-xs text-muted-foreground max-h-32 overflow-y-auto">
          {items.slice(0, 5).map((item) => (
            <li key={`${item.orderCode}-${item.sku}`}>
              {item.orderCode} · {item.productName} ({item.sku})
            </li>
          ))}
          {items.length > 5 ? <li>+{items.length - 5} item(ns)</li> : null}
        </ul>
      ) : null}
    </div>
  );
}
