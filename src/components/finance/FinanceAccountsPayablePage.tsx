import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, Loader2, RefreshCw, RotateCcw } from "lucide-react";
import { useAuth } from "@/src/contexts/AuthContext";
import { fetchJsonOk } from "@/src/lib/http";
import {
  buildFinanceApDashboardQuery,
  buildFinanceApExportQuery,
  buildFinanceApYearOptions,
  createDefaultFinanceApUiFilters,
  formatFinanceApPeriodLabel,
  isDefaultFinanceApUiFilters,
  FINANCE_AP_SUSPEND_PAYMENT_OPTIONS,
  FINANCE_AP_MONTH_OPTIONS,
  FINANCE_AP_STATUS_OPTIONS,
  FINANCE_AP_TABS,
  normalizeFinanceApUiFilters,
  type FinanceApDashboardPayload,
  type FinanceApDataQualityAlertKey,
  type FinanceApTabId,
  type FinanceApUiFilters,
} from "@/src/lib/financeAccountsPayableDashboardTypes";
import {
  formatFinanceDateTime,
  financeApExportFilename,
  formatFinanceInteger,
} from "@/src/lib/financeAccountsPayableFormat";
import {
  canExportFinanceAccountsPayable,
  canRunFinanceAccountsPayableSync,
} from "@/src/lib/financeAccountsPayablePermissions";
import {
  FinanceApAgingTab,
  FinanceApCompaniesTab,
  FinanceApSuppliersTab,
  FinanceApOverviewTab,
  FinanceApPaymentTab,
  FinanceApScheduleTab,
} from "@/src/components/finance/FinanceAccountsPayableTabPanels";
import { FinanceAccountsPayableDataQualityPanel } from "@/src/components/finance/FinanceAccountsPayableDataQualityPanel";
import { FinanceAccountsPayableSyncPanel } from "@/src/components/finance/FinanceAccountsPayableSyncPanel";
import { FinanceApTitlesTab } from "@/src/components/finance/FinanceAccountsPayableTitlesTab";
import {
  FinanceApErrorBanner,
  FinanceApLoadingBlock,
  FinanceApSuccessBanner,
  FinanceApTabNav,
} from "@/src/components/finance/FinanceAccountsPayableUiShared";

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

export function FinanceAccountsPayablePage() {
  const auth = useAuth();
  const canExport = canExportFinanceAccountsPayable(auth);
  const canRunSync = canRunFinanceAccountsPayableSync(auth);

  const [activeTab, setActiveTab] = useState<FinanceApTabId>("overview");
  const [titlesQualityAlert, setTitlesQualityAlert] = useState<FinanceApDataQualityAlertKey | null>(
    null
  );
  const [filters, setFilters] = useState<FinanceApUiFilters>(() => createDefaultFinanceApUiFilters());
  const dashboardAbortRef = useRef<AbortController | null>(null);
  const debouncedCompany = useDebouncedValue(filters.companyName, 400);
  const debouncedPerson = useDebouncedValue(filters.personName, 400);
  const debouncedCnpj = useDebouncedValue(filters.personCnpj, 400);
  const debouncedPayment = useDebouncedValue(filters.paymentMethodName, 400);
  const debouncedBank = useDebouncedValue(filters.bankAccountName, 400);

  const effectiveFilters = useMemo((): FinanceApUiFilters => {
    const merged: FinanceApUiFilters = {
      ...filters,
      companyName: debouncedCompany,
      personName: debouncedPerson,
      personCnpj: debouncedCnpj,
      paymentMethodName: debouncedPayment,
      bankAccountName: debouncedBank,
    };
    return normalizeFinanceApUiFilters(merged);
  }, [filters, debouncedCompany, debouncedPerson, debouncedCnpj, debouncedPayment, debouncedBank]);

  const yearOptions = useMemo(() => buildFinanceApYearOptions(), []);

  const queryString = useMemo(
    () => buildFinanceApDashboardQuery(effectiveFilters),
    [effectiveFilters]
  );

  const [data, setData] = useState<FinanceApDashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportSuccess, setExportSuccess] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    dashboardAbortRef.current?.abort();
    const controller = new AbortController();
    dashboardAbortRef.current = controller;
    setLoading(true);
    setDashboardError(null);
    try {
      const url = `/api/finance/accounts-payable/dashboard?${queryString}`;
      const payload = await fetchJsonOk<FinanceApDashboardPayload>(url, {
        signal: controller.signal,
        credentials: "include",
      });
      if (controller.signal.aborted) return;
      setData(payload);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      console.error("FinanceAccountsPayablePage.loadDashboard", e);
      setDashboardError("Não foi possível carregar Contas a Pagar. Tente novamente.");
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
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
      const qs = buildFinanceApExportQuery(effectiveFilters);
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
      setExportSuccess(`Arquivo ${financeApExportFilename()} gerado com os filtros atuais.`);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : "Erro ao exportar CSV.");
    } finally {
      setExporting(false);
    }
  };

  const handleViewTitlesFromAlert = (key: FinanceApDataQualityAlertKey) => {
    setTitlesQualityAlert(key);
    setActiveTab("titles");
  };

  const cards = data?.cards;
  const periodLabel = useMemo(
    () => formatFinanceApPeriodLabel(effectiveFilters),
    [effectiveFilters]
  );

  const filtersActive =
    !isDefaultFinanceApUiFilters(effectiveFilters) &&
    Boolean(
      effectiveFilters.companyName ||
        effectiveFilters.personName ||
        effectiveFilters.personCnpj ||
        effectiveFilters.status !== "all" ||
        !effectiveFilters.year ||
        effectiveFilters.month ||
        effectiveFilters.dueDateFrom ||
        effectiveFilters.dueDateTo ||
        effectiveFilters.documentQuery ||
        effectiveFilters.suspendPayment !== "all" ||
        effectiveFilters.paymentMethodName ||
        effectiveFilters.bankAccountName
    );

  return (
    <div className="space-y-5 pb-8">
      <header className="rounded-xl border border-border bg-gradient-to-br from-card/80 to-card/40 p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Financeiro · Carteira
            </p>
            <h3 className="text-2xl font-bold tracking-tight text-foreground">Contas a Pagar</h3>
            <p className="text-sm text-muted-foreground max-w-2xl">
              Painel gerencial read-only dos pagamentos sincronizados do Nomus.
            </p>
            <dl className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground pt-1">
              <div>
                <dt className="inline">Última sync: </dt>
                <dd className="inline font-semibold text-foreground">
                  {formatFinanceDateTime(cards?.lastSyncAt)}
                </dd>
              </div>
              <div>
                <dt className="inline">Período analisado: </dt>
                <dd className="inline font-semibold text-foreground">{periodLabel}</dd>
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

      <FinanceAccountsPayableSyncPanel
        canRun={canRunSync}
        onSyncFinished={() => void loadDashboard()}
      />

      {dashboardError ? (
        <FinanceApErrorBanner
          message={dashboardError}
          onRetry={() => void loadDashboard()}
          onDismiss={() => setDashboardError(null)}
        />
      ) : null}
      {exportError ? (
        <FinanceApErrorBanner message={exportError} onDismiss={() => setExportError(null)} />
      ) : null}
      {exportSuccess ? (
        <FinanceApSuccessBanner message={exportSuccess} onDismiss={() => setExportSuccess(null)} />
      ) : null}

      <section className="rounded-xl border border-border bg-card/40 p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Filtros globais
            </p>
            {filtersActive ? (
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Filtros ativos — afetam KPIs, gráficos, exportação e títulos.
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => {
              setFilters(createDefaultFinanceApUiFilters());
              setTitlesQualityAlert(null);
            }}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Limpar filtros
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          <div className="col-span-full grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 rounded-lg border border-border/60 bg-background/30 p-3">
            <p className="col-span-full text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              Período de vencimento
            </p>
            <FilterSelect
              label="Ano Vencimento"
              value={filters.year}
              onChange={(v) => setFilters((f) => ({ ...f, year: v }))}
              options={yearOptions}
            />
            <FilterSelect
              label="Mês Vencimento"
              value={filters.month}
              onChange={(v) =>
                setFilters((f) => {
                  const next = { ...f, month: v };
                  if (v && !f.year.trim()) {
                    next.year = String(new Date().getFullYear());
                  }
                  return next;
                })
              }
              options={FINANCE_AP_MONTH_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            />
            <FilterInput
              label="Vencimento de"
              type="date"
              value={filters.dueDateFrom}
              onChange={(v) => setFilters((f) => ({ ...f, dueDateFrom: v }))}
            />
            <FilterInput
              label="Vencimento até"
              type="date"
              value={filters.dueDateTo}
              onChange={(v) => setFilters((f) => ({ ...f, dueDateTo: v }))}
            />
          </div>
          <FilterSelect
            label="Status"
            value={filters.status}
            onChange={(v) => setFilters((f) => ({ ...f, status: v }))}
            options={FINANCE_AP_STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          />
          <FilterInput
            label="Documento/NF"
            value={filters.documentQuery}
            onChange={(v) => setFilters((f) => ({ ...f, documentQuery: v }))}
          />
          <FilterSelect
            label="Pagamento suspenso"
            value={filters.suspendPayment}
            onChange={(v) => setFilters((f) => ({ ...f, suspendPayment: v }))}
            options={FINANCE_AP_SUSPEND_PAYMENT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          />
          <FilterInput label="Empresa" value={filters.companyName} onChange={(v) => setFilters((f) => ({ ...f, companyName: v }))} />
          <FilterInput label="Fornecedor" value={filters.personName} onChange={(v) => setFilters((f) => ({ ...f, personName: v }))} />
          <FilterInput label="CNPJ" value={filters.personCnpj} onChange={(v) => setFilters((f) => ({ ...f, personCnpj: v }))} />
          <FilterInput label="Forma de pagamento" value={filters.paymentMethodName} onChange={(v) => setFilters((f) => ({ ...f, paymentMethodName: v }))} />
          <FilterInput label="Conta bancária" value={filters.bankAccountName} onChange={(v) => setFilters((f) => ({ ...f, bankAccountName: v }))} />
        </div>
      </section>

      {loading && !data ? (
        <FinanceApLoadingBlock label="alertas e indicadores" />
      ) : (
        <FinanceAccountsPayableDataQualityPanel
          alerts={data?.dataQualitySummary ?? []}
          onViewTitles={handleViewTitlesFromAlert}
        />
      )}

      <FinanceApTabNav
        tabs={FINANCE_AP_TABS}
        activeId={activeTab}
        onChange={(id) => setActiveTab(id as FinanceApTabId)}
      />

      <div role="tabpanel" aria-label={FINANCE_AP_TABS.find((t) => t.id === activeTab)?.label}>
        {activeTab === "overview" ? <FinanceApOverviewTab data={data} loading={loading} /> : null}
        {activeTab === "aging" ? (
          loading && !data ? <FinanceApLoadingBlock label="aging" /> : <FinanceApAgingTab data={data} />
        ) : null}
        {activeTab === "schedule" ? (
          loading && !data ? <FinanceApLoadingBlock label="agenda" /> : <FinanceApScheduleTab data={data} />
        ) : null}
        {activeTab === "suppliers" ? (
          loading && !data ? <FinanceApLoadingBlock label="fornecedors" /> : <FinanceApSuppliersTab data={data} />
        ) : null}
        {activeTab === "titles" ? (
          <FinanceApTitlesTab
            filters={effectiveFilters}
            qualityAlert={titlesQualityAlert}
            onClearQualityAlert={() => setTitlesQualityAlert(null)}
          />
        ) : null}
        {activeTab === "payment-methods" ? (
          loading && !data ? (
            <FinanceApLoadingBlock label="formas de pagamento" />
          ) : (
            <FinanceApPaymentTab data={data} />
          )
        ) : null}
        {activeTab === "companies" ? (
          loading && !data ? <FinanceApLoadingBlock label="empresas" /> : <FinanceApCompaniesTab data={data} />
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
