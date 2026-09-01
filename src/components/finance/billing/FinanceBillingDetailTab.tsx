/*
 * Reuso deliberado do padrão visual do Grid Analítico de Títulos
 * (Financeiro > Contas a Receber > Títulos): mesmas classes globais da folha
 * abaixo, mesmo card de filtros, mesma paginação. Nada é alterado em Contas a
 * Receber — esta subaba apenas consome o mesmo CSS já publicado.
 */
import "@/src/components/finance/finance-ar-analytical-titles-table.css";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, RotateCcw } from "lucide-react";
import { CustomerAutocompleteFilter } from "@/src/components/common/CustomerAutocompleteFilter";
import {
  FinanceArErrorBanner,
  FinanceArLoadingBlock,
} from "@/src/components/finance/FinanceAccountsReceivableUiShared";
import { financePersonFieldsFromSelection } from "@/src/lib/customerSearch";
import {
  buildFinanceBillingYearOptions,
} from "@/src/lib/financeBillingDashboardTypes";
import { FINANCE_BILLING_MONTH_OPTIONS } from "@/src/lib/financeBillingNfeFiltersTypes";
import {
  buildFinanceBillingDetailOrdersQuery,
  createDefaultFinanceBillingDetailFilters,
  FINANCE_BILLING_DETAIL_ORDERS_ENDPOINT,
  FINANCE_BILLING_DETAIL_PAGE_SIZE_OPTIONS,
  FINANCE_BILLING_DETAIL_SCOPE_NOTE,
  FINANCE_BILLING_DETAIL_SORT_OPTIONS,
  normalizeFinanceBillingDetailFilters,
  type FinanceBillingDetailOrderItem,
  type FinanceBillingDetailOrdersPayload,
  type FinanceBillingDetailSortBy,
  type FinanceBillingDetailSortDir,
  type FinanceBillingDetailUiFilters,
} from "@/src/lib/finance/financeBillingDetailOrders";
import {
  displayFinanceText,
  formatFinanceDate,
  formatFinanceInteger,
} from "@/src/lib/financeAccountsReceivableFormat";
import { buildFinanceTabLoadError } from "@/src/lib/financeTabLoadError";
import { fetchUiSessionCachedJson } from "@/src/lib/uiSessionGetCache";

/** Mesmo modal canônico de Comercial > Pedidos de venda (carregado sob demanda). */
const SalesOrderDetailDialog = React.lazy(() =>
  import("@/src/components/sales/SalesOrderDetailDialog").then((mod) => ({
    default: mod.SalesOrderDetailDialog,
  }))
);

const MAX_CHIPS = 4;

function RefChips({
  values,
  emptyLabel,
  testId,
}: {
  values: string[];
  emptyLabel: string;
  testId?: string;
}) {
  if (values.length === 0) {
    return <span className="ar-cell-meta">{emptyLabel}</span>;
  }
  const visible = values.slice(0, MAX_CHIPS);
  const hidden = values.length - visible.length;
  return (
    <div className="flex flex-wrap gap-1" data-testid={testId} title={values.join(" · ")}>
      {visible.map((value, index) => (
        // Índice no key: dois documentos podem exibir o mesmo número comercial.
        <span key={`${value}#${index}`} className="ar-kind-badge ar-kind-badge--cr">
          {value}
        </span>
      ))}
      {hidden > 0 ? (
        <span className="ar-kind-badge ar-kind-badge--residual">+{hidden}</span>
      ) : null}
    </div>
  );
}

function invoiceChipLabel(
  invoice: FinanceBillingDetailOrderItem["invoices"][number]
): string {
  const number = invoice.number?.trim();
  if (!number) return `#${invoice.nfeExternalId}`;
  return invoice.serie?.trim() ? `${number}/${invoice.serie.trim()}` : number;
}

export function FinanceBillingDetailTab() {
  const yearOptions = useMemo(() => buildFinanceBillingYearOptions(), []);

  const [draftFilters, setDraftFilters] = useState<FinanceBillingDetailUiFilters>(
    () => createDefaultFinanceBillingDetailFilters()
  );
  const [appliedFilters, setAppliedFilters] =
    useState<FinanceBillingDetailUiFilters>(() =>
      createDefaultFinanceBillingDetailFilters()
    );
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [sortBy, setSortBy] = useState<FinanceBillingDetailSortBy>("invoiceDate");
  const [sortDir, setSortDir] = useState<FinanceBillingDetailSortDir>("desc");
  const [data, setData] = useState<FinanceBillingDetailOrdersPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailOrderId, setDetailOrderId] = useState<string | null>(null);
  const [detailOrderCode, setDetailOrderCode] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const query = useMemo(
    () =>
      buildFinanceBillingDetailOrdersQuery(appliedFilters, {
        page,
        pageSize,
        sortBy,
        sortDir,
      }),
    [appliedFilters, page, pageSize, sortBy, sortDir]
  );

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchUiSessionCachedJson<FinanceBillingDetailOrdersPayload>(
        `${FINANCE_BILLING_DETAIL_ORDERS_ENDPOINT}?${query}`,
        { signal: controller.signal }
      );
      if (controller.signal.aborted) return;
      setData(payload);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      console.error("FinanceBillingDetailTab.load", e);
      setData(null);
      setError(
        buildFinanceTabLoadError(
          "Não foi possível carregar os pedidos faturados. Tente novamente.",
          e
        )
      );
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load]);

  const handleApplyFilters = () => {
    const normalized = normalizeFinanceBillingDetailFilters(draftFilters);
    setDraftFilters(normalized);
    setAppliedFilters(normalized);
    setPage(1);
  };

  const handleClearFilters = () => {
    const defaults = createDefaultFinanceBillingDetailFilters();
    setDraftFilters(defaults);
    setAppliedFilters(defaults);
    setPage(1);
  };

  const openOrderDetail = useCallback((salesOrderId: string, code: string | null) => {
    setDetailOrderId(salesOrderId);
    setDetailOrderCode(code);
  }, []);

  const closeOrderDetail = useCallback(() => {
    setDetailOrderId(null);
    setDetailOrderCode(null);
  }, []);

  const items = data?.items ?? [];
  const initialLoad = loading && !data && !error;
  const totalItems = data?.pagination.totalItems ?? 0;
  const totalPages = data?.pagination.totalPages ?? 1;
  const currentPage = data?.pagination.page ?? page;

  return (
    <div className="space-y-4" data-testid="finance-billing-detail-tab">
      <div className="rounded-2xl border border-border/70 bg-card p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-[#111827]">
              Pedidos de Venda faturados
            </h2>
            <p className="text-[11px] text-[#6B7280] mt-0.5">
              {FINANCE_BILLING_DETAIL_SCOPE_NOTE}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleClearFilters}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-semibold hover:bg-accent"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Limpar filtros
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          <label className="space-y-1">
            <span className="text-[10px] font-bold uppercase text-muted-foreground">
              Ano
            </span>
            <select
              value={draftFilters.year}
              onChange={(e) =>
                setDraftFilters((p) => ({ ...p, year: e.target.value }))
              }
              className="w-full h-9 rounded-lg border border-border bg-background px-2.5 text-sm"
              data-testid="finance-billing-detail-filter-year"
            >
              {yearOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1">
            <span className="text-[10px] font-bold uppercase text-muted-foreground">
              Mês
            </span>
            <select
              value={draftFilters.month}
              onChange={(e) =>
                setDraftFilters((p) => ({ ...p, month: e.target.value }))
              }
              className="w-full h-9 rounded-lg border border-border bg-background px-2.5 text-sm"
              data-testid="finance-billing-detail-filter-month"
            >
              {FINANCE_BILLING_MONTH_OPTIONS.map((o) => (
                <option key={o.value || "all"} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <CustomerAutocompleteFilter
            label="Cliente"
            personName={draftFilters.customerName}
            personCnpj={draftFilters.customerDocument}
            customerId={draftFilters.customerId}
            onChange={(selection) => {
              // `customerId` aqui é o UUID IndusCost do Customer (o mesmo que a
              // busca `/api/customers/search` devolve em `id`).
              const fields = financePersonFieldsFromSelection(selection);
              setDraftFilters((p) => ({
                ...p,
                customerName: fields.personName,
                customerDocument: fields.personCnpj,
                customerId: fields.customerId,
              }));
            }}
            onClear={() => {
              setDraftFilters((p) => ({
                ...p,
                customerName: "",
                customerDocument: "",
                customerId: "",
              }));
            }}
          />

          <label className="space-y-1">
            <span className="text-[10px] font-bold uppercase text-muted-foreground">
              Pedido de venda
            </span>
            <input
              value={draftFilters.salesOrder}
              onChange={(e) =>
                setDraftFilters((p) => ({ ...p, salesOrder: e.target.value }))
              }
              placeholder="Ex.: PD 02716 ou 2716"
              className="w-full h-9 rounded-lg border border-border bg-background px-2.5 text-sm"
              data-testid="finance-billing-detail-filter-sales-order"
            />
          </label>

          <label className="space-y-1">
            <span className="text-[10px] font-bold uppercase text-muted-foreground">
              Documento de saída
            </span>
            <input
              value={draftFilters.outputDocument}
              onChange={(e) =>
                setDraftFilters((p) => ({ ...p, outputDocument: e.target.value }))
              }
              placeholder="Número do documento"
              className="w-full h-9 rounded-lg border border-border bg-background px-2.5 text-sm"
              data-testid="finance-billing-detail-filter-output-document"
            />
          </label>

          <label className="space-y-1">
            <span className="text-[10px] font-bold uppercase text-muted-foreground">
              NF
            </span>
            <input
              value={draftFilters.invoice}
              onChange={(e) =>
                setDraftFilters((p) => ({ ...p, invoice: e.target.value }))
              }
              placeholder="Número da nota fiscal"
              className="w-full h-9 rounded-lg border border-border bg-background px-2.5 text-sm"
              data-testid="finance-billing-detail-filter-invoice"
            />
          </label>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleApplyFilters}
            className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
            data-testid="finance-billing-detail-apply-filters"
          >
            Aplicar filtros
          </button>
        </div>
      </div>

      {error ? (
        <FinanceArErrorBanner message={error} onDismiss={() => setError(null)} />
      ) : null}

      <div className="flex flex-wrap gap-3 items-end">
        <label className="space-y-1">
          <span className="text-[10px] font-bold uppercase text-muted-foreground">
            Ordenar por
          </span>
          <select
            value={sortBy}
            onChange={(e) => {
              setSortBy(e.target.value as FinanceBillingDetailSortBy);
              setPage(1);
            }}
            className="h-9 rounded-lg border border-border bg-background px-2.5 text-sm"
          >
            {FINANCE_BILLING_DETAIL_SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-[10px] font-bold uppercase text-muted-foreground">
            Direção
          </span>
          <select
            value={sortDir}
            onChange={(e) => {
              setSortDir(e.target.value as FinanceBillingDetailSortDir);
              setPage(1);
            }}
            className="h-9 rounded-lg border border-border bg-background px-2.5 text-sm"
          >
            <option value="desc">Descendente</option>
            <option value="asc">Ascendente</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-[10px] font-bold uppercase text-muted-foreground">
            Por página
          </span>
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(1);
            }}
            className="h-9 rounded-lg border border-border bg-background px-2.5 text-sm"
          >
            {FINANCE_BILLING_DETAIL_PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>

      {initialLoad ? <FinanceArLoadingBlock label="pedidos faturados" /> : null}

      {!initialLoad && !error && data && items.length === 0 ? (
        <p
          className="text-sm text-muted-foreground py-8 text-center rounded-lg border border-dashed border-border"
          data-testid="finance-billing-detail-empty"
        >
          Nenhum pedido faturado encontrado para os filtros informados.
        </p>
      ) : null}

      {items.length ? (
        <>
          <div className="finance-ar-titles-list-section">
            <div className="finance-ar-titles-list-grid-title">
              Pedidos faturados — {data?.period.label ?? "—"}
            </div>
            <div className="finance-ar-titles-list-table-wrap">
              <table
                className="finance-ar-titles-list-table"
                data-testid="finance-billing-detail-table"
              >
                <thead>
                  <tr>
                    <th>Faturamento</th>
                    <th>Pedido de venda</th>
                    <th>Cliente</th>
                    <th>Documento(s) de saída</th>
                    <th>NF(s)</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((row) => (
                    <tr
                      key={row.salesOrderId}
                      tabIndex={0}
                      className="cursor-pointer outline-none"
                      aria-label={`Abrir detalhe do Pedido de Venda ${row.orderCode}`}
                      data-testid={`finance-billing-detail-row-${row.salesOrderId}`}
                      onClick={() => openOrderDetail(row.salesOrderId, row.orderCode)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          openOrderDetail(row.salesOrderId, row.orderCode);
                        }
                      }}
                    >
                      <td className="whitespace-nowrap tabular-nums">
                        {formatFinanceDate(row.lastInvoiceDate)}
                        {row.firstInvoiceDate &&
                        row.firstInvoiceDate !== row.lastInvoiceDate ? (
                          <div className="ar-cell-meta">
                            desde {formatFinanceDate(row.firstInvoiceDate)}
                          </div>
                        ) : null}
                      </td>
                      <td>
                        <div className="ar-cell-title-code">{row.orderCode}</div>
                        {row.externalSalesOrderCode &&
                        row.externalSalesOrderCode !== row.orderCode ? (
                          <div className="ar-cell-meta">
                            {row.externalSalesOrderCode}
                          </div>
                        ) : null}
                      </td>
                      <td className="max-w-[16rem]">
                        <span
                          className="ar-cell-ellipsis block"
                          title={row.customerName}
                        >
                          {displayFinanceText(row.customerName)}
                        </span>
                        {row.companyName ? (
                          <div
                            className="ar-cell-meta ar-cell-ellipsis"
                            title={row.companyName}
                          >
                            {row.companyName}
                          </div>
                        ) : null}
                      </td>
                      <td>
                        <RefChips
                          values={row.outputDocuments.map((d) => d.number)}
                          emptyLabel="Sem documento"
                          testId={`finance-billing-detail-docs-${row.salesOrderId}`}
                        />
                      </td>
                      <td>
                        <RefChips
                          values={row.invoices.map(invoiceChipLabel)}
                          emptyLabel="—"
                          testId={`finance-billing-detail-nfes-${row.salesOrderId}`}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <p className="text-muted-foreground tabular-nums">
              {formatFinanceInteger(totalItems)} pedidos · página {currentPage} de{" "}
              {totalPages}
              {loading ? " · atualizando…" : ""}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={currentPage <= 1 || loading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2 text-xs disabled:opacity-50"
              >
                <ChevronLeft className="h-4 w-4" /> Anterior
              </button>
              <button
                type="button"
                disabled={currentPage >= totalPages || loading}
                onClick={() => setPage((p) => p + 1)}
                className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2 text-xs disabled:opacity-50"
              >
                Próxima <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </>
      ) : null}

      {detailOrderId != null ? (
        <React.Suspense
          fallback={
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Abrindo pedido…
            </div>
          }
        >
          <SalesOrderDetailDialog
            open
            salesOrderId={detailOrderId}
            orderCode={detailOrderCode}
            onClose={closeOrderDetail}
          />
        </React.Suspense>
      ) : null}
    </div>
  );
}
