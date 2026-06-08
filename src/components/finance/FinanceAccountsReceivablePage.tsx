import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Filter, Loader2, RefreshCw, RotateCcw } from "lucide-react";
import { useAuth } from "@/src/contexts/AuthContext";
import { fetchJsonOk } from "@/src/lib/http";
import {
  buildFinanceArDashboardQuery,
  buildFinanceArExportQuery,
  buildFinanceArYearOptions,
  EMPTY_FINANCE_AR_UI_FILTERS,
  FINANCE_AR_INVOICE_ISSUED_OPTIONS,
  FINANCE_AR_MONTH_OPTIONS,
  FINANCE_AR_STATUS_OPTIONS,
  FINANCE_AR_TABS,
  normalizeFinanceArUiFilters,
  type FinanceArDashboardPayload,
  type FinanceArDataQualityAlertKey,
  type FinanceArTabId,
  type FinanceArUiFilters,
} from "@/src/lib/financeAccountsReceivableDashboardTypes";
import {
  formatFinanceDateTime,
  financeArExportFilename,
  formatFinanceInteger,
} from "@/src/lib/financeAccountsReceivableFormat";
import {
  canExportFinanceAccountsReceivable,
  canRunFinanceAccountsReceivableSync,
} from "@/src/lib/financeAccountsReceivablePermissions";
import {
  FinanceArAgingTab,
  FinanceArCompaniesTab,
  FinanceArCustomersTab,
  FinanceArOverviewTab,
  FinanceArPaymentTab,
  FinanceArScheduleTab,
} from "@/src/components/finance/FinanceAccountsReceivableTabPanels";
import { FinanceAccountsReceivableDataQualityPanel } from "@/src/components/finance/FinanceAccountsReceivableDataQualityPanel";
import { FinanceArInvoicePortfolioPanel } from "@/src/components/finance/FinanceAccountsReceivableInvoicePortfolioPanel";
import { FinanceAccountsReceivableSyncPanel } from "@/src/components/finance/FinanceAccountsReceivableSyncPanel";
import { FinanceArTitlesTab } from "@/src/components/finance/FinanceAccountsReceivableTitlesTab";
import {
  FinanceArErrorBanner,
  FinanceArLoadingBlock,
  FinanceArSuccessBanner,
  FinanceArTabNav,
} from "@/src/components/finance/FinanceAccountsReceivableUiShared";

export function FinanceAccountsReceivablePage() {
  const auth = useAuth();
  const canExport = canExportFinanceAccountsReceivable(auth);
  const canRunSync = canRunFinanceAccountsReceivableSync(auth);

  const [activeTab, setActiveTab] = useState<FinanceArTabId>("overview");
  const [titlesQualityAlert, setTitlesQualityAlert] = useState<FinanceArDataQualityAlertKey | null>(
    null
  );
  const [draftFilters, setDraftFilters] = useState<FinanceArUiFilters>(EMPTY_FINANCE_AR_UI_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<FinanceArUiFilters>(() =>
    normalizeFinanceArUiFilters(EMPTY_FINANCE_AR_UI_FILTERS)
  );

  const normalizedDraftFilters = useMemo(
    () => normalizeFinanceArUiFilters(draftFilters),
    [draftFilters]
  );

  const hasPendingFilterChanges = useMemo(
    () =>
      buildFinanceArDashboardQuery(normalizedDraftFilters) !==
      buildFinanceArDashboardQuery(appliedFilters),
    [normalizedDraftFilters, appliedFilters]
  );

  const yearOptions = useMemo(() => buildFinanceArYearOptions(), []);

  const queryString = useMemo(
    () => buildFinanceArDashboardQuery(appliedFilters),
    [appliedFilters]
  );

  const [data, setData] = useState<FinanceArDashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportSuccess, setExportSuccess] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setDashboardError(null);
    try {
      const url = queryString
        ? `/api/finance/accounts-receivable/dashboard?${queryString}`
        : "/api/finance/accounts-receivable/dashboard";
      const payload = await fetchJsonOk<FinanceArDashboardPayload>(url);
      setData(payload);
    } catch (e) {
      setDashboardError(
        e instanceof Error
          ? e.message
          : "Não foi possível carregar o dashboard. Tente atualizar em instantes."
      );
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const handleExport = async () => {
    if (!canExport) return;
    setExporting(true);
    setExportError(null);
    setExportSuccess(null);
    try {
      const qs = buildFinanceArExportQuery(appliedFilters);
      const res = await fetch(`/api/finance/accounts-receivable/export?${qs}`, {
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
      a.download = financeArExportFilename();
      a.click();
      URL.revokeObjectURL(url);
      setExportSuccess(`Arquivo ${financeArExportFilename()} gerado com os filtros atuais.`);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : "Erro ao exportar CSV.");
    } finally {
      setExporting(false);
    }
  };

  const handleViewTitlesFromAlert = (key: FinanceArDataQualityAlertKey) => {
    setTitlesQualityAlert(key);
    setActiveTab("titles");
  };

  const cards = data?.cards;
  const filtersActive =
    appliedFilters.companyName ||
    appliedFilters.personName ||
    appliedFilters.personCnpj ||
    appliedFilters.status !== "all" ||
    appliedFilters.year ||
    appliedFilters.month ||
    appliedFilters.dueDateFrom ||
    appliedFilters.dueDateTo ||
    appliedFilters.invoiceIssued !== "all" ||
    appliedFilters.paymentMethodName ||
    appliedFilters.bankAccountName;

  const handleApplyFilters = () => {
    setAppliedFilters(normalizedDraftFilters);
  };

  const handleClearFilters = () => {
    const empty = normalizeFinanceArUiFilters(EMPTY_FINANCE_AR_UI_FILTERS);
    setDraftFilters(EMPTY_FINANCE_AR_UI_FILTERS);
    setAppliedFilters(empty);
    setTitlesQualityAlert(null);
  };

  const handleFilterInvoiceIssued = (value: "all" | "yes" | "no") => {
    setDraftFilters((f) => ({ ...f, invoiceIssued: value }));
  };

  return (
    <div className="space-y-5 pb-8">
      <header className="rounded-xl border border-border bg-gradient-to-br from-card/80 to-card/40 p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Financeiro · Carteira
            </p>
            <h3 className="text-2xl font-bold tracking-tight text-foreground">Contas a Receber</h3>
            <p className="text-sm text-muted-foreground max-w-2xl">
              Painel gerencial read-only dos recebíveis sincronizados do Nomus.
            </p>
            <dl className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground pt-1">
              <div>
                <dt className="inline">Última sync: </dt>
                <dd className="inline font-semibold text-foreground">
                  {formatFinanceDateTime(cards?.lastSyncAt)}
                </dd>
              </div>
              <div>
                <dt className="inline">Registros filtrados: </dt>
                <dd className="inline font-semibold text-foreground tabular-nums">
                  {loading && !data ? "…" : formatFinanceInteger(cards?.totalRecords ?? 0)}
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
              onClick={() => void loadDashboard()}
              disabled={loading}
              aria-busy={loading}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-xs font-semibold hover:bg-accent disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Atualizar dashboard
            </button>
            {canExport ? (
              <button
                type="button"
                onClick={() => void handleExport()}
                disabled={exporting || loading}
                aria-busy={exporting}
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 text-xs font-semibold text-primary hover:bg-primary/10 disabled:opacity-50"
              >
                {exporting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                Exportar CSV
              </button>
            ) : null}
          </div>
        </div>
      </header>

      <FinanceAccountsReceivableSyncPanel
        canRun={canRunSync}
        onSyncFinished={() => void loadDashboard()}
      />

      {dashboardError ? (
        <FinanceArErrorBanner message={dashboardError} onDismiss={() => setDashboardError(null)} />
      ) : null}
      {exportError ? (
        <FinanceArErrorBanner message={exportError} onDismiss={() => setExportError(null)} />
      ) : null}
      {exportSuccess ? (
        <FinanceArSuccessBanner message={exportSuccess} onDismiss={() => setExportSuccess(null)} />
      ) : null}

      <section className="rounded-xl border border-border bg-card/40 p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Filtros globais
            </p>
            {filtersActive ? (
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Filtros aplicados — afetam KPIs, gráficos, exportação e títulos.
              </p>
            ) : null}
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          <div className="col-span-full grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 rounded-lg border border-border/60 bg-background/30 p-3">
            <p className="col-span-full text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              Período de vencimento
            </p>
            <FilterSelect
              label="Ano Vencimento"
              value={draftFilters.year}
              onChange={(v) => setDraftFilters((f) => ({ ...f, year: v }))}
              options={yearOptions}
            />
            <FilterSelect
              label="Mês Vencimento"
              value={draftFilters.month}
              onChange={(v) =>
                setDraftFilters((f) => {
                  const next = { ...f, month: v };
                  if (v && !f.year.trim()) {
                    next.year = String(new Date().getFullYear());
                  }
                  return next;
                })
              }
              options={FINANCE_AR_MONTH_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            />
            <FilterInput
              label="Vencimento de"
              type="date"
              value={draftFilters.dueDateFrom}
              onChange={(v) => setDraftFilters((f) => ({ ...f, dueDateFrom: v }))}
            />
            <FilterInput
              label="Vencimento até"
              type="date"
              value={draftFilters.dueDateTo}
              onChange={(v) => setDraftFilters((f) => ({ ...f, dueDateTo: v }))}
            />
          </div>
          <FilterSelect
            label="Status"
            value={draftFilters.status}
            onChange={(v) => setDraftFilters((f) => ({ ...f, status: v }))}
            options={FINANCE_AR_STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          />
          <FilterSelect
            label="NF Emitida?"
            value={draftFilters.invoiceIssued}
            onChange={(v) => setDraftFilters((f) => ({ ...f, invoiceIssued: v }))}
            options={FINANCE_AR_INVOICE_ISSUED_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          />
          <FilterInput label="Empresa" value={draftFilters.companyName} onChange={(v) => setDraftFilters((f) => ({ ...f, companyName: v }))} />
          <FilterInput label="Cliente" value={draftFilters.personName} onChange={(v) => setDraftFilters((f) => ({ ...f, personName: v }))} />
          <FilterInput label="CNPJ" value={draftFilters.personCnpj} onChange={(v) => setDraftFilters((f) => ({ ...f, personCnpj: v }))} />
          <FilterInput label="Forma de pagamento" value={draftFilters.paymentMethodName} onChange={(v) => setDraftFilters((f) => ({ ...f, paymentMethodName: v }))} />
          <FilterInput label="Conta bancária" value={draftFilters.bankAccountName} onChange={(v) => setDraftFilters((f) => ({ ...f, bankAccountName: v }))} />
        </div>
      </section>

      <FinanceArInvoicePortfolioPanel
        cards={cards}
        activeFilter={appliedFilters.invoiceIssued}
        loading={loading}
        onFilterInvoiceIssued={handleFilterInvoiceIssued}
      />

      {loading && !data ? (
        <FinanceArLoadingBlock label="alertas e indicadores" />
      ) : (
        <FinanceAccountsReceivableDataQualityPanel
          alerts={data?.dataQualitySummary ?? []}
          onViewTitles={handleViewTitlesFromAlert}
        />
      )}

      <FinanceArTabNav
        tabs={FINANCE_AR_TABS}
        activeId={activeTab}
        onChange={(id) => setActiveTab(id as FinanceArTabId)}
      />

      <div role="tabpanel" aria-label={FINANCE_AR_TABS.find((t) => t.id === activeTab)?.label}>
        {activeTab === "overview" ? <FinanceArOverviewTab data={data} loading={loading} /> : null}
        {activeTab === "aging" ? (
          loading && !data ? <FinanceArLoadingBlock label="aging" /> : <FinanceArAgingTab data={data} />
        ) : null}
        {activeTab === "schedule" ? (
          loading && !data ? <FinanceArLoadingBlock label="agenda" /> : <FinanceArScheduleTab data={data} />
        ) : null}
        {activeTab === "customers" ? (
          loading && !data ? <FinanceArLoadingBlock label="clientes" /> : <FinanceArCustomersTab data={data} />
        ) : null}
        {activeTab === "titles" ? (
          <FinanceArTitlesTab
            filters={appliedFilters}
            qualityAlert={titlesQualityAlert}
            onClearQualityAlert={() => setTitlesQualityAlert(null)}
          />
        ) : null}
        {activeTab === "payment-methods" ? (
          loading && !data ? (
            <FinanceArLoadingBlock label="formas de pagamento" />
          ) : (
            <FinanceArPaymentTab data={data} />
          )
        ) : null}
        {activeTab === "companies" ? (
          loading && !data ? <FinanceArLoadingBlock label="empresas" /> : <FinanceArCompaniesTab data={data} />
        ) : null}
      </div>
    </div>
  );
}

function FilterInput({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <label className="space-y-1 block min-w-0">
      <span className="text-[10px] font-bold uppercase text-muted-foreground">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-9 rounded-lg border border-border bg-background px-2.5 text-sm"
      />
    </label>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="space-y-1 block min-w-0">
      <span className="text-[10px] font-bold uppercase text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-9 rounded-lg border border-border bg-background px-2.5 text-sm"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
