import "./finance-ar-titles-print.css";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Download, Loader2, Printer, RotateCcw, AlertTriangle, CalendarClock, CheckCircle2, FileText, Receipt, Scale, Wallet } from "lucide-react";
import { useAuth } from "@/src/contexts/AuthContext";
import { CustomerAutocompleteFilter } from "@/src/components/common/CustomerAutocompleteFilter";
import { MetricCard } from "@/src/components/ui/MetricCard";
import { ExecutiveSummarySection } from "@/src/components/ui/ExecutiveSummarySection";
import { SummaryKpiGrid } from "@/src/components/ui/SummaryKpiGrid";
import { StatusBadge } from "@/src/components/finance/FinanceAccountsReceivableTabPanels";
import {
  FinanceArErrorBanner,
  FinanceArLoadingBlock,
  FinanceArScrollableTable,
  FinanceArStickyTableHead,
} from "@/src/components/finance/FinanceAccountsReceivableUiShared";
import { FinanceAccountsReceivableTitlesPrintDocument } from "@/src/components/finance/FinanceAccountsReceivableTitlesPrintDocument";
import { financeArCustomerFieldsFromSelection } from "@/src/lib/customerSearch";
import {
  buildFinanceArAnalyticalTitlesExportQuery,
  buildFinanceArAnalyticalTitlesQuery,
  buildFinanceArYearOptions,
  createDefaultFinanceArAnalyticalUiFilters,
  FINANCE_AR_INVOICE_ISSUED_OPTIONS,
  FINANCE_AR_MONTH_OPTIONS,
  FINANCE_AR_STATUS_OPTIONS,
  normalizeFinanceArAnalyticalUiFilters,
  type FinanceArAnalyticalUiFilters,
} from "@/src/lib/financeAccountsReceivableDashboardTypes";
import {
  displayFinanceText,
  formatFinanceCurrency,
  formatFinanceDate,
  formatFinanceInteger,
} from "@/src/lib/financeAccountsReceivableFormat";
import { financeArTitlesExportFilename } from "@/src/lib/financeAccountsReceivableTitlesExport";
import type {
  FinanceArTitleListItem,
  FinanceArTitlesPayload,
  FinanceArTitlesSortBy,
} from "@/src/lib/financeAccountsReceivableTitles";
import { fetchJsonOk } from "@/src/lib/http";
import { cn } from "@/src/lib/utils";

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const;

const ORIGIN_OPTIONS = [
  { value: "all", label: "Todas origens" },
  { value: "withNfe", label: "Com NF" },
  { value: "withoutNfe", label: "Sem NF" },
] as const;

const DELAY_OPTIONS = [
  { value: "all", label: "Todas situações" },
  { value: "overdue", label: "Vencidos" },
  { value: "upcoming", label: "A vencer" },
  { value: "dueToday", label: "Vence hoje" },
  { value: "settled", label: "Recebidos" },
] as const;

const SORT_OPTIONS: Array<{ value: FinanceArTitlesSortBy; label: string }> = [
  { value: "personName", label: "Cliente" },
  { value: "dueDate", label: "Vencimento" },
  { value: "competenceDate", label: "Data emissão" },
  { value: "calculatedStatus", label: "Status" },
  { value: "amountReceivable", label: "Valor original" },
  { value: "balanceReceivable", label: "Valor em aberto" },
  { value: "daysOverdue", label: "Dias em atraso" },
];

function originLabel(origin: string): string {
  return origin === "WITH_NFE" ? "Com NF" : "Sem NF";
}

export function FinanceArAnalyticalTitlesTab({ canExport }: { canExport: boolean }) {
  const auth = useAuth();
  const yearOptions = useMemo(() => buildFinanceArYearOptions(), []);

  const [draftFilters, setDraftFilters] = useState<FinanceArAnalyticalUiFilters>(() =>
    createDefaultFinanceArAnalyticalUiFilters()
  );
  const [appliedFilters, setAppliedFilters] = useState<FinanceArAnalyticalUiFilters>(() =>
    createDefaultFinanceArAnalyticalUiFilters()
  );
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [sortBy, setSortBy] = useState<FinanceArTitlesSortBy>("dueDate");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [data, setData] = useState<FinanceArTitlesPayload | null>(null);
  const [printItems, setPrintItems] = useState<FinanceArTitleListItem[] | null>(null);
  const [printPayload, setPrintPayload] = useState<FinanceArTitlesPayload | null>(null);
  const [printRequestId, setPrintRequestId] = useState(0);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(
    () =>
      buildFinanceArAnalyticalTitlesQuery(appliedFilters, {
        page,
        pageSize,
        sortBy,
        sortDirection,
      }),
    [appliedFilters, page, pageSize, sortBy, sortDirection]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchJsonOk<FinanceArTitlesPayload>(
        `/api/finance/accounts-receivable/titles?${query}`
      );
      setData(payload);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar títulos.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (printRequestId === 0 || !printPayload || !printItems) return;

    document.body.classList.add("ar-titles-print-route");

    const onAfterPrint = () => {
      document.body.classList.remove("ar-titles-print-route");
      setPrintPayload(null);
      setPrintItems(null);
      setPrintRequestId(0);
      setPrinting(false);
    };

    window.addEventListener("afterprint", onAfterPrint, { once: true });

    const timer = window.setTimeout(() => {
      window.print();
    }, 350);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("afterprint", onAfterPrint);
    };
  }, [printRequestId, printPayload, printItems]);

  const handleApplyFilters = () => {
    const normalized = normalizeFinanceArAnalyticalUiFilters(draftFilters);
    setDraftFilters(normalized);
    setAppliedFilters(normalized);
    setPage(1);
  };

  const handleClearFilters = () => {
    const defaults = createDefaultFinanceArAnalyticalUiFilters();
    setDraftFilters(defaults);
    setAppliedFilters(defaults);
    setPage(1);
  };

  const handleExportExcel = async () => {
    if (!canExport) return;
    setExporting(true);
    setError(null);
    try {
      const qs = buildFinanceArAnalyticalTitlesExportQuery(appliedFilters);
      const res = await fetch(`/api/finance/accounts-receivable/titles/export.xlsx?${qs}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Falha ao exportar Excel.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = financeArTitlesExportFilename();
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao exportar Excel.");
    } finally {
      setExporting(false);
    }
  };

  const handleExportPdf = async () => {
    if (!canExport || printing) return;
    setPrinting(true);
    setError(null);
    try {
      const qs = buildFinanceArAnalyticalTitlesExportQuery(appliedFilters);
      const payload = await fetchJsonOk<FinanceArTitlesPayload>(
        `/api/finance/accounts-receivable/titles?${qs}`
      );
      setPrintPayload(payload);
      setPrintItems(payload.items);
      setPrintRequestId((id) => id + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao preparar PDF.");
      setPrinting(false);
    }
  };

  const summary = data?.summary;
  const initialLoad = loading && !data && !error;

  return (
    <div className="space-y-4" data-testid="finance-ar-analytical-titles">
      <div className="rounded-2xl border border-border/70 bg-card p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-[#111827]">Grid Analítico de Títulos</h2>
            <p className="text-[11px] text-[#6B7280] mt-0.5">
              Análise completa de contas a receber com filtros, totalizadores e exportação.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 ar-titles-no-print">
            {canExport ? (
              <>
                <button
                  type="button"
                  onClick={() => void handleExportExcel()}
                  disabled={exporting || loading}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-semibold hover:bg-accent disabled:opacity-50"
                >
                  {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                  Exportar Excel
                </button>
                <button
                  type="button"
                  onClick={() => void handleExportPdf()}
                  disabled={printing || loading}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-semibold hover:bg-accent disabled:opacity-50"
                >
                  {printing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Printer className="h-3.5 w-3.5" />}
                  Exportar PDF
                </button>
              </>
            ) : null}
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
          <CustomerAutocompleteFilter
            label="Cliente"
            personName={draftFilters.personName}
            personCnpj={draftFilters.personCnpj}
            customerId={draftFilters.customerId}
            onChange={(selection) => {
              const fields = financeArCustomerFieldsFromSelection(selection);
              setDraftFilters((prev) =>
                normalizeFinanceArAnalyticalUiFilters({
                  ...prev,
                  personName: fields.personName,
                  personCnpj: fields.personCnpj,
                  customerId: fields.customerId,
                  customerName: fields.customerName,
                })
              );
            }}
            onClear={() => {
              setDraftFilters((prev) =>
                normalizeFinanceArAnalyticalUiFilters({
                  ...prev,
                  personName: "",
                  personCnpj: "",
                  customerId: "",
                  customerName: "",
                })
              );
            }}
          />
          <label className="space-y-1">
            <span className="text-[10px] font-bold uppercase text-muted-foreground">Empresa</span>
            <input
              value={draftFilters.companyName}
              onChange={(e) => setDraftFilters((p) => ({ ...p, companyName: e.target.value }))}
              placeholder="Consolidado / empresa"
              className="w-full h-9 rounded-lg border border-border bg-background px-2.5 text-sm"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] font-bold uppercase text-muted-foreground">Ano vencimento</span>
            <select
              value={draftFilters.year}
              onChange={(e) => setDraftFilters((p) => ({ ...p, year: e.target.value }))}
              className="w-full h-9 rounded-lg border border-border bg-background px-2.5 text-sm"
            >
              {yearOptions.map((o) => (
                <option key={o.value || "all"} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[10px] font-bold uppercase text-muted-foreground">Mês vencimento</span>
            <select
              value={draftFilters.month}
              onChange={(e) => setDraftFilters((p) => ({ ...p, month: e.target.value }))}
              className="w-full h-9 rounded-lg border border-border bg-background px-2.5 text-sm"
            >
              {FINANCE_AR_MONTH_OPTIONS.map((o) => (
                <option key={o.value || "all"} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[10px] font-bold uppercase text-muted-foreground">Vencimento de</span>
            <input
              type="date"
              value={draftFilters.dueDateFrom}
              onChange={(e) => setDraftFilters((p) => ({ ...p, dueDateFrom: e.target.value }))}
              className="w-full h-9 rounded-lg border border-border bg-background px-2.5 text-sm"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] font-bold uppercase text-muted-foreground">Vencimento até</span>
            <input
              type="date"
              value={draftFilters.dueDateTo}
              onChange={(e) => setDraftFilters((p) => ({ ...p, dueDateTo: e.target.value }))}
              className="w-full h-9 rounded-lg border border-border bg-background px-2.5 text-sm"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] font-bold uppercase text-muted-foreground">Emissão de</span>
            <input
              type="date"
              value={draftFilters.issueDateFrom}
              onChange={(e) => setDraftFilters((p) => ({ ...p, issueDateFrom: e.target.value }))}
              className="w-full h-9 rounded-lg border border-border bg-background px-2.5 text-sm"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] font-bold uppercase text-muted-foreground">Emissão até</span>
            <input
              type="date"
              value={draftFilters.issueDateTo}
              onChange={(e) => setDraftFilters((p) => ({ ...p, issueDateTo: e.target.value }))}
              className="w-full h-9 rounded-lg border border-border bg-background px-2.5 text-sm"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] font-bold uppercase text-muted-foreground">Status</span>
            <select
              value={draftFilters.status}
              onChange={(e) => setDraftFilters((p) => ({ ...p, status: e.target.value }))}
              className="w-full h-9 rounded-lg border border-border bg-background px-2.5 text-sm"
            >
              {FINANCE_AR_STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[10px] font-bold uppercase text-muted-foreground">NF emitida</span>
            <select
              value={draftFilters.invoiceIssued}
              onChange={(e) => setDraftFilters((p) => ({ ...p, invoiceIssued: e.target.value }))}
              className="w-full h-9 rounded-lg border border-border bg-background px-2.5 text-sm"
            >
              {FINANCE_AR_INVOICE_ISSUED_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[10px] font-bold uppercase text-muted-foreground">Documento / NF / Pedido</span>
            <input
              value={draftFilters.document}
              onChange={(e) => setDraftFilters((p) => ({ ...p, document: e.target.value }))}
              placeholder="Número, NF ou referência"
              className="w-full h-9 rounded-lg border border-border bg-background px-2.5 text-sm"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] font-bold uppercase text-muted-foreground">Valor mínimo</span>
            <input
              value={draftFilters.minValue}
              onChange={(e) => setDraftFilters((p) => ({ ...p, minValue: e.target.value }))}
              placeholder="0,00"
              className="w-full h-9 rounded-lg border border-border bg-background px-2.5 text-sm"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] font-bold uppercase text-muted-foreground">Valor máximo</span>
            <input
              value={draftFilters.maxValue}
              onChange={(e) => setDraftFilters((p) => ({ ...p, maxValue: e.target.value }))}
              placeholder="0,00"
              className="w-full h-9 rounded-lg border border-border bg-background px-2.5 text-sm"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] font-bold uppercase text-muted-foreground">Origem</span>
            <select
              value={draftFilters.origin}
              onChange={(e) => setDraftFilters((p) => ({ ...p, origin: e.target.value }))}
              className="w-full h-9 rounded-lg border border-border bg-background px-2.5 text-sm"
            >
              {ORIGIN_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[10px] font-bold uppercase text-muted-foreground">Situação de atraso</span>
            <select
              value={draftFilters.delaySituation}
              onChange={(e) => setDraftFilters((p) => ({ ...p, delaySituation: e.target.value }))}
              className="w-full h-9 rounded-lg border border-border bg-background px-2.5 text-sm"
            >
              {DELAY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex flex-wrap gap-2 ar-titles-no-print">
          <button
            type="button"
            onClick={handleApplyFilters}
            className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
          >
            Aplicar filtros
          </button>
        </div>
      </div>

      {error ? <FinanceArErrorBanner message={error} onDismiss={() => setError(null)} /> : null}

      {summary ? (
        <ExecutiveSummarySection
          title="Resumo dos títulos"
          eyebrow="Totais da carteira conforme filtros aplicados"
          testId="finance-ar-titles-executive-summary"
        >
        <SummaryKpiGrid testId="finance-ar-titles-summary-kpis">
          <MetricCard
            label="Títulos"
            amount={summary.totalTitles}
            amountFormat="number"
            variant="info"
            icon={<FileText />}
            loading={loading}
          />
          <MetricCard
            label="Valor original"
            amount={summary.totalOriginalValue}
            amountFormat="currency"
            variant="neutral"
            icon={<Receipt />}
            loading={loading}
          />
          <MetricCard
            label="Valor recebido"
            amount={summary.totalReceivedValue}
            amountFormat="currency"
            variant="success"
            icon={<CheckCircle2 />}
            loading={loading}
          />
          <MetricCard
            label="Em aberto"
            amount={summary.totalOpenValue}
            amountFormat="currency"
            variant="info"
            icon={<Wallet />}
            loading={loading}
          />
          <MetricCard
            label="Vencido"
            amount={summary.totalOverdueValue}
            amountFormat="currency"
            variant="danger"
            icon={<AlertTriangle />}
            loading={loading}
          />
          <MetricCard
            label="A vencer"
            amount={summary.totalDueValue}
            amountFormat="currency"
            variant="neutral"
            icon={<CalendarClock />}
            loading={loading}
          />
          <MetricCard
            label="Ticket médio"
            amount={summary.averageTicket}
            amountFormat="currency"
            variant="neutral"
            icon={<Scale />}
            loading={loading}
          />
        </SummaryKpiGrid>
        </ExecutiveSummarySection>
      ) : null}

      <div className="flex flex-wrap gap-3 items-end ar-titles-no-print">
        <label className="space-y-1">
          <span className="text-[10px] font-bold uppercase text-muted-foreground">Ordenar por</span>
          <select
            value={sortBy}
            onChange={(e) => {
              setSortBy(e.target.value as FinanceArTitlesSortBy);
              setPage(1);
            }}
            className="h-9 rounded-lg border border-border bg-background px-2.5 text-sm"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-[10px] font-bold uppercase text-muted-foreground">Direção</span>
          <select
            value={sortDirection}
            onChange={(e) => {
              setSortDirection(e.target.value as "asc" | "desc");
              setPage(1);
            }}
            className="h-9 rounded-lg border border-border bg-background px-2.5 text-sm"
          >
            <option value="asc">Ascendente</option>
            <option value="desc">Descendente</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-[10px] font-bold uppercase text-muted-foreground">Por página</span>
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(1);
            }}
            className="h-9 rounded-lg border border-border bg-background px-2.5 text-sm"
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>

      {initialLoad ? <FinanceArLoadingBlock label="títulos analíticos" /> : null}

      {!initialLoad && !error && data && data.items.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center rounded-lg border border-dashed border-border">
          Nenhum título encontrado para os filtros informados.
        </p>
      ) : null}

      {data?.items.length ? (
        <>
          <FinanceArScrollableTable tableClassName="min-w-[1400px]">
            <FinanceArStickyTableHead>
              <tr className="text-left text-[10px] font-bold uppercase text-muted-foreground">
                <th className="p-2 min-w-[120px]">Cliente</th>
                <th className="p-2 min-w-[100px]">Empresa</th>
                <th className="p-2 whitespace-nowrap">Documento</th>
                <th className="p-2 whitespace-nowrap">Pedido/NF</th>
                <th className="p-2 min-w-[140px]">Descrição</th>
                <th className="p-2 whitespace-nowrap">Emissão</th>
                <th className="p-2 whitespace-nowrap">Vencimento</th>
                <th className="p-2 whitespace-nowrap">Recebimento</th>
                <th className="p-2">Status</th>
                <th className="p-2 text-right">Dias atraso</th>
                <th className="p-2 text-right">Original</th>
                <th className="p-2 text-right">Recebido</th>
                <th className="p-2 text-right">Em aberto</th>
                <th className="p-2">Forma pag.</th>
                <th className="p-2">Origem</th>
                <th className="p-2 min-w-[120px]">Observação</th>
              </tr>
            </FinanceArStickyTableHead>
            <tbody>
              {data.items.map((row) => (
                <tr key={row.externalId} className="border-b border-border/60 hover:bg-muted/20 text-xs">
                  <td className="p-2">{displayFinanceText(row.personName)}</td>
                  <td className="p-2">{displayFinanceText(row.companyName)}</td>
                  <td className="p-2 font-mono">
                    {displayFinanceText(
                      row.sourceInvoiceNumber ??
                        (row.sourceInvoiceId != null ? String(row.sourceInvoiceId) : null)
                    )}
                  </td>
                  <td className="p-2 font-mono">{displayFinanceText(row.sourceInvoiceNumber)}</td>
                  <td className="p-2 max-w-[180px] truncate" title={row.description ?? undefined}>
                    {displayFinanceText(row.description)}
                  </td>
                  <td className="p-2 whitespace-nowrap">{formatFinanceDate(row.competenceDate)}</td>
                  <td className="p-2 whitespace-nowrap">{formatFinanceDate(row.dueDate)}</td>
                  <td className="p-2 whitespace-nowrap">{formatFinanceDate(row.settlementDate)}</td>
                  <td className="p-2">
                    <StatusBadge status={row.calculatedStatus} />
                  </td>
                  <td className="p-2 text-right tabular-nums">{row.daysOverdue}</td>
                  <td className="p-2 text-right tabular-nums">{formatFinanceCurrency(row.amountReceivable)}</td>
                  <td className="p-2 text-right tabular-nums">{formatFinanceCurrency(row.amountReceived)}</td>
                  <td className="p-2 text-right tabular-nums font-semibold">
                    {formatFinanceCurrency(row.balanceReceivable)}
                  </td>
                  <td className="p-2">{displayFinanceText(row.paymentMethodName)}</td>
                  <td className="p-2">{originLabel(row.origin)}</td>
                  <td className="p-2 max-w-[140px] truncate" title={row.comments ?? undefined}>
                    {displayFinanceText(row.comments)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border bg-muted/30 text-xs font-bold">
                <td className="p-2" colSpan={10}>
                  Total ({formatFinanceInteger(summary?.totalTitles ?? 0)} títulos)
                </td>
                <td className="p-2 text-right">{formatFinanceCurrency(summary?.totalOriginalValue ?? 0)}</td>
                <td className="p-2 text-right">{formatFinanceCurrency(summary?.totalReceivedValue ?? 0)}</td>
                <td className="p-2 text-right">{formatFinanceCurrency(summary?.totalOpenValue ?? 0)}</td>
                <td className="p-2" colSpan={3} />
              </tr>
            </tfoot>
          </FinanceArScrollableTable>

          <div className="flex flex-wrap items-center justify-between gap-3 text-sm ar-titles-no-print">
            <p className="text-muted-foreground tabular-nums">
              {formatFinanceInteger(data.total)} títulos · página {data.page} de {data.totalPages}
              {loading ? " · atualizando…" : ""}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={data.page <= 1 || loading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2 text-xs disabled:opacity-50"
              >
                <ChevronLeft className="h-4 w-4" /> Anterior
              </button>
              <button
                type="button"
                disabled={data.page >= data.totalPages || loading}
                onClick={() => setPage((p) => p + 1)}
                className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2 text-xs disabled:opacity-50"
              >
                Próxima <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </>
      ) : null}

      {printPayload && printItems
        ? createPortal(
            <FinanceAccountsReceivableTitlesPrintDocument
              payload={printPayload}
              filters={appliedFilters}
              allItems={printItems}
              generatedAt={new Date().toISOString()}
              emitterName={auth.user?.name}
            />,
            document.body
          )
        : null}
    </div>
  );
}
