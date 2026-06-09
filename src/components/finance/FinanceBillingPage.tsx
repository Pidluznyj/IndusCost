import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Filter,
  Loader2,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import { useAuth } from "@/src/contexts/AuthContext";
import { fetchJsonOk } from "@/src/lib/http";
import {
  buildFinanceBillingDashboardQuery,
  buildFinanceBillingYearOptions,
  createDefaultFinanceBillingYear,
  FINANCE_BILLING_TABS,
  hasPendingFinanceBillingYearChange,
  type FinanceBillingDashboardPayload,
  type FinanceBillingTabId,
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
import { formatFinanceDateTime } from "@/src/lib/financeAccountsPayableFormat";
import {
  FinanceApErrorBanner,
  FinanceApLoadingBlock,
} from "@/src/components/finance/FinanceAccountsPayableUiShared";
import { FinanceBillingNfeSyncPanel } from "@/src/components/finance/FinanceBillingNfeSyncPanel";
import { FinanceBillingSourceBadge } from "@/src/components/finance/billing/FinanceBillingSourceBadge";
import {
  FinanceBillingAccumulatedView,
  FinanceBillingMonthlyView,
  FinanceBillingOverviewView,
  FinanceBillingProjectionView,
} from "@/src/components/finance/billing/FinanceBillingExecutiveViews";
import { FinanceBillingComparisonPanel } from "@/src/components/finance/billing/FinanceBillingComparisonPanel";
import { FinanceBillingNfeDetailsTable } from "@/src/components/finance/billing/FinanceBillingNfeDetailsTable";
import { cn } from "@/src/lib/utils";
import {
  FINANCE_BILLING_EXECUTIVE_YEAR_SCOPE,
  FINANCE_SYNC_GLOBAL_SCOPE,
} from "@/src/lib/financeFilterScope";

export function FinanceBillingPage() {
  const auth = useAuth();
  const canRunSync = canRunFinanceBillingNfeSync(auth);
  const defaultYear = createDefaultFinanceBillingYear();

  const [activeTab, setActiveTab] = useState<FinanceBillingTabId>("overview");
  const [showFilters, setShowFilters] = useState(false);
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
  const [loadingComparison, setLoadingComparison] = useState(false);
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
      setError("Não foi possível carregar o faturamento. Tente novamente.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
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
      setNfeError("Não foi possível listar NF-e sincronizadas.");
    } finally {
      if (!controller.signal.aborted) setLoadingNfe(false);
    }
  }, [nfeQueryString]);

  const loadComparison = useCallback(async () => {
    abortComparisonRef.current?.abort();
    const controller = new AbortController();
    abortComparisonRef.current = controller;
    setLoadingComparison(true);
    try {
      const url = `/api/finance/billing/comparison?year=${encodeURIComponent(appliedYear)}`;
      const payload = await fetchJsonOk<FinanceBillingComparisonPayload>(url, {
        signal: controller.signal,
        credentials: "include",
      });
      if (controller.signal.aborted) return;
      setComparison(payload);
    } catch {
      /* comparativo é opcional */
    } finally {
      if (!controller.signal.aborted) setLoadingComparison(false);
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

  const handleRefreshAll = () => {
    void loadDashboard();
    void loadNfeList();
    void loadComparison();
  };

  const comparisonLabel = data
    ? `${data.selectedYear} × ${data.previousYear}`
    : `${appliedYear} × ${Number.parseInt(appliedYear, 10) - 1}`;

  const filtersActive =
    appliedNfeFilters.month ||
    appliedNfeFilters.customerCnpj ||
    appliedNfeFilters.documentNumber ||
    appliedNfeFilters.classification !== "all" ||
    appliedNfeFilters.status !== "all";

  return (
    <div className="space-y-5 pb-10 min-h-screen">
      {/* Header */}
      <header className="rounded-2xl border border-border/70 bg-gradient-to-br from-card via-card/90 to-card/60 p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Financeiro · Mercado
            </p>
            <h1 className="text-2xl font-extrabold tracking-tight text-foreground">Faturamento</h1>
            <p className="text-sm text-muted-foreground max-w-2xl">
              Painel executivo de faturamento de mercado. Comparativo {comparisonLabel}.
            </p>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <FinanceBillingSourceBadge variant="official" />
              <FinanceBillingSourceBadge variant="diagnostic" />
            </div>
            <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground pt-1">
              <div>
                <dt className="inline">Período: </dt>
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
                <dt className="inline">Atualizado: </dt>
                <dd className="inline font-semibold text-foreground">
                  {data ? formatFinanceDateTime(data.generatedAt) : loading ? "…" : "—"}
                </dd>
              </div>
            </dl>
          </div>
          <button
            type="button"
            onClick={handleRefreshAll}
            disabled={loading}
            aria-busy={loading}
            className="inline-flex h-9 items-center gap-2 rounded-xl border border-border bg-background px-3 text-xs font-semibold hover:bg-accent disabled:opacity-50 shrink-0"
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Atualizar painel
          </button>
        </div>
      </header>

      <FinanceBillingNfeSyncPanel
        canRun={canRunSync}
        onSyncFinished={() => {
          void loadDashboard();
          void loadNfeList();
          void loadComparison();
        }}
      />

      <p className="text-[11px] text-muted-foreground">{FINANCE_SYNC_GLOBAL_SCOPE}</p>

      {error ? (
        <FinanceApErrorBanner
          message={error}
          onRetry={() => void loadDashboard()}
          onDismiss={() => setError(null)}
        />
      ) : null}

      {/* Filtros colapsáveis */}
      <section className="rounded-2xl border border-border/70 bg-card/50 overflow-hidden shadow-sm">
        <button
          type="button"
          onClick={() => setShowFilters((v) => !v)}
          className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-muted/30 transition-colors"
        >
          <div className="flex items-center gap-2.5">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-semibold text-foreground">Filtros</span>
            <span className="text-xs text-muted-foreground">Ano: {appliedYear}</span>
            {filtersActive ? (
              <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold text-primary">
                NF-e ativos
              </span>
            ) : null}
            {hasPendingFilterChanges ? (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                Não aplicados
              </span>
            ) : null}
          </div>
          {showFilters ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </button>
        {showFilters ? (
          <div className="border-t border-border/50 p-5 space-y-4 bg-background/50">
            <p className="text-[11px] text-muted-foreground">{FINANCE_BILLING_EXECUTIVE_YEAR_SCOPE}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
              <FilterField label="Ano">
                <select
                  value={draftYear}
                  onChange={(e) => {
                    setDraftYear(e.target.value);
                    setDraftNfeFilters((p) => ({ ...p, year: e.target.value }));
                  }}
                  className="w-full h-9 rounded-xl border border-border bg-background px-2.5 text-sm"
                >
                  {yearOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </FilterField>
              <FilterField label="Mês (NF-e)">
                <select
                  value={draftNfeFilters.month}
                  onChange={(e) => setDraftNfeFilters((p) => ({ ...p, month: e.target.value }))}
                  className="w-full h-9 rounded-xl border border-border bg-background px-2.5 text-sm"
                >
                  {FINANCE_BILLING_MONTH_OPTIONS.map((o) => (
                    <option key={o.value || "all"} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </FilterField>
              <FilterField label="Cliente / CNPJ">
                <input
                  value={draftNfeFilters.customerCnpj}
                  onChange={(e) =>
                    setDraftNfeFilters((p) => ({ ...p, customerCnpj: e.target.value }))
                  }
                  placeholder="CNPJ ou parte"
                  className="w-full h-9 rounded-xl border border-border bg-background px-2.5 text-sm"
                />
              </FilterField>
              <FilterField label="Número NF">
                <input
                  value={draftNfeFilters.documentNumber}
                  onChange={(e) =>
                    setDraftNfeFilters((p) => ({ ...p, documentNumber: e.target.value }))
                  }
                  placeholder="Ex.: 12345"
                  className="w-full h-9 rounded-xl border border-border bg-background px-2.5 text-sm"
                />
              </FilterField>
              <FilterField label="Classificação">
                <select
                  value={draftNfeFilters.classification}
                  onChange={(e) =>
                    setDraftNfeFilters((p) => ({
                      ...p,
                      classification: e.target.value as FinanceBillingNfeDraftFilters["classification"],
                    }))
                  }
                  className="w-full h-9 rounded-xl border border-border bg-background px-2.5 text-sm"
                >
                  <option value="all">Todas</option>
                  <option value="market">Mercado</option>
                  <option value="group">Grupo</option>
                  <option value="logistics">Logística</option>
                </select>
              </FilterField>
              <FilterField label="Status NF">
                <select
                  value={draftNfeFilters.status}
                  onChange={(e) =>
                    setDraftNfeFilters((p) => ({
                      ...p,
                      status: e.target.value as FinanceBillingNfeDraftFilters["status"],
                    }))
                  }
                  className="w-full h-9 rounded-xl border border-border bg-background px-2.5 text-sm"
                >
                  <option value="all">Todas</option>
                  <option value="authorized">Autorizada</option>
                  <option value="cancelled">Cancelada</option>
                </select>
              </FilterField>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleApplyFilters}
                disabled={!hasPendingFilterChanges || loading}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-primary px-4 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                <Filter className="h-3.5 w-3.5" />
                Aplicar filtros
              </button>
              <button
                type="button"
                onClick={handleClearFilters}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border px-3 text-xs font-semibold hover:bg-accent"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Limpar filtros
              </button>
            </div>
          </div>
        ) : null}
      </section>

      {/* Tabs internas */}
      <div className="rounded-2xl border border-border/70 bg-card/50 overflow-hidden shadow-sm">
        <nav className="flex flex-wrap gap-1 p-2 border-b border-border/50 bg-background/30">
          {FINANCE_BILLING_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "rounded-xl px-3 py-2 text-xs font-semibold transition-colors",
                activeTab === tab.id
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              )}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="p-5" role="tabpanel">
          {loading && !data ? <FinanceApLoadingBlock label="faturamento" /> : null}

          {activeTab === "overview" ? (
            <FinanceBillingOverviewView data={data} loading={loading} />
          ) : null}
          {activeTab === "accumulated" ? (
            <FinanceBillingAccumulatedView data={data} loading={loading} />
          ) : null}
          {activeTab === "monthly" ? (
            <FinanceBillingMonthlyView data={data} loading={loading} />
          ) : null}
          {activeTab === "projection" ? (
            <FinanceBillingProjectionView data={data} loading={loading} />
          ) : null}
          {activeTab === "nfe-details" ? (
            <FinanceBillingNfeDetailsTable
              nfeList={nfeList}
              loading={loadingNfe}
              error={nfeError}
              onRetry={() => void loadNfeList()}
            />
          ) : null}
          {activeTab === "comparison" ? (
            <FinanceBillingComparisonPanel
              comparison={comparison}
              loading={loadingComparison}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1 block min-w-0">
      <span className="text-[10px] font-bold uppercase text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
