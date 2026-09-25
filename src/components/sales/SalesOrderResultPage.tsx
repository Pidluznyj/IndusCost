import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Info,
  Loader2,
  Package,
  Percent,
  Scale,
  Search,
  ShoppingBag,
  Wallet,
} from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { useAuth } from "@/src/contexts/AuthContext";
import { canViewSalesOrderModule, SALES_ORDER_LIST_STATUS_LABELS } from "@/src/lib/salesOrderListUi";
import { CustomerAutocompleteFilter } from "@/src/components/common/CustomerAutocompleteFilter";
import type { EntityAutocompleteSelection } from "@/src/lib/customerSearch";
import type { EntityAutocompleteSelection as ProductAutocompleteSelection } from "@/src/components/common/EntityAutocompleteFilter";
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
import { SalesOrderResultReceivableTermChart } from "@/src/components/sales/SalesOrderResultReceivableTermChart";
import { SalesOrderProductAutocompleteFilter } from "@/src/components/sales/SalesOrderProductAutocompleteFilter";
import { SalesOrderReceivableStatusMultiSelect } from "@/src/components/sales/SalesOrderReceivableStatusMultiSelect";
import {
  SALES_ORDER_FILTER_ACTION_BUTTON_CLASS,
  SALES_ORDER_FILTER_CONTROL_CLASS,
  SALES_ORDER_FILTER_LABEL_CLASS,
  SALES_ORDER_FILTER_PRIMARY_ACTION_CLASS,
} from "@/src/components/sales/salesOrderFilterBarStyles";
import { financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";
import { getSalesOrderSellerFilterOptionsUrl } from "@/src/lib/salesOrderListReportExportUi";
import type { SalesOrderSellerFilterOption } from "@/src/lib/salesOrderNomusSellerDisplay";
import { INVOICE_FILTER_OPTIONS } from "@/src/lib/salesOrderManagementUi";
import { getSalesOrderGrantedPaymentTermMonthlyUrl } from "@/src/lib/salesOrderGrantedPaymentTermApi";
import type { SalesOrderGrantedPaymentTermMonthlySeries } from "@/src/lib/salesOrderGrantedPaymentTerm";
import {
  buildInitialSalesOrderResultAppliedFilters,
  buildSalesOrderResultQueryString,
  hasPendingSalesOrderResultFilters,
  toSalesOrderResultApiFilters,
  type SalesOrderResultAppliedFilters,
} from "@/src/lib/salesOrderResultFilters";
import { cn } from "@/src/lib/utils";

function FilterLabel({ htmlFor, children }: { htmlFor?: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className={SALES_ORDER_FILTER_LABEL_CLASS}>
      {children}
    </label>
  );
}

function isAbortError(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof DOMException && error.name === "AbortError");
}

/**
 * Resultado de Pedidos de Venda.
 *
 * Filtros no padrão do sistema (igual à listagem): os controles só mudam o
 * rascunho; as consultas usam os filtros APLICADOS, que mudam apenas ao clicar
 * em Pesquisar (ou Limpar filtros). Vendedores e produtos vêm do servidor e
 * aparecem em dropdown. Cada consulta cancela a anterior (AbortController).
 */
export function SalesOrderResultPage() {
  const auth = useAuth();
  const canView = useMemo(() => canViewSalesOrderModule(auth), [auth]);
  const currentYear = useMemo(() => new Date().getFullYear(), []);
  const yearOptions = useMemo(() => buildSalesOrderYearOptions(currentYear, 5), [currentYear]);
  const asOfDate = useMemo(() => new Date().toISOString().slice(0, 10), []);

  // Rascunho — só vira consulta ao clicar em Pesquisar.
  const [year, setYear] = useState(() => String(currentYear));
  const [month, setMonth] = useState("");
  const [status, setStatus] = useState("");
  const [hasInvoice, setHasInvoice] = useState("");
  const [receivableStatus, setReceivableStatus] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [customerSelection, setCustomerSelection] = useState<EntityAutocompleteSelection | null>(
    null
  );
  const [sellerKey, setSellerKey] = useState("");
  const [productId, setProductId] = useState("");
  const [productSelection, setProductSelection] = useState<ProductAutocompleteSelection | null>(
    null
  );

  // Filtros aplicados — única fonte das consultas.
  const [applied, setApplied] = useState<SalesOrderResultAppliedFilters>(() =>
    buildInitialSalesOrderResultAppliedFilters(currentYear)
  );

  const [sellerFilterOptions, setSellerFilterOptions] = useState<SalesOrderSellerFilterOption[]>(
    []
  );
  const [sellerOptionsLoading, setSellerOptionsLoading] = useState(false);
  const [payload, setPayload] = useState<SalesOrderResultDashboardPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [termSeries, setTermSeries] = useState<SalesOrderGrantedPaymentTermMonthlySeries | null>(
    null
  );
  const [termLoading, setTermLoading] = useState(false);
  const [termError, setTermError] = useState<string | null>(null);
  const [showTooltip, setShowTooltip] = useState(false);

  const draft = useMemo<SalesOrderResultAppliedFilters>(
    () => ({
      year,
      month,
      status,
      hasInvoice,
      receivableStatus,
      customerId,
      sellerKey,
      productId,
    }),
    [year, month, status, hasInvoice, receivableStatus, customerId, sellerKey, productId]
  );
  const filtersPending = hasPendingSalesOrderResultFilters(draft, applied);

  const applyFilters = useCallback(() => {
    // Objeto novo a cada clique: Pesquisar sempre recarrega, mesmo sem mudança.
    setApplied({ ...draft });
  }, [draft]);

  const clearFilters = useCallback(() => {
    const initial = buildInitialSalesOrderResultAppliedFilters(currentYear);
    setYear(initial.year);
    setMonth("");
    setStatus("");
    setHasInvoice("");
    setReceivableStatus("");
    setCustomerId("");
    setCustomerSelection(null);
    setSellerKey("");
    setProductId("");
    setProductSelection(null);
    setApplied(initial);
  }, [currentYear]);

  // Vendedores do dropdown: população APLICADA sem o próprio vendedor (padrão da listagem).
  const sellerOptionsQuery = useMemo(
    () => buildSalesOrderResultQueryString(applied, { includeSeller: false, includeProduct: false }),
    [applied]
  );
  useEffect(() => {
    if (!canView) return;
    const ac = new AbortController();
    setSellerOptionsLoading(true);
    void fetchJsonOk<{ options?: SalesOrderSellerFilterOption[] }>(
      getSalesOrderSellerFilterOptionsUrl(sellerOptionsQuery),
      { signal: ac.signal }
    )
      .then((res) => {
        if (!ac.signal.aborted) setSellerFilterOptions(Array.isArray(res.options) ? res.options : []);
      })
      .catch((e: unknown) => {
        if (isAbortError(e, ac.signal)) return;
        setSellerFilterOptions([]);
      })
      .finally(() => {
        if (!ac.signal.aborted) setSellerOptionsLoading(false);
      });
    return () => ac.abort();
  }, [canView, sellerOptionsQuery]);

  // Resultado (KPIs + gráficos de margem e projeção) — só com filtros aplicados.
  useEffect(() => {
    if (!canView) return;
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    void fetchJsonOk<SalesOrderResultDashboardPayload>(
      getSalesOrderResultApiPath(toSalesOrderResultApiFilters(applied, asOfDate)),
      { signal: ac.signal }
    )
      .then((data) => {
        if (!ac.signal.aborted) setPayload(data);
      })
      .catch((e: unknown) => {
        if (isAbortError(e, ac.signal)) return;
        setError(e instanceof Error ? e.message : "Erro ao carregar resultado.");
        setPayload(null);
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [canView, applied, asOfDate]);

  // Prazo médio de recebimento mês a mês — endpoint leve e independente (fail-soft).
  useEffect(() => {
    if (!canView) return;
    const ac = new AbortController();
    setTermLoading(true);
    setTermError(null);
    void fetchJsonOk<{ paymentTermMonthly?: SalesOrderGrantedPaymentTermMonthlySeries }>(
      getSalesOrderGrantedPaymentTermMonthlyUrl(
        buildSalesOrderResultQueryString(applied, { includeMonth: false })
      ),
      { signal: ac.signal }
    )
      .then((data) => {
        if (!ac.signal.aborted) setTermSeries(data.paymentTermMonthly ?? null);
      })
      .catch((e: unknown) => {
        if (isAbortError(e, ac.signal)) return;
        console.error(e);
        setTermError("Não foi possível carregar o prazo médio de recebimento mês a mês.");
        setTermSeries(null);
      })
      .finally(() => {
        if (!ac.signal.aborted) setTermLoading(false);
      });
    return () => ac.abort();
  }, [canView, applied]);

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

      <form
        className="space-y-3 rounded-xl border border-border bg-card/60 p-3 shadow-sm"
        data-testid="sales-order-result-filters"
        onSubmit={(e) => {
          e.preventDefault();
          applyFilters();
        }}
      >
        <div className="grid grid-cols-12 gap-2">
          {/* Linha 1: período + status + NF + CR */}
          <div className="col-span-6 sm:col-span-3 lg:col-span-2">
            <FilterLabel htmlFor="sales-order-result-filter-year">Ano</FilterLabel>
            <select
              id="sales-order-result-filter-year"
              className={SALES_ORDER_FILTER_CONTROL_CLASS}
              value={year}
              onChange={(e) => setYear(e.target.value)}
              aria-label="Filtrar por ano de emissão"
              data-testid="sales-order-result-filter-year"
            >
              {yearOptions.map((y) => (
                <option key={y} value={String(y)}>
                  {y}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-6 sm:col-span-3 lg:col-span-2">
            <FilterLabel htmlFor="sales-order-result-filter-month">Mês</FilterLabel>
            <select
              id="sales-order-result-filter-month"
              className={SALES_ORDER_FILTER_CONTROL_CLASS}
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              aria-label="Filtrar por mês de emissão"
              data-testid="sales-order-result-filter-month"
            >
              <option value="">Todos os meses</option>
              {SALES_ORDER_MONTH_OPTIONS.map((m) => (
                <option key={m.value} value={String(m.value)}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-6 sm:col-span-3 lg:col-span-2">
            <FilterLabel htmlFor="sales-order-result-filter-status">Status</FilterLabel>
            <select
              id="sales-order-result-filter-status"
              className={SALES_ORDER_FILTER_CONTROL_CLASS}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              data-testid="sales-order-result-filter-status"
            >
              <option value="">Todos</option>
              {Object.entries(SALES_ORDER_LIST_STATUS_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-6 sm:col-span-3 lg:col-span-2">
            <FilterLabel htmlFor="sales-order-result-filter-has-invoice">Vínculo NF</FilterLabel>
            <select
              id="sales-order-result-filter-has-invoice"
              className={SALES_ORDER_FILTER_CONTROL_CLASS}
              value={hasInvoice}
              onChange={(e) => setHasInvoice(e.target.value)}
              aria-label="Filtrar por vínculo de NF"
              data-testid="sales-order-result-filter-has-invoice"
            >
              {INVOICE_FILTER_OPTIONS.map((o) => (
                <option key={o.value || "all"} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div
            className="col-span-12 sm:col-span-6 lg:col-span-4"
            data-testid="sales-order-result-filter-receivable"
          >
            <FilterLabel htmlFor="sales-order-result-filter-receivable-status">Status CR</FilterLabel>
            <SalesOrderReceivableStatusMultiSelect
              value={receivableStatus}
              onChange={setReceivableStatus}
              controlClassName={SALES_ORDER_FILTER_CONTROL_CLASS}
            />
          </div>

          {/* Linha 2: cliente + vendedor + produto (dropdowns com dados do servidor) */}
          <div className="col-span-12 sm:col-span-6 lg:col-span-4">
            <CustomerAutocompleteFilter
              label="Cliente"
              value={customerSelection}
              placeholder="Todos os clientes"
              onChange={(sel) => {
                setCustomerSelection(sel);
                setCustomerId(sel?.id ?? "");
              }}
              onClear={() => {
                setCustomerSelection(null);
                setCustomerId("");
              }}
            />
          </div>
          <div className="col-span-12 sm:col-span-6 lg:col-span-4">
            <FilterLabel htmlFor="sales-order-result-filter-seller">Vendedor</FilterLabel>
            <select
              id="sales-order-result-filter-seller"
              className={SALES_ORDER_FILTER_CONTROL_CLASS}
              value={sellerKey}
              onChange={(e) => setSellerKey(e.target.value)}
              disabled={sellerOptionsLoading}
              aria-label="Filtrar por vendedor Nomus"
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
          </div>
          <div className="col-span-12 lg:col-span-4" data-testid="sales-order-result-filter-product">
            <SalesOrderProductAutocompleteFilter
              value={productSelection}
              onChange={(sel) => {
                setProductSelection(sel);
                setProductId(sel?.id ?? "");
              }}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-1 border-t border-border/70 pt-2">
          {filtersPending ? (
            <span
              className="mr-auto text-[11px] text-muted-foreground"
              data-testid="sales-order-result-filters-pending"
            >
              Filtros alterados — clique em Pesquisar para atualizar.
            </span>
          ) : null}
          <button
            type="button"
            onClick={clearFilters}
            className={SALES_ORDER_FILTER_ACTION_BUTTON_CLASS}
            data-testid="sales-order-result-clear-filters"
          >
            Limpar filtros
          </button>
          <button
            type="submit"
            className={cn(SALES_ORDER_FILTER_ACTION_BUTTON_CLASS, SALES_ORDER_FILTER_PRIMARY_ACTION_CLASS)}
            data-testid="sales-order-result-apply-filters"
          >
            <Search className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Pesquisar</span>
          </button>
        </div>
      </form>

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
                helperText="Margem comercial — mesma regra da listagem de Pedidos de Venda."
                loading={loading}
              />
              <SystemTotalizerCard
                className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
                label="% Margem"
                amount={totals.marginPercent}
                amountFormat="percent"
                tone={metricVariantToTotalizerTone(resolveMarginPercentVariant(totals.marginPercent))}
                icon={Percent}
                helperText="Margem comercial ponderada — mesma regra da listagem de Pedidos de Venda."
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
        </>
      ) : null}

      <SalesOrderResultReceivableTermChart
        series={termSeries}
        loading={termLoading}
        error={termError}
      />

      {payload ? <SalesOrderResultMonthlyMarginChart rows={payload.monthlyMargin} /> : null}
      {payload ? (
        <SalesOrderResultProjectionChart
          rows={payload.realizedVsProjected}
          projection={payload.projection}
        />
      ) : null}
    </div>
  );
}
