import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Loader2, RefreshCw, RotateCcw } from "lucide-react";
import { useAuth } from "@/src/contexts/AuthContext";
import { fetchJsonOk } from "@/src/lib/http";
import { cn } from "@/src/lib/utils";
import {
  buildFinanceArDashboardQuery,
  buildFinanceArExportQuery,
  EMPTY_FINANCE_AR_UI_FILTERS,
  FINANCE_AR_STATUS_OPTIONS,
  FINANCE_AR_TABS,
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
  FinanceArAgingTab,
  FinanceArCompaniesTab,
  FinanceArCustomersTab,
  FinanceArOverviewTab,
  FinanceArPaymentTab,
  FinanceArScheduleTab,
} from "@/src/components/finance/FinanceAccountsReceivableTabPanels";
import { FinanceAccountsReceivableDataQualityPanel } from "@/src/components/finance/FinanceAccountsReceivableDataQualityPanel";
import { FinanceAccountsReceivableSyncPanel } from "@/src/components/finance/FinanceAccountsReceivableSyncPanel";
import { FinanceArTitlesTab } from "@/src/components/finance/FinanceAccountsReceivableTitlesTab";

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

export function FinanceAccountsReceivablePage() {
  const auth = useAuth();
  const canExport =
    auth.hasPermission("finance.accountsReceivable.export") ||
    auth.hasPermission("finance.accountsReceivable.view") ||
    auth.hasPermission("finance.view") ||
    auth.hasPermission("reports.view");
  const canRunSync =
    auth.hasPermission("settings.nomus.sync") || auth.hasPermission("settings.view");

  const [activeTab, setActiveTab] = useState<FinanceArTabId>("overview");
  const [titlesQualityAlert, setTitlesQualityAlert] = useState<FinanceArDataQualityAlertKey | null>(
    null
  );
  const [filters, setFilters] = useState<FinanceArUiFilters>(EMPTY_FINANCE_AR_UI_FILTERS);
  const debouncedCompany = useDebouncedValue(filters.companyName, 400);
  const debouncedPerson = useDebouncedValue(filters.personName, 400);
  const debouncedCnpj = useDebouncedValue(filters.personCnpj, 400);
  const debouncedPayment = useDebouncedValue(filters.paymentMethodName, 400);
  const debouncedBank = useDebouncedValue(filters.bankAccountName, 400);

  const effectiveFilters = useMemo(
    (): FinanceArUiFilters => ({
      ...filters,
      companyName: debouncedCompany,
      personName: debouncedPerson,
      personCnpj: debouncedCnpj,
      paymentMethodName: debouncedPayment,
      bankAccountName: debouncedBank,
    }),
    [filters, debouncedCompany, debouncedPerson, debouncedCnpj, debouncedPayment, debouncedBank]
  );

  const queryString = useMemo(
    () => buildFinanceArDashboardQuery(effectiveFilters),
    [effectiveFilters]
  );

  const [data, setData] = useState<FinanceArDashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = queryString
        ? `/api/finance/accounts-receivable/dashboard?${queryString}`
        : "/api/finance/accounts-receivable/dashboard";
      const payload = await fetchJsonOk<FinanceArDashboardPayload>(url);
      setData(payload);
    } catch (e) {
      setData(null);
      setError(
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
    try {
      const qs = buildFinanceArExportQuery(effectiveFilters);
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
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao exportar CSV.");
    } finally {
      setExporting(false);
    }
  };

  const handleViewTitlesFromAlert = (key: FinanceArDataQualityAlertKey) => {
    setTitlesQualityAlert(key);
    setActiveTab("titles");
  };

  const cards = data?.cards;

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-card/60 p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <h3 className="text-xl font-bold tracking-tight">Contas a Receber</h3>
            <p className="text-sm text-muted-foreground">
              Carteira de recebíveis importada do Nomus — visualização read-only.
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground pt-1">
              <span>
                Última sync (dados):{" "}
                <strong className="text-foreground">{formatFinanceDateTime(cards?.lastSyncAt)}</strong>
              </span>
              <span>
                Registros filtrados:{" "}
                <strong className="text-foreground">{formatFinanceInteger(cards?.totalRecords ?? 0)}</strong>
              </span>
              {data ? (
                <span>
                  Dados atualizados em:{" "}
                  <strong className="text-foreground">{formatFinanceDateTime(data.generatedAt)}</strong>
                </span>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            <button
              type="button"
              onClick={() => void loadDashboard()}
              disabled={loading}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-xs font-semibold hover:bg-accent disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Atualizar dashboard
            </button>
            {canExport ? (
              <button
                type="button"
                onClick={() => void handleExport()}
                disabled={exporting || loading}
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-xs font-semibold hover:bg-accent disabled:opacity-50"
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
      </div>

      <FinanceAccountsReceivableSyncPanel
        canRun={canRunSync}
        onSyncFinished={() => void loadDashboard()}
      />

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      <div className="rounded-xl border border-border bg-card/40 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Filtros globais</p>
          <button
            type="button"
            onClick={() => {
              setFilters(EMPTY_FINANCE_AR_UI_FILTERS);
              setTitlesQualityAlert(null);
            }}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Limpar filtros
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-3">
          <FilterInput label="Empresa" value={filters.companyName} onChange={(v) => setFilters((f) => ({ ...f, companyName: v }))} />
          <FilterInput label="Cliente" value={filters.personName} onChange={(v) => setFilters((f) => ({ ...f, personName: v }))} />
          <FilterInput label="CNPJ" value={filters.personCnpj} onChange={(v) => setFilters((f) => ({ ...f, personCnpj: v }))} />
          <FilterSelect
            label="Status"
            value={filters.status}
            onChange={(v) => setFilters((f) => ({ ...f, status: v }))}
            options={FINANCE_AR_STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          />
          <FilterInput label="Venc. de" type="date" value={filters.dueDateFrom} onChange={(v) => setFilters((f) => ({ ...f, dueDateFrom: v }))} />
          <FilterInput label="Venc. até" type="date" value={filters.dueDateTo} onChange={(v) => setFilters((f) => ({ ...f, dueDateTo: v }))} />
          <FilterInput label="Forma pag." value={filters.paymentMethodName} onChange={(v) => setFilters((f) => ({ ...f, paymentMethodName: v }))} />
          <FilterInput label="Conta" value={filters.bankAccountName} onChange={(v) => setFilters((f) => ({ ...f, bankAccountName: v }))} />
        </div>
      </div>

      <FinanceAccountsReceivableDataQualityPanel
        alerts={data?.dataQualitySummary ?? []}
        onViewTitles={handleViewTitlesFromAlert}
      />

      <nav className="flex flex-wrap gap-2 border-b border-border pb-2">
        {FINANCE_AR_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "rounded-lg px-3 py-2 text-xs font-semibold transition-colors",
              activeTab === tab.id
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent"
            )}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {activeTab === "overview" ? <FinanceArOverviewTab data={data} loading={loading} /> : null}
      {activeTab === "aging" ? (
        loading && !data ? (
          <TabShellLoading label="aging" />
        ) : (
          <FinanceArAgingTab data={data} />
        )
      ) : null}
      {activeTab === "schedule" ? (
        loading && !data ? <TabShellLoading label="agenda" /> : <FinanceArScheduleTab data={data} />
      ) : null}
      {activeTab === "customers" ? (
        loading && !data ? <TabShellLoading label="clientes" /> : <FinanceArCustomersTab data={data} />
      ) : null}
      {activeTab === "titles" ? (
        <FinanceArTitlesTab
          filters={effectiveFilters}
          qualityAlert={titlesQualityAlert}
          onClearQualityAlert={() => setTitlesQualityAlert(null)}
        />
      ) : null}
      {activeTab === "payment-methods" ? (
        loading && !data ? <TabShellLoading label="formas de pagamento" /> : <FinanceArPaymentTab data={data} />
      ) : null}
      {activeTab === "companies" ? (
        loading && !data ? <TabShellLoading label="empresas" /> : <FinanceArCompaniesTab data={data} />
      ) : null}
    </div>
  );
}

function TabShellLoading({ label }: { label: string }) {
  return (
    <p className="text-sm text-muted-foreground py-8 text-center">
      Carregando {label}…
    </p>
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
