import "@/src/components/print/print-document.css";
import "@/src/components/sales/sales-order-report-print.css";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  Loader2,
  Printer,
  RefreshCw,
  X,
} from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { cn, formatCurrency } from "@/src/lib/utils";
import { CustomerAutocompleteFilter } from "@/src/components/common/CustomerAutocompleteFilter";
import type { EntityAutocompleteSelection } from "@/src/lib/customerSearch";
import { formatFinanceDate } from "@/src/lib/financeAccountsReceivableFormat";
import {
  getSalesOrderMonthlyReceivablesDetailUrl,
  getSalesOrderMonthlyReceivablesPdfPayloadUrl,
  getSalesOrderMonthlyReceivablesReportUrl,
  getSalesOrderMonthlyReceivablesXlsxUrl,
} from "@/src/lib/sales/salesOrderMonthlyReceivablesReportExportUi";
import {
  SALES_ORDER_MONTHLY_RECEIVABLES_REPORT_SUBTITLE,
  type SalesOrderMonthlyReceivablesDetailPayload,
  type SalesOrderMonthlyReceivablesFinancialSituation,
  type SalesOrderMonthlyReceivablesOriginFilter,
  type SalesOrderMonthlyReceivablesQualityStatus,
  type SalesOrderMonthlyReceivablesReportPayload,
} from "@/src/lib/sales/salesOrderMonthlyReceivablesReport";
import { SalesOrderMonthlyReceivablesReportPrintDocument } from "@/src/components/sales/SalesOrderMonthlyReceivablesReportPrintDocument";
import { INVOICE_FILTER_OPTIONS } from "@/src/lib/salesOrderManagementUi";
import { RECEIVABLE_STATUS_FILTER_OPTIONS } from "@/src/lib/salesOrderListReceivableFilter";
import { DEFAULT_BRANDING, type BrandingSettingsDTO } from "@/src/types/branding";

const FILTER_CONTROL =
  "h-9 w-full min-w-0 rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:bg-muted/40 disabled:text-muted-foreground";

const FILTER_ACTION_BUTTON =
  "inline-flex h-8 items-center gap-1.5 rounded-md border border-transparent px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:border-border hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50";

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "Todos" },
  { value: "DRAFT", label: "Rascunho" },
  { value: "READY_TO_SEND", label: "Pronto para envio" },
  { value: "SENT_TO_NOMUS", label: "Enviado ao Nomus" },
  { value: "CANCELLED", label: "Cancelado" },
  { value: "ERROR", label: "Erro" },
];

const FINANCIAL_SITUATION_OPTIONS: Array<{
  value: SalesOrderMonthlyReceivablesFinancialSituation;
  label: string;
}> = [
  { value: "all", label: "Todas" },
  { value: "planned", label: "Previstas" },
  { value: "open", label: "Em aberto" },
  { value: "overdue", label: "Vencidas" },
  { value: "received", label: "Recebidas" },
  { value: "partial", label: "Parcial" },
];

const ORIGIN_OPTIONS: Array<{
  value: SalesOrderMonthlyReceivablesOriginFilter;
  label: string;
}> = [
  { value: "all", label: "Todas" },
  { value: "planned", label: "Previsão" },
  { value: "document", label: "Documento" },
  { value: "cr", label: "CR real" },
  { value: "mixed", label: "Mista" },
];

function FilterLabel({
  htmlFor,
  children,
}: {
  htmlFor?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground"
    >
      {children}
    </label>
  );
}

function money(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (Math.abs(value) < 0.005) return "—";
  return formatCurrency(value);
}

function qualityTone(
  status: SalesOrderMonthlyReceivablesQualityStatus
): string {
  switch (status) {
    case "OK":
      return "bg-emerald-50 text-emerald-800 border-emerald-200";
    case "DIFERENCA_EXPLICAVEL":
      return "bg-amber-50 text-amber-900 border-amber-200";
    case "AGENDA_INCOMPLETA":
    case "VINCULO_INCOMPLETO":
    case "SEM_AGENDA":
    case "REVISAR":
      return "bg-rose-50 text-rose-900 border-rose-200";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

function buildReportQuery(input: {
  dueMonthFrom: string;
  dueMonthTo: string;
  customerId: string;
  sellerKey: string;
  status: string;
  financialSituation: SalesOrderMonthlyReceivablesFinancialSituation;
  origin: SalesOrderMonthlyReceivablesOriginFilter;
  includeCancelled: boolean;
  onlyDivergent: boolean;
  onlyIncompleteAgenda: boolean;
  orderCode: string;
  q: string;
  startDate: string;
  endDate: string;
  hasInvoice: string;
  receivableStatus: string;
  page: number;
}): string {
  const params = new URLSearchParams();
  if (input.dueMonthFrom) params.set("dueMonthFrom", input.dueMonthFrom);
  if (input.dueMonthTo) params.set("dueMonthTo", input.dueMonthTo);
  if (input.customerId) params.set("customerId", input.customerId);
  if (input.sellerKey.trim()) params.set("sellerKey", input.sellerKey.trim());
  if (input.startDate) params.set("startDate", input.startDate);
  if (input.endDate) params.set("endDate", input.endDate);
  if (input.hasInvoice) params.set("hasInvoice", input.hasInvoice);
  if (input.receivableStatus) params.set("receivableStatus", input.receivableStatus);
  if (input.status) params.set("status", input.status);
  if (input.financialSituation !== "all") {
    params.set("financialSituation", input.financialSituation);
  }
  if (input.origin !== "all") params.set("origin", input.origin);
  if (input.includeCancelled) params.set("includeCancelled", "1");
  if (input.onlyDivergent) params.set("onlyDivergent", "1");
  if (input.onlyIncompleteAgenda) params.set("onlyIncompleteAgenda", "1");
  if (input.orderCode.trim()) params.set("orderCode", input.orderCode.trim());
  if (input.q.trim()) params.set("q", input.q.trim());
  params.set("page", String(input.page));
  return params.toString();
}

type DrilldownState = {
  salesOrderId: string;
  orderCode: string;
  monthKey: string;
  monthLabel: string;
};

function MonthlyReceivablesDetailDialog({
  drilldown,
  onClose,
}: {
  drilldown: DrilldownState;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<SalesOrderMonthlyReceivablesDetailPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({
      salesOrderId: drilldown.salesOrderId,
      monthKey: drilldown.monthKey,
    }).toString();
    void fetchJsonOk<SalesOrderMonthlyReceivablesDetailPayload>(
      getSalesOrderMonthlyReceivablesDetailUrl(qs)
    )
      .then((data) => {
        if (!cancelled) setDetail(data);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Erro ao carregar detalhe.");
          setDetail(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [drilldown.monthKey, drilldown.salesOrderId]);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="monthly-receivables-detail-title"
      data-testid="monthly-receivables-detail-dialog"
    >
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-lg">
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h2
              id="monthly-receivables-detail-title"
              className="text-base font-semibold text-foreground"
            >
              {drilldown.orderCode} · {drilldown.monthLabel}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Títulos da agenda efetiva no mês selecionado
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando títulos…
            </div>
          ) : null}
          {error ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          ) : null}
          {!loading && !error && detail ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="text-muted-foreground">{detail.customerName}</span>
                <span className="font-semibold text-foreground">
                  Total: {money(detail.totalAmount)} ({detail.titleCount} título
                  {detail.titleCount === 1 ? "" : "s"})
                </span>
              </div>
              {detail.lines.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Nenhum título neste mês.
                </p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="min-w-full text-sm">
                    <thead className="bg-muted/40 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2">Parcela</th>
                        <th className="px-3 py-2">Vencimento</th>
                        <th className="px-3 py-2 text-right">Valor</th>
                        <th className="px-3 py-2 text-right">Recebido</th>
                        <th className="px-3 py-2 text-right">Saldo</th>
                        <th className="px-3 py-2">Situação</th>
                        <th className="px-3 py-2">Origem</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.lines.map((line) => (
                        <tr key={line.lineId} className="border-t border-border/70">
                          <td className="px-3 py-2">{line.installmentLabel ?? "—"}</td>
                          <td className="px-3 py-2">{formatFinanceDate(line.dueDate)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{money(line.amount)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {money(line.amountReceived)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{money(line.balance)}</td>
                          <td className="px-3 py-2">{line.situationLabel}</td>
                          <td className="px-3 py-2">{line.originLabel}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <Link
            to={`/sales-orders/${drilldown.salesOrderId}`}
            className="inline-flex items-center rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-accent"
          >
            Abrir pedido
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}

export function SalesOrderMonthlyReceivablesReportPage() {
  const [dueMonthFrom, setDueMonthFrom] = useState("");
  const [dueMonthTo, setDueMonthTo] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [customerSelection, setCustomerSelection] = useState<EntityAutocompleteSelection | null>(
    null
  );
  const [sellerKey, setSellerKey] = useState("");
  const [status, setStatus] = useState("");
  const [financialSituation, setFinancialSituation] =
    useState<SalesOrderMonthlyReceivablesFinancialSituation>("all");
  const [origin, setOrigin] = useState<SalesOrderMonthlyReceivablesOriginFilter>("all");
  const [includeCancelled, setIncludeCancelled] = useState(false);
  const [onlyDivergent, setOnlyDivergent] = useState(false);
  const [onlyIncompleteAgenda, setOnlyIncompleteAgenda] = useState(false);
  const [orderCode, setOrderCode] = useState("");
  const [q, setQ] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [hasInvoice, setHasInvoice] = useState("");
  const [receivableStatus, setReceivableStatus] = useState("");
  const [debouncedSellerKey, setDebouncedSellerKey] = useState("");
  const [debouncedOrderCode, setDebouncedOrderCode] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [page, setPage] = useState(1);

  const [payload, setPayload] = useState<SalesOrderMonthlyReceivablesReportPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportingXlsx, setExportingXlsx] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [printPayload, setPrintPayload] = useState<SalesOrderMonthlyReceivablesReportPayload | null>(
    null
  );
  const [printRequestId, setPrintRequestId] = useState(0);
  const [branding, setBranding] = useState<BrandingSettingsDTO>(DEFAULT_BRANDING);
  const [drilldown, setDrilldown] = useState<DrilldownState | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSellerKey(sellerKey), 350);
    return () => window.clearTimeout(timer);
  }, [sellerKey]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedOrderCode(orderCode), 350);
    return () => window.clearTimeout(timer);
  }, [orderCode]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQ(q), 350);
    return () => window.clearTimeout(timer);
  }, [q]);

  const queryString = useMemo(
    () =>
      buildReportQuery({
        dueMonthFrom,
        dueMonthTo,
        customerId,
        sellerKey: debouncedSellerKey,
        status,
        financialSituation,
        origin,
        includeCancelled,
        onlyDivergent,
        onlyIncompleteAgenda,
        orderCode: debouncedOrderCode,
        q: debouncedQ,
        startDate,
        endDate,
        hasInvoice,
        receivableStatus,
        page,
      }),
    [
      customerId,
      debouncedOrderCode,
      debouncedQ,
      debouncedSellerKey,
      dueMonthFrom,
      dueMonthTo,
      endDate,
      financialSituation,
      hasInvoice,
      includeCancelled,
      onlyDivergent,
      onlyIncompleteAgenda,
      origin,
      page,
      receivableStatus,
      startDate,
      status,
    ]
  );

  const filterKey = useMemo(
    () => queryString.replace(/(^|&)page=\d+/, ""),
    [queryString]
  );
  const prevFilterKeyRef = useRef<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchJsonOk<SalesOrderMonthlyReceivablesReportPayload>(
        getSalesOrderMonthlyReceivablesReportUrl(queryString),
        { signal }
      );
      setPayload(data);
    } catch (e: unknown) {
      if (signal?.aborted) return;
      setError(e instanceof Error ? e.message : "Erro ao carregar relatório.");
      setPayload(null);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [queryString]);

  useEffect(() => {
    const filtersChanged =
      prevFilterKeyRef.current !== null && prevFilterKeyRef.current !== filterKey;
    prevFilterKeyRef.current = filterKey;
    if (filtersChanged && page !== 1) {
      setPage(1);
      return;
    }
    const ac = new AbortController();
    void load(ac.signal);
    return () => ac.abort();
  }, [filterKey, load, page]);

  useEffect(() => {
    void fetchJsonOk<BrandingSettingsDTO>("/api/branding-settings")
      .then(setBranding)
      .catch(() => setBranding(DEFAULT_BRANDING));
  }, []);

  useEffect(() => {
    if (printRequestId === 0 || !printPayload) return;

    document.body.classList.add("sales-orders-print-route");
    document.body.classList.add("sales-orders-receivables-print-route");

    const onAfterPrint = () => {
      document.body.classList.remove("sales-orders-print-route");
      document.body.classList.remove("sales-orders-receivables-print-route");
      setPrintPayload(null);
      setPrintRequestId(0);
      setExportingPdf(false);
    };

    window.addEventListener("afterprint", onAfterPrint, { once: true });
    const timer = window.setTimeout(() => window.print(), 350);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("afterprint", onAfterPrint);
    };
  }, [printRequestId, printPayload]);

  const handleClearFilters = () => {
    setDueMonthFrom("");
    setDueMonthTo("");
    setCustomerId("");
    setCustomerSelection(null);
    setSellerKey("");
    setStatus("");
    setFinancialSituation("all");
    setOrigin("all");
    setIncludeCancelled(false);
    setOnlyDivergent(false);
    setOnlyIncompleteAgenda(false);
    setOrderCode("");
    setQ("");
    setStartDate("");
    setEndDate("");
    setHasInvoice("");
    setReceivableStatus("");
    setPage(1);
  };

  const handleExportXlsx = async () => {
    if (exportingXlsx) return;
    setExportingXlsx(true);
    try {
      const url = getSalesOrderMonthlyReceivablesXlsxUrl(filterKey.replace(/^&/, ""));
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Falha ao exportar Excel.");
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `recebiveis-mensais-pedidos-${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(objectUrl);
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Erro ao exportar Excel.");
    } finally {
      setExportingXlsx(false);
    }
  };

  const handleExportPdf = async () => {
    if (exportingPdf) return;
    setExportingPdf(true);
    try {
      const data = await fetchJsonOk<SalesOrderMonthlyReceivablesReportPayload>(
        getSalesOrderMonthlyReceivablesPdfPayloadUrl(filterKey.replace(/^&/, ""))
      );
      setPrintPayload(data);
      setPrintRequestId((id) => id + 1);
    } catch {
      alert("Não foi possível gerar o PDF de recebíveis mensais.");
      setExportingPdf(false);
    }
  };

  const monthColumns = payload?.period.months ?? [];
  const rows = payload?.rows ?? [];
  const totals = payload?.totals;
  const pagination = payload?.pagination;
  const totalPages = pagination?.totalPages ?? 1;
  const totalRows = pagination?.totalRows ?? 0;

  return (
    <div className="space-y-6" data-testid="monthly-receivables-report-page">
      <div className="rounded-xl border border-border bg-card/60 px-4 py-3 shadow-sm">
        <p className="text-sm font-semibold text-foreground">
          {payload?.title ?? "Recebíveis mensais por Pedido de Venda"}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {payload?.subtitle ?? SALES_ORDER_MONTHLY_RECEIVABLES_REPORT_SUBTITLE}
        </p>
        {payload?.period ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Período de vencimento: {payload.period.startMonth} → {payload.period.endMonth} (
            {payload.period.monthCount} meses)
          </p>
        ) : null}
      </div>

      <div
        className="space-y-3 rounded-xl border border-border bg-card/60 p-3 shadow-sm"
        data-testid="monthly-receivables-filter-bar"
      >
        <div className="grid grid-cols-12 gap-2">
          <div className="col-span-6 sm:col-span-3 lg:col-span-2">
            <FilterLabel htmlFor="receivables-due-from">Vencimento de</FilterLabel>
            <input
              id="receivables-due-from"
              type="month"
              className={FILTER_CONTROL}
              value={dueMonthFrom}
              onChange={(e) => setDueMonthFrom(e.target.value)}
            />
          </div>
          <div className="col-span-6 sm:col-span-3 lg:col-span-2">
            <FilterLabel htmlFor="receivables-due-to">Vencimento até</FilterLabel>
            <input
              id="receivables-due-to"
              type="month"
              className={FILTER_CONTROL}
              value={dueMonthTo}
              onChange={(e) => setDueMonthTo(e.target.value)}
            />
          </div>
          <div className="col-span-12 sm:col-span-6 lg:col-span-2">
            <FilterLabel htmlFor="receivables-status">Status pedido</FilterLabel>
            <select
              id="receivables-status"
              className={FILTER_CONTROL}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value || "all"} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-12 sm:col-span-6 lg:col-span-2">
            <FilterLabel htmlFor="receivables-financial">Situação financeira</FilterLabel>
            <select
              id="receivables-financial"
              className={FILTER_CONTROL}
              value={financialSituation}
              onChange={(e) =>
                setFinancialSituation(e.target.value as SalesOrderMonthlyReceivablesFinancialSituation)
              }
            >
              {FINANCIAL_SITUATION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-12 sm:col-span-6 lg:col-span-2">
            <FilterLabel htmlFor="receivables-origin">Origem</FilterLabel>
            <select
              id="receivables-origin"
              className={FILTER_CONTROL}
              value={origin}
              onChange={(e) => setOrigin(e.target.value as SalesOrderMonthlyReceivablesOriginFilter)}
            >
              {ORIGIN_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-12 lg:col-span-2">
            <FilterLabel htmlFor="receivables-order-code">Código pedido</FilterLabel>
            <input
              id="receivables-order-code"
              type="search"
              className={FILTER_CONTROL}
              placeholder="Ex.: PD 12345"
              value={orderCode}
              onChange={(e) => setOrderCode(e.target.value)}
            />
          </div>

          <div className="col-span-12 sm:col-span-6 lg:col-span-3">
            <CustomerAutocompleteFilter
              label="Cliente"
              value={customerSelection}
              onChange={(sel) => {
                setCustomerSelection(sel);
                setCustomerId(sel?.id ?? "");
              }}
            />
          </div>
          <div className="col-span-12 sm:col-span-6 lg:col-span-2">
            <FilterLabel htmlFor="receivables-seller">Vendedor</FilterLabel>
            <input
              id="receivables-seller"
              type="search"
              className={FILTER_CONTROL}
              placeholder="Nome ou chave"
              value={sellerKey}
              onChange={(e) => setSellerKey(e.target.value)}
            />
          </div>
          <div className="col-span-6 sm:col-span-3 lg:col-span-2">
            <FilterLabel htmlFor="receivables-issue-from">Emissão de</FilterLabel>
            <input
              id="receivables-issue-from"
              type="date"
              className={FILTER_CONTROL}
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div className="col-span-6 sm:col-span-3 lg:col-span-2">
            <FilterLabel htmlFor="receivables-issue-to">Emissão até</FilterLabel>
            <input
              id="receivables-issue-to"
              type="date"
              className={FILTER_CONTROL}
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
          <div className="col-span-6 sm:col-span-3 lg:col-span-2">
            <FilterLabel htmlFor="receivables-has-invoice">Vínculo NF</FilterLabel>
            <select
              id="receivables-has-invoice"
              className={FILTER_CONTROL}
              value={hasInvoice}
              onChange={(e) => setHasInvoice(e.target.value)}
              data-testid="monthly-receivables-filter-has-invoice"
            >
              {INVOICE_FILTER_OPTIONS.map((o) => (
                <option key={o.value || "all"} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-6 sm:col-span-3 lg:col-span-2">
            <FilterLabel htmlFor="receivables-cr-status">Status CR</FilterLabel>
            <select
              id="receivables-cr-status"
              className={FILTER_CONTROL}
              value={receivableStatus}
              onChange={(e) => setReceivableStatus(e.target.value)}
              data-testid="monthly-receivables-filter-receivable-status"
            >
              {RECEIVABLE_STATUS_FILTER_OPTIONS.map((o) => (
                <option key={o.value || "all"} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-12 lg:col-span-4">
            <FilterLabel htmlFor="receivables-q">Busca inteligente</FilterLabel>
            <input
              id="receivables-q"
              type="search"
              className={FILTER_CONTROL}
              placeholder="Pedido, NF, cliente, vendedor…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>

          <div className="col-span-12 flex flex-wrap items-center gap-4 lg:col-span-3">
            <label className="inline-flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={includeCancelled}
                onChange={(e) => setIncludeCancelled(e.target.checked)}
                className="rounded border-border"
              />
              Incluir cancelados
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={onlyDivergent}
                onChange={(e) => setOnlyDivergent(e.target.checked)}
                className="rounded border-border"
              />
              Só divergentes
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={onlyIncompleteAgenda}
                onChange={(e) => setOnlyIncompleteAgenda(e.target.checked)}
                className="rounded border-border"
              />
              Agenda incompleta
            </label>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 pt-3">
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className={FILTER_ACTION_BUTTON}
              data-testid="monthly-receivables-refresh"
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Atualizar
            </button>
            <button type="button" onClick={handleClearFilters} className={FILTER_ACTION_BUTTON}>
              Limpar filtros
            </button>
          </div>
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              onClick={() => void handleExportXlsx()}
              disabled={exportingXlsx || loading}
              className={FILTER_ACTION_BUTTON}
              data-testid="monthly-receivables-export-xlsx"
            >
              {exportingXlsx ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <FileSpreadsheet className="h-3.5 w-3.5" />
              )}
              Excel
            </button>
            <button
              type="button"
              onClick={() => void handleExportPdf()}
              disabled={exportingPdf || loading}
              className={FILTER_ACTION_BUTTON}
              data-testid="monthly-receivables-export-pdf"
            >
              {exportingPdf ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Printer className="h-3.5 w-3.5" />
              )}
              PDF
            </button>
          </div>
        </div>
      </div>

      {payload?.warnings?.length ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {payload.warnings.join(" · ")}
        </div>
      ) : null}

      {error ? (
        <div
          className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
          data-testid="monthly-receivables-error"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        {loading && !payload ? (
          <div className="flex items-center justify-center gap-2 px-4 py-16 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            Carregando matriz de recebíveis…
          </div>
        ) : null}

        {!loading && !error && rows.length === 0 ? (
          <div
            className="px-4 py-16 text-center text-sm text-muted-foreground"
            data-testid="monthly-receivables-empty"
          >
            Nenhum pedido encontrado para os filtros selecionados.
          </div>
        ) : null}

        {rows.length > 0 ? (
          <div className="overflow-x-auto">
            <table
              className="min-w-full border-collapse text-sm"
              data-testid="monthly-receivables-matrix"
            >
              <thead>
                <tr className="border-b border-border bg-muted/30 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <th className="sticky left-0 z-20 min-w-[7rem] border-r border-border bg-muted/95 px-3 py-2 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]">
                    Pedido
                  </th>
                  <th className="sticky left-[7rem] z-20 min-w-[12rem] border-r border-border bg-muted/95 px-3 py-2 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]">
                    Cliente
                  </th>
                  <th className="px-3 py-2 text-right">Valor pedido</th>
                  <th className="px-3 py-2 text-right">Agenda</th>
                  <th className="px-3 py-2 text-right">Diferença</th>
                  <th className="px-3 py-2">Qualidade</th>
                  {monthColumns.map((m) => (
                    <th key={m.key} className="min-w-[6.5rem] px-2 py-2 text-right">
                      {m.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.salesOrderId} className="border-b border-border/70 hover:bg-muted/20">
                    <td className="sticky left-0 z-10 border-r border-border bg-card px-3 py-2 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.06)]">
                      <Link
                        to={`/sales-orders/${row.salesOrderId}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {row.orderCode}
                      </Link>
                    </td>
                    <td
                      className="sticky left-[7rem] z-10 max-w-[12rem] truncate border-r border-border bg-card px-3 py-2 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.06)]"
                      title={row.customerName}
                    >
                      {row.customerName}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(row.orderCommercialTotal)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {money(row.effectiveScheduleTotal)}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-2 text-right tabular-nums",
                        Math.abs(row.difference) > 1 ? "text-amber-700" : ""
                      )}
                    >
                      {money(row.difference)}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          "inline-flex rounded-md border px-2 py-0.5 text-[11px] font-medium",
                          qualityTone(row.qualityStatus)
                        )}
                      >
                        {row.qualityStatusLabel}
                      </span>
                    </td>
                    {monthColumns.map((m) => {
                      const cell = row.months[m.key];
                      const clickable = (cell?.titleCount ?? 0) > 0;
                      return (
                        <td key={m.key} className="px-1 py-1 text-right">
                          {clickable ? (
                            <button
                              type="button"
                              className="w-full rounded-md px-2 py-1 text-right tabular-nums transition-colors hover:bg-primary/10 hover:text-primary"
                              title={cell?.sourceSummary || undefined}
                              onClick={() =>
                                setDrilldown({
                                  salesOrderId: row.salesOrderId,
                                  orderCode: row.orderCode,
                                  monthKey: m.key,
                                  monthLabel: m.label,
                                })
                              }
                            >
                              {money(cell?.amount ?? 0)}
                            </button>
                          ) : (
                            <span className="block px-2 py-1 tabular-nums text-muted-foreground/70">
                              —
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {totals ? (
                  <tr className="border-t-2 border-border bg-muted/40 font-semibold">
                    <td
                      className="sticky left-0 z-10 border-r border-border bg-muted/95 px-3 py-2 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]"
                      colSpan={2}
                    >
                      Totais ({totalRows} pedidos)
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {money(totals.orderCommercialTotal)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {money(totals.effectiveScheduleTotal)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(totals.difference)}</td>
                    <td />
                    {monthColumns.map((m) => (
                      <td key={m.key} className="px-2 py-2 text-right tabular-nums">
                        {money(totals.monthly[m.key]?.amount ?? 0)}
                      </td>
                    ))}
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      {totalRows > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card/60 px-4 py-3 text-sm">
          <span className="text-muted-foreground">
            Página {pagination?.page ?? page} de {totalPages} · {totalRows} pedidos
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
              className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-3 py-2 font-medium hover:bg-accent disabled:opacity-50"
            >
              <ChevronLeft className="h-4 w-4" />
              Anterior
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || loading}
              className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-3 py-2 font-medium hover:bg-accent disabled:opacity-50"
            >
              Próxima
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : null}

      {drilldown ? (
        <MonthlyReceivablesDetailDialog drilldown={drilldown} onClose={() => setDrilldown(null)} />
      ) : null}

      {printPayload
        ? createPortal(
            <SalesOrderMonthlyReceivablesReportPrintDocument
              payload={printPayload}
              branding={branding}
            />,
            document.body
          )
        : null}
    </div>
  );
}
