import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Info, Loader2, Package, Percent, Scale, ShoppingBag, Wallet } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { useAuth } from "@/src/contexts/AuthContext";
import { canViewSalesOrderModule } from "@/src/lib/salesOrderListUi";
import { CustomerAutocompleteFilter } from "@/src/components/common/CustomerAutocompleteFilter";
import type { EntityAutocompleteSelection } from "@/src/lib/customerSearch";
import {
  buildSalesOrderYearOptions,
  SALES_ORDER_MONTH_OPTIONS,
} from "@/src/lib/salesOrderPeriodFilter";
import { getSalesOrderResultApiPath } from "@/src/lib/salesOrderResultApi";
import type { SalesOrderResultDashboardPayload } from "@/src/lib/salesOrderResultTypes";
import { buildSalesOrderResultTotalsMarginTooltipText } from "@/src/lib/salesOrderMarginDisplay";
import {
  metricVariantToTotalizerTone,
  resolveMarginMoneyVariant,
  resolveMarginPercentVariant,
} from "@/src/lib/salesOrderManagementMetricCards";
import {
  SYSTEM_TOTALIZER_GRID_CLASS,
  SYSTEM_TOTALIZER_METRIC_CARD_CLASS,
  SystemTotalizerCard,
} from "@/src/components/ui/SystemTotalizerCard";
import { ExecutiveSummarySection } from "@/src/components/ui/ExecutiveSummarySection";
import { SummaryKpiGrid } from "@/src/components/ui/SummaryKpiGrid";
import { SalesOrderResultMonthlyMarginChart } from "@/src/components/sales/SalesOrderResultMonthlyMarginChart";
import { SalesOrderResultProjectionChart } from "@/src/components/sales/SalesOrderResultProjectionChart";
import { financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";
import { getSalesOrderSellerFilterOptionsUrl } from "@/src/lib/salesOrderListReportExportUi";
import type { SalesOrderSellerFilterOption } from "@/src/lib/salesOrderNomusSellerDisplay";
import { INVOICE_FILTER_OPTIONS } from "@/src/lib/salesOrderManagementUi";
import { RECEIVABLE_STATUS_FILTER_OPTIONS } from "@/src/lib/salesOrderListReceivableFilter";
import { SALES_ORDER_STATUS_LABELS } from "@/src/lib/materialDemandFilters";

const FILTER_CONTROL =
  "mt-1 w-full rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm";

export function SalesOrderResultPage() {
  const auth = useAuth();
  const canView = useMemo(() => canViewSalesOrderModule(auth), [auth]);
  const currentYear = useMemo(() => new Date().getFullYear(), []);
  const yearOptions = useMemo(() => buildSalesOrderYearOptions(currentYear, 5), [currentYear]);

  const [year, setYear] = useState(currentYear);
  const [month, setMonth] = useState<number | "">("");
  const [customerId, setCustomerId] = useState("");
  const [customerSelection, setCustomerSelection] = useState<EntityAutocompleteSelection | null>(
    null
  );
  const [productQuery, setProductQuery] = useState("");
  const [sellerKey, setSellerKey] = useState("");
  const [status, setStatus] = useState("");
  const [hasInvoice, setHasInvoice] = useState("");
  const [receivableStatus, setReceivableStatus] = useState("");
  const [sellerFilterOptions, setSellerFilterOptions] = useState<SalesOrderSellerFilterOption[]>(
    []
  );
  const [sellerOptionsLoading, setSellerOptionsLoading] = useState(false);
  const [payload, setPayload] = useState<SalesOrderResultDashboardPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTooltip, setShowTooltip] = useState(false);

  const asOfDate = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const listFilterQuery = useMemo(() => {
    const params = new URLSearchParams();
    params.set("year", String(year));
    if (month !== "") params.set("month", String(month));
    if (customerId) params.set("customerId", customerId);
    if (sellerKey) params.set("sellerKey", sellerKey);
    if (status) params.set("status", status);
    if (hasInvoice) params.set("hasInvoice", hasInvoice);
    if (receivableStatus) params.set("receivableStatus", receivableStatus);
    return params.toString();
  }, [year, month, customerId, sellerKey, status, hasInvoice, receivableStatus]);

  useEffect(() => {
    let cancelled = false;
    setSellerOptionsLoading(true);
    void fetchJsonOk<{ options?: SalesOrderSellerFilterOption[] }>(
      getSalesOrderSellerFilterOptionsUrl(listFilterQuery)
    )
      .then((res) => {
        if (cancelled) return;
        setSellerFilterOptions(Array.isArray(res.options) ? res.options : []);
      })
      .catch(() => {
        if (!cancelled) setSellerFilterOptions([]);
      })
      .finally(() => {
        if (!cancelled) setSellerOptionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [listFilterQuery]);

  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    setError(null);
    try {
      const path = getSalesOrderResultApiPath({
        year,
        month: month === "" ? undefined : month,
        customerId: customerId || undefined,
        productId: productQuery.trim() || undefined,
        sellerKey: sellerKey || undefined,
        status: status || undefined,
        hasInvoice: hasInvoice || undefined,
        receivableStatus: receivableStatus || undefined,
        asOfDate,
      });
      const data = await fetchJsonOk<SalesOrderResultDashboardPayload>(path);
      setPayload(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao carregar resultado.");
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }, [
    canView,
    year,
    month,
    customerId,
    productQuery,
    sellerKey,
    status,
    hasInvoice,
    receivableStatus,
    asOfDate,
  ]);

  useEffect(() => {
    void load();
  }, [load]);

  const marginTooltipText = useMemo(() => {
    const totals = payload?.totals;
    if (!totals) return null;
    return buildSalesOrderResultTotalsMarginTooltipText(totals, payload?.warnings);
  }, [payload]);

  if (!canView) {
    return (
      <div className={`${financeBiCardClass} p-8 text-center`} data-testid="sales-order-result-denied">
        <p className="text-sm font-semibold text-[#111827]">Acesso restrito</p>
        <p className="text-sm text-[#6B7280] mt-1">
          A aba Resultado exige permissão para visualizar Pedidos de Venda.
        </p>
      </div>
    );
  }

  const totals = payload?.totals;
  const warnings = payload?.warnings;

  return (
    <div className="space-y-6" data-testid="sales-order-result-page">
      <div>
        <h2 className="text-lg font-bold text-[#111827]">Resultado de Pedidos de Venda</h2>
        <p className="text-sm text-[#6B7280] mt-1">
          Mesmo escopo e motores oficiais da listagem Comercial &gt; Pedidos de Venda (valor do
          pedido, custo versionado e margem gerencial).
        </p>
      </div>

      <div className={`${financeBiCardClass} p-4`} data-testid="sales-order-result-filters">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          <label className="text-xs font-semibold text-[#374151]">
            Ano
            <select
              className={FILTER_CONTROL}
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              data-testid="sales-order-result-filter-year"
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold text-[#374151]">
            Mês
            <select
              className={FILTER_CONTROL}
              value={month}
              onChange={(e) => setMonth(e.target.value === "" ? "" : Number(e.target.value))}
              data-testid="sales-order-result-filter-month"
            >
              <option value="">Todos</option>
              {SALES_ORDER_MONTH_OPTIONS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold text-[#374151]">
            Situação
            <select
              className={FILTER_CONTROL}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              data-testid="sales-order-result-filter-status"
            >
              <option value="">Todos</option>
              {Object.entries(SALES_ORDER_STATUS_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold text-[#374151]">
            Vínculo NF
            <select
              className={FILTER_CONTROL}
              value={hasInvoice}
              onChange={(e) => setHasInvoice(e.target.value)}
              data-testid="sales-order-result-filter-has-invoice"
            >
              {INVOICE_FILTER_OPTIONS.map((o) => (
                <option key={o.value || "all"} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <div className="lg:col-span-2">
            <CustomerAutocompleteFilter
              label="Cliente"
              value={customerSelection}
              onChange={(sel) => {
                setCustomerSelection(sel);
                setCustomerId(sel?.id ?? "");
              }}
            />
          </div>
          <label className="text-xs font-semibold text-[#374151]">
            Vendedor
            <select
              className={FILTER_CONTROL}
              value={sellerKey}
              onChange={(e) => setSellerKey(e.target.value)}
              disabled={sellerOptionsLoading}
              data-testid="sales-order-result-filter-seller"
            >
              <option value="">Todos os vendedores</option>
              {sellerFilterOptions.map((option) => (
                <option key={option.sellerKey} value={option.sellerKey}>
                  {option.label}
                  {option.orderCount > 0 ? ` (${option.orderCount})` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold text-[#374151]">
            Status CR
            <select
              className={FILTER_CONTROL}
              value={receivableStatus}
              onChange={(e) => setReceivableStatus(e.target.value)}
              data-testid="sales-order-result-filter-receivable"
            >
              {RECEIVABLE_STATUS_FILTER_OPTIONS.map((o) => (
                <option key={o.value || "all"} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold text-[#374151] lg:col-span-2">
            Produto (ID opcional)
            <input
              className={FILTER_CONTROL}
              value={productQuery}
              onChange={(e) => setProductQuery(e.target.value)}
              placeholder="UUID do produto (filtro adicional)"
              data-testid="sales-order-result-filter-product"
            />
          </label>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {loading && !payload ? (
        <div
          className="flex items-center justify-center gap-2 py-16 text-sm text-[#6B7280]"
          data-testid="sales-order-result-loading"
        >
          <Loader2 className="h-5 w-5 animate-spin" />
          Carregando resultado…
        </div>
      ) : null}

      {totals ? (
        <>
          <ExecutiveSummarySection
            title="Resumo do resultado"
            eyebrow="Totais do mesmo universo filtrado da listagem de Pedidos"
            testId="sales-order-result-kpi-summary"
            actions={
              <button
                type="button"
                className="shrink-0 rounded-lg border border-[#E5E7EB] p-2 text-[#6B7280] hover:bg-[#F9FAFB]"
                aria-label="Explicação da margem"
                onClick={() => setShowTooltip((v) => !v)}
              >
                <Info className="h-4 w-4" />
              </button>
            }
          >
            <SummaryKpiGrid
              minColumnWidth={168}
              className={SYSTEM_TOTALIZER_GRID_CLASS}
              testId="sales-order-result-kpis"
            >
              <SystemTotalizerCard
                className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
                label="R$ Pedidos"
                amount={totals.salesAmount}
                amountFormat="currency"
                tone="money"
                icon={ShoppingBag}
                helperText="Σ totalNetValue oficial dos pedidos no filtro (motor de pedidos)."
                loading={loading}
              />
              <SystemTotalizerCard
                className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
                label="R$ Custo"
                amount={totals.costAmount}
                amountFormat="currency"
                tone="internal"
                icon={Package}
                helperText="Custo versionado vigente na data de emissão do pedido."
                loading={loading}
              />
              <SystemTotalizerCard
                className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
                label="R$ Margem"
                amount={totals.marginAmount}
                amountFormat="currency"
                tone={metricVariantToTotalizerTone(resolveMarginMoneyVariant(totals.marginAmount))}
                icon={Wallet}
                helperText="Margem gerencial oficial (após imposto TaxRule − custo versionado)."
                loading={loading}
              />
              <SystemTotalizerCard
                className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
                label="% Margem"
                amount={totals.marginPercent}
                amountFormat="percent"
                tone={metricVariantToTotalizerTone(resolveMarginPercentVariant(totals.marginPercent))}
                icon={Percent}
                helperText="Margem ponderada por receita líquida gerencial."
                loading={loading}
              />
              <SystemTotalizerCard
                className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
                label="Margem média/un."
                amount={totals.averageUnitMargin}
                amountFormat="currency"
                tone="neutral"
                icon={Scale}
                helperText="Margem média por item válido no filtro."
                loading={loading}
              />
              <SystemTotalizerCard
                className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
                label="Qtde Pedidos"
                amount={totals.ordersCount}
                amountFormat="number"
                tone="info"
                icon={ShoppingBag}
                helperText="Quantidade de pedidos no mesmo escopo da listagem."
                loading={loading}
              />
            </SummaryKpiGrid>
          </ExecutiveSummarySection>

          {showTooltip && marginTooltipText ? (
            <div
              className={`${financeBiCardClass} p-4 text-sm text-[#374151]`}
              data-testid="sales-order-result-margin-tooltip"
            >
              <pre className="whitespace-pre-line font-sans text-sm">{marginTooltipText}</pre>
            </div>
          ) : null}

          {(warnings?.missingCostCount ?? 0) > 0 ||
          (warnings?.missingProductCount ?? 0) > 0 ||
          (warnings?.negativeMarginCount ?? 0) > 0 ? (
            <div
              className={`${financeBiCardClass} p-4 flex flex-wrap gap-4 text-sm`}
              data-testid="sales-order-result-alerts"
            >
              {(warnings?.negativeMarginCount ?? 0) > 0 ? (
                <span className="inline-flex items-center gap-1 text-red-700">
                  <AlertTriangle className="h-4 w-4" />
                  {warnings!.negativeMarginCount} item(ns) com margem negativa
                </span>
              ) : null}
              {(warnings?.missingCostCount ?? 0) > 0 ? (
                <span className="inline-flex items-center gap-1 text-amber-700">
                  <AlertTriangle className="h-4 w-4" />
                  {warnings!.missingCostCount} item(ns) sem custo
                </span>
              ) : null}
              {(warnings?.missingProductCount ?? 0) > 0 ? (
                <span className="inline-flex items-center gap-1 text-amber-700">
                  <AlertTriangle className="h-4 w-4" />
                  {warnings!.missingProductCount} item(ns) sem produto vinculado
                </span>
              ) : null}
            </div>
          ) : null}

          {payload ? <SalesOrderResultMonthlyMarginChart rows={payload.monthlyMargin} /> : null}
          {payload ? (
            <SalesOrderResultProjectionChart
              rows={payload.realizedVsProjected}
              projection={payload.projection}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
