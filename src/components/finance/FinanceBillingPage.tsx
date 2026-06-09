import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Filter, Loader2, RefreshCw, RotateCcw } from "lucide-react";
import { useAuth } from "@/src/contexts/AuthContext";
import { fetchJsonOk } from "@/src/lib/http";
import { ExecutiveBillingTab } from "@/src/components/dashboard/ExecutiveBillingTab";
import {
  buildFinanceBillingDashboardQuery,
  buildFinanceBillingYearOptions,
  createDefaultFinanceBillingYear,
  hasPendingFinanceBillingYearChange,
  type FinanceBillingDashboardPayload,
} from "@/src/lib/financeBillingDashboardTypes";
import {
  buildFinanceBillingNfeQuery,
  createDefaultFinanceBillingNfeFilters,
  FINANCE_BILLING_MONTH_OPTIONS,
  hasPendingFinanceBillingNfeFilterChanges,
  type FinanceBillingNfeDraftFilters,
} from "@/src/lib/financeBillingNfeFiltersTypes";
import type { FinanceBillingComparisonPayload } from "@/src/lib/financeBillingNfeComparison";
import type { FinanceBillingNfeListPayload } from "@/src/lib/financeBillingNfeList";
import { canRunFinanceBillingNfeSync } from "@/src/lib/financeBillingPermissions";
import { formatFinanceDateTime, formatFinanceCurrency } from "@/src/lib/financeAccountsPayableFormat";
import {
  FinanceApErrorBanner,
  FinanceApLoadingBlock,
} from "@/src/components/finance/FinanceAccountsPayableUiShared";
import { FinanceBillingNfeSyncPanel } from "@/src/components/finance/FinanceBillingNfeSyncPanel";

export function FinanceBillingPage() {
  const auth = useAuth();
  const canRunSync = canRunFinanceBillingNfeSync(auth);
  const defaultYear = createDefaultFinanceBillingYear();

  const [draftYear, setDraftYear] = useState(defaultYear);
  const [appliedYear, setAppliedYear] = useState(defaultYear);
  const [draftNfeFilters, setDraftNfeFilters] = useState(() =>
    createDefaultFinanceBillingNfeFilters(defaultYear)
  );
  const [appliedNfeFilters, setAppliedNfeFilters] = useState(() =>
    createDefaultFinanceBillingNfeFilters(defaultYear)
  );

  const abortRef = useRef<AbortController | null>(null);
  const abortNfeRef = useRef<AbortController | null>(null);
  const abortComparisonRef = useRef<AbortController | null>(null);

  const yearOptions = useMemo(() => buildFinanceBillingYearOptions(), []);
  const hasPendingFilterChanges = useMemo(
    () =>
      hasPendingFinanceBillingYearChange(draftYear, appliedYear) ||
      hasPendingFinanceBillingNfeFilterChanges(draftNfeFilters, appliedNfeFilters),
    [draftYear, appliedYear, draftNfeFilters, appliedNfeFilters]
  );

  const queryString = useMemo(
    () => buildFinanceBillingDashboardQuery(appliedYear),
    [appliedYear]
  );
  const nfeQueryString = useMemo(
    () => buildFinanceBillingNfeQuery(appliedNfeFilters),
    [appliedNfeFilters]
  );

  const [data, setData] = useState<FinanceBillingDashboardPayload | null>(null);
  const [nfeList, setNfeList] = useState<FinanceBillingNfeListPayload | null>(null);
  const [comparison, setComparison] = useState<FinanceBillingComparisonPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingNfe, setLoadingNfe] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nfeError, setNfeError] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const url = queryString
        ? `/api/finance/billing/dashboard?${queryString}`
        : "/api/finance/billing/dashboard";
      const payload = await fetchJsonOk<FinanceBillingDashboardPayload>(url, {
        signal: controller.signal,
        credentials: "include",
      });
      if (controller.signal.aborted) return;
      setData(payload);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      console.error("FinanceBillingPage.loadDashboard", e);
      setError("Não foi possível carregar o faturamento. Tente novamente.");
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, [queryString]);

  const loadNfeList = useCallback(async () => {
    abortNfeRef.current?.abort();
    const controller = new AbortController();
    abortNfeRef.current = controller;
    setLoadingNfe(true);
    setNfeError(null);
    try {
      const url = nfeQueryString
        ? `/api/finance/billing/nfes?${nfeQueryString}`
        : "/api/finance/billing/nfes";
      const payload = await fetchJsonOk<FinanceBillingNfeListPayload>(url, {
        signal: controller.signal,
        credentials: "include",
      });
      if (controller.signal.aborted) return;
      setNfeList(payload);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      console.error("FinanceBillingPage.loadNfeList", e);
      setNfeError("Não foi possível listar NF-e sincronizadas.");
    } finally {
      if (!controller.signal.aborted) {
        setLoadingNfe(false);
      }
    }
  }, [nfeQueryString]);

  const loadComparison = useCallback(async () => {
    abortComparisonRef.current?.abort();
    const controller = new AbortController();
    abortComparisonRef.current = controller;
    try {
      const url = `/api/finance/billing/comparison?year=${encodeURIComponent(appliedYear)}`;
      const payload = await fetchJsonOk<FinanceBillingComparisonPayload>(url, {
        signal: controller.signal,
        credentials: "include",
      });
      if (controller.signal.aborted) return;
      setComparison(payload);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      console.error("FinanceBillingPage.loadComparison", e);
    }
  }, [appliedYear]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    void loadNfeList();
  }, [loadNfeList]);

  useEffect(() => {
    void loadComparison();
  }, [loadComparison]);

  const handleApplyFilters = () => {
    setAppliedYear(draftYear.trim());
    setAppliedNfeFilters({ ...draftNfeFilters, year: draftYear.trim() });
  };

  const handleClearFilters = () => {
    const year = createDefaultFinanceBillingYear();
    setDraftYear(year);
    setAppliedYear(year);
    const defaults = createDefaultFinanceBillingNfeFilters(year);
    setDraftNfeFilters(defaults);
    setAppliedNfeFilters(defaults);
  };

  const handleSyncFinished = () => {
    void loadNfeList();
    void loadComparison();
  };

  const comparisonLabel = data
    ? `${data.selectedYear} × ${data.previousYear}`
    : `${appliedYear} × ${Number.parseInt(appliedYear, 10) - 1}`;

  return (
    <div className="space-y-5 pb-8">
      <header className="rounded-xl border border-border bg-gradient-to-br from-card/80 to-card/40 p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Financeiro · Mercado
            </p>
            <h3 className="text-2xl font-bold tracking-tight text-foreground">Faturamento</h3>
            <p className="text-sm text-muted-foreground max-w-2xl">
              Painel executivo ainda usa pedidos de venda (NF embutida). A sincronização oficial de
              NF-e alimenta listagem e comparativo diagnóstico.
            </p>
            <dl className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground pt-1">
              <div>
                <dt className="inline">Comparativo: </dt>
                <dd className="inline font-semibold text-foreground">{comparisonLabel}</dd>
              </div>
              <div>
                <dt className="inline">Período de referência: </dt>
                <dd className="inline font-semibold text-foreground">
                  {data?.periodLabel ?? (loading ? "…" : "—")}
                </dd>
              </div>
              <div>
                <dt className="inline">Último faturamento: </dt>
                <dd className="inline font-semibold text-foreground">
                  {data?.lastInvoicedAt
                    ? formatFinanceDateTime(data.lastInvoicedAt)
                    : loading
                      ? "…"
                      : "—"}
                </dd>
              </div>
              <div>
                <dt className="inline">Dados atualizados em: </dt>
                <dd className="inline font-semibold text-foreground">
                  {data ? formatFinanceDateTime(data.generatedAt) : loading ? "…" : "—"}
                </dd>
              </div>
            </dl>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                void loadDashboard();
                void loadNfeList();
                void loadComparison();
              }}
              disabled={loading}
              aria-busy={loading}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-xs font-semibold hover:bg-accent disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Atualizar painel
            </button>
          </div>
        </div>
      </header>

      <FinanceBillingNfeSyncPanel canRun={canRunSync} onSyncFinished={handleSyncFinished} />

      {error ? (
        <FinanceApErrorBanner
          message={error}
          onRetry={() => void loadDashboard()}
          onDismiss={() => setError(null)}
        />
      ) : null}

      <section className="rounded-xl border border-border bg-card/40 p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Filtros globais
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Ano selecionado: {appliedYear}. Comparativo sempre com o ano anterior ({comparisonLabel}
              ).
            </p>
            {hasPendingFilterChanges ? (
              <p className="text-[11px] text-amber-800 font-semibold mt-0.5">
                Há alterações nos filtros ainda não aplicadas.
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleApplyFilters}
              disabled={!hasPendingFilterChanges || loading}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              <Filter className="h-3.5 w-3.5" />
              Aplicar filtros
            </button>
            <button
              type="button"
              onClick={handleClearFilters}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Limpar filtros
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
          <label className="space-y-1 block min-w-0">
            <span className="text-[10px] font-bold uppercase text-muted-foreground">Ano</span>
            <select
              value={draftYear}
              onChange={(e) => {
                setDraftYear(e.target.value);
                setDraftNfeFilters((prev) => ({ ...prev, year: e.target.value }));
              }}
              className="w-full h-9 rounded-lg border border-border bg-background px-2.5 text-sm"
            >
              {yearOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 block min-w-0">
            <span className="text-[10px] font-bold uppercase text-muted-foreground">Mês</span>
            <select
              value={draftNfeFilters.month}
              onChange={(e) => setDraftNfeFilters((p) => ({ ...p, month: e.target.value }))}
              className="w-full h-9 rounded-lg border border-border bg-background px-2.5 text-sm"
            >
              {FINANCE_BILLING_MONTH_OPTIONS.map((o) => (
                <option key={o.value || "all"} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 block min-w-0">
            <span className="text-[10px] font-bold uppercase text-muted-foreground">Cliente / CNPJ</span>
            <input
              value={draftNfeFilters.customerCnpj}
              onChange={(e) => setDraftNfeFilters((p) => ({ ...p, customerCnpj: e.target.value }))}
              placeholder="CNPJ ou parte"
              className="w-full h-9 rounded-lg border border-border bg-background px-2.5 text-sm"
            />
          </label>
          <label className="space-y-1 block min-w-0">
            <span className="text-[10px] font-bold uppercase text-muted-foreground">Número NF</span>
            <input
              value={draftNfeFilters.documentNumber}
              onChange={(e) => setDraftNfeFilters((p) => ({ ...p, documentNumber: e.target.value }))}
              placeholder="Ex.: 12345"
              className="w-full h-9 rounded-lg border border-border bg-background px-2.5 text-sm"
            />
          </label>
          <label className="space-y-1 block min-w-0">
            <span className="text-[10px] font-bold uppercase text-muted-foreground">Classificação</span>
            <select
              value={draftNfeFilters.classification}
              onChange={(e) =>
                setDraftNfeFilters((p) => ({
                  ...p,
                  classification: e.target.value as FinanceBillingNfeDraftFilters["classification"],
                }))
              }
              className="w-full h-9 rounded-lg border border-border bg-background px-2.5 text-sm"
            >
              <option value="all">Todas</option>
              <option value="market">Mercado</option>
              <option value="group">Grupo</option>
              <option value="logistics">Logística</option>
            </select>
          </label>
          <label className="space-y-1 block min-w-0">
            <span className="text-[10px] font-bold uppercase text-muted-foreground">Status</span>
            <select
              value={draftNfeFilters.status}
              onChange={(e) =>
                setDraftNfeFilters((p) => ({
                  ...p,
                  status: e.target.value as FinanceBillingNfeDraftFilters["status"],
                }))
              }
              className="w-full h-9 rounded-lg border border-border bg-background px-2.5 text-sm"
            >
              <option value="all">Todas</option>
              <option value="authorized">Autorizada</option>
              <option value="cancelled">Cancelada</option>
            </select>
          </label>
        </div>
      </section>

      {loading && !data ? <FinanceApLoadingBlock label="faturamento" /> : null}

      {!loading && !error && data?.tab ? (
        <ExecutiveBillingTab tab={data.tab} />
      ) : null}

      {!loading && !error && data && !data.tab.available ? (
        <div className="rounded-xl border border-border bg-card/60 p-6 text-sm text-muted-foreground">
          Sem dados de faturamento para o ano selecionado.
        </div>
      ) : null}

      {comparison ? (
        <section className="rounded-xl border border-border bg-card/40 p-4 space-y-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Comparativo diagnóstico (SalesOrder × NomusNfe)
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">{comparison.note}</p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-2 pr-3">Mês</th>
                  <th className="py-2 pr-3">SalesOrder</th>
                  <th className="py-2 pr-3">NomusNfe</th>
                  <th className="py-2 pr-3">Diferença</th>
                </tr>
              </thead>
              <tbody>
                {comparison.months.map((row) => (
                  <tr key={row.month} className="border-b border-border/50">
                    <td className="py-2 pr-3 font-semibold">{row.month}</td>
                    <td className="py-2 pr-3">{formatFinanceCurrency(row.salesOrderTotal)}</td>
                    <td className="py-2 pr-3">{formatFinanceCurrency(row.nomusNfeTotal)}</td>
                    <td className="py-2 pr-3">{formatFinanceCurrency(row.difference)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold">
                  <td className="py-2 pr-3">Total {comparison.year}</td>
                  <td className="py-2 pr-3">{formatFinanceCurrency(comparison.yearTotalSalesOrder)}</td>
                  <td className="py-2 pr-3">{formatFinanceCurrency(comparison.yearTotalNomusNfe)}</td>
                  <td className="py-2 pr-3">{formatFinanceCurrency(comparison.yearDifference)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      ) : null}

      <section className="rounded-xl border border-border bg-card/40 p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            NF-e sincronizadas ({nfeList?.total ?? 0})
          </p>
          {loadingNfe ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
        </div>
        {nfeError ? (
          <FinanceApErrorBanner
            message={nfeError}
            onRetry={() => void loadNfeList()}
            onDismiss={() => setNfeError(null)}
          />
        ) : null}
        {nfeList && nfeList.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma NF-e local para os filtros. Execute a sincronização de NF-e.
          </p>
        ) : null}
        {nfeList && nfeList.items.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-2 pr-3">NF</th>
                  <th className="py-2 pr-3">Destinatário</th>
                  <th className="py-2 pr-3">Natureza</th>
                  <th className="py-2 pr-3">Classificação</th>
                  <th className="py-2 pr-3">Data fiscal</th>
                  <th className="py-2 pr-3">Valor líquido</th>
                  <th className="py-2 pr-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {nfeList.items.map((row) => (
                  <tr key={row.id} className="border-b border-border/50">
                    <td className="py-2 pr-3 font-semibold">{row.numero ?? row.externalId}</td>
                    <td className="py-2 pr-3">{row.xmlDestCnpjCpf ?? "—"}</td>
                    <td className="py-2 pr-3 max-w-[200px] truncate">{row.xmlNatOp ?? "—"}</td>
                    <td className="py-2 pr-3">{row.billingClassification ?? "—"}</td>
                    <td className="py-2 pr-3">
                      {row.fiscalDate ? formatFinanceDateTime(row.fiscalDate) : "—"}
                    </td>
                    <td className="py-2 pr-3">{formatFinanceCurrency(row.valorLiquido)}</td>
                    <td className="py-2 pr-3">{row.status === 7 ? "Cancelada" : "Autorizada"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  );
}
