import "@/src/components/print/print-document.css";
import "./finance-ap-titles-print.css";
import "./finance-ap-analytical-titles-table.css";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Download,
  FileText,
  Loader2,
  Printer,
  Receipt,
  RotateCcw,
  Scale,
  Wallet,
} from "lucide-react";
import { useAuth } from "@/src/contexts/AuthContext";
import { fetchJsonOk } from "@/src/lib/http";
import { fetchUiSessionCachedJson } from "@/src/lib/uiSessionGetCache";
import { buildFinanceTabLoadError } from "@/src/lib/financeTabLoadError";
import { FinanceExecutiveTotalizerCard } from "@/src/components/finance/shared/FinanceExecutiveTotalizerCard";
import { SYSTEM_TOTALIZER_GRID_CLASS } from "@/src/components/ui/SystemTotalizerCard";
import { ExecutiveSummarySection } from "@/src/components/ui/ExecutiveSummarySection";
import { SummaryKpiGrid } from "@/src/components/ui/SummaryKpiGrid";
import type {
  FinanceApTitleListItem,
  FinanceApTitlesPayload,
  FinanceApTitlesSortBy,
} from "@/src/lib/financeAccountsPayableTitles.js";
import {
  buildFinanceApExportQuery,
  buildFinanceApTitlesQuery,
  buildFinanceApYearOptions,
  createDefaultFinanceApUiFilters,
  FINANCE_AP_MONTH_OPTIONS,
  FINANCE_AP_STATUS_OPTIONS,
  FINANCE_AP_SUSPEND_PAYMENT_OPTIONS,
  normalizeFinanceApUiFilters,
  type FinanceApUiFilters,
} from "@/src/lib/financeAccountsPayableDashboardTypes";
import {
  displayFinanceText,
  financeApExportFilename,
  formatFinanceCurrency,
  formatFinanceDate,
  formatFinanceDaysOverdue,
  formatFinanceInteger,
} from "@/src/lib/financeAccountsPayableFormat";
import { FINANCE_AP_TITLES_PRINT_PAGE_SIZE } from "@/src/lib/financeApTitlesPrint";
import { StatusBadge } from "@/src/components/finance/FinanceAccountsPayableTabPanels";
import {
  FinanceApErrorBanner,
  FinanceApLoadingBlock,
} from "@/src/components/finance/FinanceAccountsPayableUiShared";
import { FinanceAccountsPayableTitlesPrintDocument } from "@/src/components/finance/FinanceAccountsPayableTitlesPrintDocument";
import { DEFAULT_BRANDING, type BrandingSettingsDTO } from "@/src/types/branding";

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const;

const SORT_OPTIONS: Array<{ value: FinanceApTitlesSortBy; label: string }> = [
  { value: "dueDate", label: "Vencimento" },
  { value: "balancePayable", label: "Saldo em aberto" },
  { value: "externalId", label: "ID Nomus" },
];

/**
 * Grid Analítico de Títulos a Pagar — tela dedicada (mesma ideia da aba
 * "Títulos" de Contas a Receber): filtros próprios, resumo executivo e grade
 * completa, sem depender do carregamento pesado do dashboard executivo.
 */
export function FinanceApAnalyticalTitlesTab({ canExport }: { canExport: boolean }) {
  const auth = useAuth();
  const yearOptions = React.useMemo(() => buildFinanceApYearOptions(), []);

  const [draftFilters, setDraftFilters] = useState<FinanceApUiFilters>(() =>
    createDefaultFinanceApUiFilters()
  );
  const [appliedFilters, setAppliedFilters] = useState<FinanceApUiFilters>(() =>
    createDefaultFinanceApUiFilters()
  );
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [sortBy, setSortBy] = useState<FinanceApTitlesSortBy>("dueDate");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [data, setData] = useState<FinanceApTitlesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [printItems, setPrintItems] = useState<FinanceApTitleListItem[] | null>(null);
  const [printRequestId, setPrintRequestId] = useState(0);
  const [branding, setBranding] = useState<BrandingSettingsDTO>(DEFAULT_BRANDING);
  const abortRef = useRef<AbortController | null>(null);
  const brandingLoadedRef = useRef(false);

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedSearch(search), 400);
    return () => window.clearTimeout(id);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [appliedFilters, debouncedSearch, sortBy, sortDirection]);

  const ensureBranding = useCallback(async () => {
    if (brandingLoadedRef.current) return branding;
    try {
      const next = await fetchUiSessionCachedJson<BrandingSettingsDTO>("/api/branding-settings", {
        ttlMs: 300_000,
      });
      brandingLoadedRef.current = true;
      setBranding(next);
      return next;
    } catch {
      brandingLoadedRef.current = true;
      setBranding(DEFAULT_BRANDING);
      return DEFAULT_BRANDING;
    }
  }, [branding]);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const qs = buildFinanceApTitlesQuery(appliedFilters, {
        page,
        limit: pageSize,
        sortBy,
        sortDirection,
        search: debouncedSearch,
      });
      const payload = await fetchUiSessionCachedJson<FinanceApTitlesPayload>(
        `/api/finance/accounts-payable/titles?${qs}`,
        { signal: controller.signal }
      );
      if (controller.signal.aborted) return;
      setData(payload);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      console.error("FinanceApAnalyticalTitlesTab.load", e);
      setError(
        buildFinanceTabLoadError("Não foi possível carregar os títulos de Contas a Pagar.", e)
      );
      setData(null);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [appliedFilters, page, pageSize, sortBy, sortDirection, debouncedSearch]);

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load]);

  useEffect(() => {
    if (printRequestId === 0 || !printItems) return;

    document.body.classList.add("ap-titles-print-route");

    const onAfterPrint = () => {
      document.body.classList.remove("ap-titles-print-route");
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
  }, [printRequestId, printItems]);

  const handleApplyFilters = () => {
    const normalized = normalizeFinanceApUiFilters(draftFilters);
    setDraftFilters(normalized);
    setAppliedFilters(normalized);
    setPage(1);
  };

  const handleClearFilters = () => {
    const defaults = createDefaultFinanceApUiFilters();
    setDraftFilters(defaults);
    setAppliedFilters(defaults);
    setSearch("");
    setPage(1);
  };

  const handleExportCsv = async () => {
    if (!canExport || exporting) return;
    setExporting(true);
    setError(null);
    try {
      const qs = buildFinanceApExportQuery(appliedFilters);
      const res = await fetch(`/api/finance/accounts-payable/export?${qs}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Falha ao exportar CSV.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = financeApExportFilename();
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(buildFinanceTabLoadError("Erro ao exportar CSV de títulos a pagar.", e));
    } finally {
      setExporting(false);
    }
  };

  const handleExportPdf = async () => {
    if (!canExport || printing) return;
    setPrinting(true);
    setError(null);
    try {
      await ensureBranding();
      const qs = buildFinanceApTitlesQuery(appliedFilters, {
        page: 1,
        limit: FINANCE_AP_TITLES_PRINT_PAGE_SIZE,
        sortBy,
        sortDirection,
        search: debouncedSearch,
      });
      const payload = await fetchJsonOk<FinanceApTitlesPayload>(
        `/api/finance/accounts-payable/titles?${qs}`
      );
      setPrintItems(payload.items);
      setPrintRequestId((id) => id + 1);
    } catch (e) {
      setError(buildFinanceTabLoadError("Erro ao preparar PDF de títulos a pagar.", e));
      setPrinting(false);
    }
  };

  const summary = data?.summary;
  const initialLoad = loading && !data && !error;

  return (
    <div className="space-y-4" data-testid="finance-ap-analytical-titles">
      <div className="rounded-2xl border border-border/70 bg-card p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-[#111827]">Grid Analítico de Títulos</h2>
            <p className="text-[11px] text-[#6B7280] mt-0.5">
              Todos os títulos de contas a pagar com status, filtros próprios e exportação —
              carregamento independente do painel executivo.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 ap-titles-no-print">
            {canExport ? (
              <>
                <button
                  type="button"
                  onClick={() => void handleExportCsv()}
                  disabled={exporting || loading}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-semibold hover:bg-accent disabled:opacity-50"
                >
                  {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                  Exportar CSV
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
          <label className="space-y-1">
            <span className="text-[10px] font-bold uppercase text-muted-foreground">Fornecedor</span>
            <input
              value={draftFilters.personName}
              onChange={(e) => setDraftFilters((p) => ({ ...p, personName: e.target.value }))}
              placeholder="Nome do fornecedor"
              className="w-full h-9 rounded-lg border border-border bg-background px-2.5 text-sm"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] font-bold uppercase text-muted-foreground">CNPJ/CPF</span>
            <input
              value={draftFilters.personCnpj}
              onChange={(e) => setDraftFilters((p) => ({ ...p, personCnpj: e.target.value }))}
              className="w-full h-9 rounded-lg border border-border bg-background px-2.5 text-sm"
            />
          </label>
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
              onChange={(e) =>
                setDraftFilters((p) => {
                  const next = { ...p, month: e.target.value };
                  if (e.target.value && !p.year.trim()) next.year = String(new Date().getFullYear());
                  return next;
                })
              }
              className="w-full h-9 rounded-lg border border-border bg-background px-2.5 text-sm"
            >
              {FINANCE_AP_MONTH_OPTIONS.map((o) => (
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
            <span className="text-[10px] font-bold uppercase text-muted-foreground">Status</span>
            <select
              value={draftFilters.status}
              onChange={(e) => setDraftFilters((p) => ({ ...p, status: e.target.value }))}
              className="w-full h-9 rounded-lg border border-border bg-background px-2.5 text-sm"
            >
              {FINANCE_AP_STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[10px] font-bold uppercase text-muted-foreground">Documento / NF</span>
            <input
              value={draftFilters.documentQuery}
              onChange={(e) => setDraftFilters((p) => ({ ...p, documentQuery: e.target.value }))}
              placeholder="Número do documento ou NF"
              className="w-full h-9 rounded-lg border border-border bg-background px-2.5 text-sm"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] font-bold uppercase text-muted-foreground">Forma de pagamento</span>
            <input
              value={draftFilters.paymentMethodName}
              onChange={(e) => setDraftFilters((p) => ({ ...p, paymentMethodName: e.target.value }))}
              className="w-full h-9 rounded-lg border border-border bg-background px-2.5 text-sm"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] font-bold uppercase text-muted-foreground">Conta bancária</span>
            <input
              value={draftFilters.bankAccountName}
              onChange={(e) => setDraftFilters((p) => ({ ...p, bankAccountName: e.target.value }))}
              className="w-full h-9 rounded-lg border border-border bg-background px-2.5 text-sm"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] font-bold uppercase text-muted-foreground">Pagamento suspenso</span>
            <select
              value={draftFilters.suspendPayment}
              onChange={(e) => setDraftFilters((p) => ({ ...p, suspendPayment: e.target.value }))}
              className="w-full h-9 rounded-lg border border-border bg-background px-2.5 text-sm"
            >
              {FINANCE_AP_SUSPEND_PAYMENT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex flex-wrap gap-2 ap-titles-no-print">
          <button
            type="button"
            onClick={handleApplyFilters}
            className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
          >
            Aplicar filtros
          </button>
        </div>
      </div>

      {error ? (
        <FinanceApErrorBanner message={error} onRetry={() => void load()} onDismiss={() => setError(null)} />
      ) : null}

      {summary ? (
        <ExecutiveSummarySection
          title="Resumo dos títulos"
          eyebrow="Totais da carteira conforme filtros aplicados"
          testId="finance-ap-titles-executive-summary"
        >
          <SummaryKpiGrid testId="finance-ap-titles-summary-kpis" className={SYSTEM_TOTALIZER_GRID_CLASS}>
            <FinanceExecutiveTotalizerCard
              label="Títulos"
              amount={summary.totalTitles}
              amountFormat="number"
              tone="info"
              icon={FileText}
              loading={loading}
            />
            <FinanceExecutiveTotalizerCard
              label="Valor original"
              amount={summary.totalOriginalValue}
              amountFormat="currency"
              tone="neutral"
              icon={Receipt}
              loading={loading}
            />
            <FinanceExecutiveTotalizerCard
              label="Valor pago"
              amount={summary.totalPaidValue}
              amountFormat="currency"
              tone="success"
              icon={CheckCircle2}
              loading={loading}
            />
            <FinanceExecutiveTotalizerCard
              label="Em aberto"
              amount={summary.totalOpenValue}
              amountFormat="currency"
              tone="info"
              icon={Wallet}
              loading={loading}
            />
            <FinanceExecutiveTotalizerCard
              label="Vencido"
              amount={summary.totalOverdueValue}
              amountFormat="currency"
              tone="danger"
              icon={AlertTriangle}
              loading={loading}
            />
            <FinanceExecutiveTotalizerCard
              label="A vencer"
              amount={summary.totalDueValue}
              amountFormat="currency"
              tone="neutral"
              icon={CalendarClock}
              loading={loading}
            />
            <FinanceExecutiveTotalizerCard
              label="Ticket médio"
              amount={summary.averageTicket}
              amountFormat="currency"
              tone="neutral"
              icon={Scale}
              loading={loading}
            />
          </SummaryKpiGrid>
        </ExecutiveSummarySection>
      ) : null}

      <div className="flex flex-wrap gap-3 items-end ap-titles-no-print">
        <label className="space-y-1 flex-1 min-w-[200px]">
          <span className="text-[10px] font-bold uppercase text-muted-foreground">Busca</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Fornecedor, CNPJ, NF ou ID Nomus"
            className="w-full h-9 rounded-lg border border-border bg-background px-2.5 text-sm"
          />
        </label>
        <label className="space-y-1">
          <span className="text-[10px] font-bold uppercase text-muted-foreground">Ordenar por</span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as FinanceApTitlesSortBy)}
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
            onChange={(e) => setSortDirection(e.target.value as "asc" | "desc")}
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
            onChange={(e) => setPageSize(Number(e.target.value))}
            className="h-9 rounded-lg border border-border bg-background px-2.5 text-sm"
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-semibold hover:bg-accent disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Atualizar lista
        </button>
      </div>

      {initialLoad ? <FinanceApLoadingBlock label="títulos" /> : null}

      {!initialLoad && !error && !data?.items.length && !loading ? (
        <p className="text-sm text-muted-foreground py-8 text-center rounded-lg border border-dashed border-border">
          Nenhum título encontrado para os filtros informados.
        </p>
      ) : null}

      {data?.items.length ? (
        <>
          <div
            className="finance-ap-titles-list-section"
            data-testid="finance-ap-analytical-titles-table-wrap"
          >
            <div className="finance-ap-titles-list-grid-title">Títulos</div>
            <div className="finance-ap-titles-list-table-wrap">
              <table
                className="finance-ap-titles-list-table"
                data-testid="finance-ap-analytical-titles-table"
              >
                <thead>
                  <tr>
                    <th>Título</th>
                    <th>Fornecedor</th>
                    <th>CNPJ</th>
                    <th>Descrição</th>
                    <th>Vencimento</th>
                    <th>Baixa/Pagamento</th>
                    <th>Status</th>
                    <th className="ap-value-cell">Original</th>
                    <th className="ap-value-cell">Pago</th>
                    <th className="ap-value-cell">Saldo</th>
                    <th>Forma pag.</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((row) => {
                    const companyName = row.companyName?.trim() || null;
                    return (
                      <tr key={row.externalId} title={row.description ?? undefined}>
                        <td>
                          <div className="ap-cell-title-code">#{row.externalId}</div>
                        </td>
                        <td className="max-w-[14rem]">
                          <span className="ap-cell-ellipsis block" title={displayFinanceText(row.personName)}>
                            {displayFinanceText(row.personName)}
                          </span>
                          {companyName ? (
                            <div className="ap-cell-meta ap-cell-ellipsis" title={companyName}>
                              {companyName}
                            </div>
                          ) : null}
                        </td>
                        <td className="font-mono whitespace-nowrap">
                          {displayFinanceText(row.personCnpj)}
                        </td>
                        <td>
                          <span
                            className="ap-cell-ellipsis block max-w-[12rem]"
                            title={row.description ?? undefined}
                          >
                            {displayFinanceText(row.description)}
                          </span>
                        </td>
                        <td>
                          <div className="whitespace-nowrap tabular-nums">
                            {formatFinanceDate(row.dueDate)}
                          </div>
                          {row.daysOverdue > 0 ? (
                            <div className="ap-cell-meta">
                              {formatFinanceDaysOverdue(row.daysOverdue)} atraso
                            </div>
                          ) : null}
                        </td>
                        <td className="whitespace-nowrap tabular-nums">
                          {formatFinanceDate(row.paymentDate ?? row.settlementDate)}
                        </td>
                        <td>
                          <StatusBadge status={row.calculatedStatus} />
                        </td>
                        <td className="ap-value-cell">{formatFinanceCurrency(row.amountPayable)}</td>
                        <td className="ap-value-cell">{formatFinanceCurrency(row.amountPaid)}</td>
                        <td className="ap-value-cell ap-value-cell--emphasis">
                          {formatFinanceCurrency(row.balancePayable)}
                        </td>
                        <td>
                          <span
                            className="ap-cell-ellipsis block max-w-[8rem]"
                            title={row.paymentMethodName ?? undefined}
                          >
                            {displayFinanceText(row.paymentMethodName)}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={7}>
                      Total ({formatFinanceInteger(summary?.totalTitles ?? 0)} títulos)
                    </td>
                    <td className="ap-value-cell">
                      {formatFinanceCurrency(summary?.totalOriginalValue ?? 0)}
                    </td>
                    <td className="ap-value-cell">
                      {formatFinanceCurrency(summary?.totalPaidValue ?? 0)}
                    </td>
                    <td className="ap-value-cell">
                      {formatFinanceCurrency(summary?.totalOpenValue ?? 0)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
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

      {printItems
        ? createPortal(
            <FinanceAccountsPayableTitlesPrintDocument
              filters={appliedFilters}
              allItems={printItems}
              generatedAt={new Date().toISOString()}
              emitterName={auth.authUser?.name}
              branding={branding}
            />,
            document.body
          )
        : null}
    </div>
  );
}
