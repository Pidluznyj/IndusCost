import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ExternalLink, Info, Loader2, RefreshCw, RotateCcw } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { cn } from "@/src/lib/utils";
import {
  buildFinanceArDashboardQuery,
  EMPTY_FINANCE_AR_UI_FILTERS,
  FINANCE_AR_STATUS_OPTIONS,
  FINANCE_AR_TABS,
  type FinanceArDashboardPayload,
  type FinanceArTabId,
  type FinanceArUiFilters,
} from "@/src/lib/financeAccountsReceivableDashboardTypes";
import {
  formatFinanceDateTime,
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
import { FinanceArTitlesTab } from "@/src/components/finance/FinanceAccountsReceivableTitlesTab";

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

type SyncMeta = { syncStrategy: string | null; overallStatus: string | null };

export function FinanceAccountsReceivablePage() {
  const [activeTab, setActiveTab] = useState<FinanceArTabId>("overview");
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
  const [syncMeta, setSyncMeta] = useState<SyncMeta | null>(null);
  const [loading, setLoading] = useState(true);
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
      setError(e instanceof Error ? e.message : "Não foi possível carregar o dashboard.");
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  const loadSyncMeta = useCallback(async () => {
    try {
      const status = await fetchJsonOk<{ syncStrategy?: string | null }>(
        "/api/settings/nomus-sync/accounts-receivable-status"
      );
      setSyncMeta({ syncStrategy: status.syncStrategy ?? null, overallStatus: null });
    } catch {
      setSyncMeta(null);
    }
  }, []);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    void loadSyncMeta();
  }, [loadSyncMeta]);

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
                Última sync:{" "}
                <strong className="text-foreground">{formatFinanceDateTime(cards?.lastSyncAt)}</strong>
              </span>
              <span>
                Registros:{" "}
                <strong className="text-foreground">{formatFinanceInteger(cards?.totalRecords ?? 0)}</strong>
              </span>
              {syncMeta?.syncStrategy ? (
                <span>
                  Estratégia:{" "}
                  <strong className="font-mono text-foreground">{syncMeta.syncStrategy}</strong>
                </span>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                void loadDashboard();
                void loadSyncMeta();
              }}
              disabled={loading}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-xs font-semibold hover:bg-accent disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Atualizar tela
            </button>
            <Link
              to="/settings"
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-xs font-semibold hover:bg-accent"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Sync no Admin
            </Link>
          </div>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 flex gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      ) : null}

      <div className="rounded-xl border border-border bg-card/40 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Filtros globais</p>
          <button
            type="button"
            onClick={() => setFilters(EMPTY_FINANCE_AR_UI_FILTERS)}
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
      {activeTab === "aging" ? <FinanceArAgingTab data={data} /> : null}
      {activeTab === "schedule" ? <FinanceArScheduleTab data={data} /> : null}
      {activeTab === "customers" ? <FinanceArCustomersTab data={data} /> : null}
      {activeTab === "titles" ? <FinanceArTitlesTab filters={effectiveFilters} /> : null}
      {activeTab === "payment-methods" ? <FinanceArPaymentTab data={data} /> : null}
      {activeTab === "companies" ? <FinanceArCompaniesTab data={data} /> : null}

      {data?.dataQualityAlerts && Object.values(data.dataQualityAlerts).some((v) => Number(v) > 0) ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-4 text-xs text-amber-950 flex gap-2">
          <Info className="h-4 w-4 shrink-0" />
          Alertas de qualidade detectados — revise dados sincronizados do Nomus.
        </div>
      ) : null}

      {data ? (
        <p className="text-xs text-muted-foreground">
          Dados gerados em {formatFinanceDateTime(data.generatedAt)}
        </p>
      ) : null}
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
