import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ExternalLink, Info, Loader2, RefreshCw, RotateCcw } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { cn } from "@/src/lib/utils";
import { ContextualDashboardKpiCard } from "@/src/components/contextual/ContextualDashboardKpiCard";
import {
  buildFinanceArDashboardQuery,
  EMPTY_FINANCE_AR_UI_FILTERS,
  FINANCE_AR_STATUS_OPTIONS,
  type FinanceArDashboardPayload,
  type FinanceArUiFilters,
} from "@/src/lib/financeAccountsReceivableDashboardTypes";
import {
  displayFinanceText,
  formatFinanceCalculatedStatus,
  formatFinanceCurrency,
  formatFinanceCurrencyCompact,
  formatFinanceDate,
  formatFinanceDateTime,
  formatFinanceDaysOverdue,
  formatFinanceInteger,
  formatFinancePercent,
} from "@/src/lib/financeAccountsReceivableFormat";
import {
  FinanceArAgingChart,
  FinanceArMonthlyScheduleChart,
  FinanceArPaymentMethodChart,
  FinanceArTopDebtorsChart,
} from "@/src/components/finance/FinanceAccountsReceivableCharts";

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

type SyncMeta = {
  syncStrategy: string | null;
  overallStatus: string | null;
};

function statusBadgeClass(status: string): string {
  switch (status) {
    case "overdue":
      return "bg-red-100 text-red-900 border-red-200";
    case "dueToday":
      return "bg-amber-100 text-amber-900 border-amber-200";
    case "upcoming":
      return "bg-green-100 text-green-900 border-green-200";
    case "suspended":
      return "bg-orange-100 text-orange-900 border-orange-200";
    case "settled":
      return "bg-slate-100 text-slate-700 border-slate-200";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

export function FinanceAccountsReceivablePage() {
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
      setError(e instanceof Error ? e.message : "Não foi possível carregar o dashboard de Contas a Receber.");
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  const loadSyncMeta = useCallback(async () => {
    try {
      const status = await fetchJsonOk<{ syncStrategy?: string | null; overallStatus?: string | null }>(
        "/api/settings/nomus-sync/accounts-receivable-status"
      );
      setSyncMeta({
        syncStrategy: status.syncStrategy ?? null,
        overallStatus: status.overallStatus ?? null,
      });
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

  const handleRefresh = () => {
    void loadDashboard();
    void loadSyncMeta();
  };

  const handleClearFilters = () => {
    setFilters(EMPTY_FINANCE_AR_UI_FILTERS);
  };

  const cards = data?.cards;
  const hasData = (data?.cards.totalRecords ?? 0) > 0;

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="rounded-xl border border-border bg-card/60 p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <h3 className="text-xl font-bold tracking-tight">Contas a Receber</h3>
            <p className="text-sm text-muted-foreground">
              Carteira de recebíveis importada do Nomus — visualização read-only.
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground pt-1">
              <span>
                Última sincronização:{" "}
                <strong className="text-foreground">{formatFinanceDateTime(cards?.lastSyncAt)}</strong>
              </span>
              <span>
                Total de registros:{" "}
                <strong className="text-foreground">{formatFinanceInteger(cards?.totalRecords ?? 0)}</strong>
              </span>
              {syncMeta?.syncStrategy ? (
                <span>
                  Estratégia sync:{" "}
                  <strong className="font-mono text-foreground">{syncMeta.syncStrategy}</strong>
                </span>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            <button
              type="button"
              onClick={handleRefresh}
              disabled={loading}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-xs font-semibold hover:bg-accent disabled:opacity-50"
            >
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Atualizar tela
            </button>
            <Link
              to="/settings"
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-xs font-semibold hover:bg-accent text-foreground"
              title="Rotina manual de sync Nomus fica em Configurações > Logs Nomus"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Sync no Admin
            </Link>
          </div>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      ) : null}

      {/* Filtros */}
      <div className="rounded-xl border border-border bg-card/40 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Filtros</p>
          <button
            type="button"
            onClick={handleClearFilters}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Limpar filtros
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-3">
          <FilterInput
            label="Empresa"
            value={filters.companyName}
            onChange={(v) => setFilters((f) => ({ ...f, companyName: v }))}
          />
          <FilterInput
            label="Cliente"
            value={filters.personName}
            onChange={(v) => setFilters((f) => ({ ...f, personName: v }))}
          />
          <FilterInput
            label="CNPJ"
            value={filters.personCnpj}
            onChange={(v) => setFilters((f) => ({ ...f, personCnpj: v }))}
          />
          <FilterSelect
            label="Status"
            value={filters.status}
            onChange={(v) => setFilters((f) => ({ ...f, status: v }))}
            options={FINANCE_AR_STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
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
          <FilterInput
            label="Forma pagamento"
            value={filters.paymentMethodName}
            onChange={(v) => setFilters((f) => ({ ...f, paymentMethodName: v }))}
          />
          <FilterInput
            label="Conta bancária"
            value={filters.bankAccountName}
            onChange={(v) => setFilters((f) => ({ ...f, bankAccountName: v }))}
          />
        </div>
      </div>

      {/* KPIs */}
      <section className="space-y-2">
        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Indicadores</p>
        {loading && !data ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando indicadores…
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-3">
            <Kpi
              label="Valor em aberto"
              value={formatFinanceCurrencyCompact(cards?.totalOpenAmount)}
              hint="Soma de balanceReceivable > 0"
              loading={loading}
            />
            <Kpi
              label="Valor vencido"
              value={formatFinanceCurrencyCompact(cards?.overdueAmount)}
              hint="Em aberto com vencimento anterior a hoje"
              loading={loading}
            />
            <Kpi
              label="Valor a vencer"
              value={formatFinanceCurrencyCompact(cards?.upcomingAmount)}
              hint="Em aberto com vencimento futuro (exclui vence hoje)"
              loading={loading}
            />
            <Kpi
              label="Recebido no mês"
              value={formatFinanceCurrencyCompact(cards?.receivedThisMonthAmount)}
              hint="amountReceived com settlementDate no mês corrente"
              loading={loading}
            />
            <Kpi
              label="% inadimplência"
              value={formatFinancePercent(cards?.delinquencyRate)}
              hint="Vencido ÷ em aberto (0% se denominador zero)"
              loading={loading}
            />
            <Kpi
              label="Títulos em aberto"
              value={formatFinanceInteger(cards?.openTitlesCount)}
              hint="Registros com saldo positivo"
              loading={loading}
            />
            <Kpi
              label="Clientes em atraso"
              value={formatFinanceInteger(cards?.overdueCustomersCount)}
              hint="Clientes distintos com título vencido em aberto"
              loading={loading}
            />
            <Kpi
              label="Vencendo em 7 dias"
              value={formatFinanceCurrencyCompact(cards?.dueNext7DaysAmount)}
              hint="Vencimento entre hoje e hoje + 7 dias"
              loading={loading}
            />
            <Kpi
              label="Vencendo em 30 dias"
              value={formatFinanceCurrencyCompact(cards?.dueNext30DaysAmount)}
              hint="Vencimento entre hoje e hoje + 30 dias"
              loading={loading}
            />
          </div>
        )}
      </section>

      {!loading && !error && !hasData ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/30 p-8 text-center text-sm text-muted-foreground">
          Nenhum título encontrado com os filtros aplicados.
        </div>
      ) : null}

      {/* Gráficos */}
      {data ? (
        <>
          <section className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <FinanceArAgingChart buckets={data.agingBuckets ?? []} />
            <FinanceArMonthlyScheduleChart rows={data.monthlyDueSchedule ?? []} />
            <FinanceArTopDebtorsChart rows={data.topDebtors ?? []} />
            <FinanceArPaymentMethodChart rows={data.paymentMethodSummary ?? []} />
          </section>

          {/* Títulos críticos */}
          <section className="space-y-3">
            <div>
              <h3 className="text-sm font-bold">Títulos críticos</h3>
              <p className="text-xs text-muted-foreground">
                Prioridade: maior atraso, depois maior saldo (até 20 registros).
              </p>
            </div>
            <CriticalTitlesTable rows={data.criticalTitles ?? []} />
          </section>

          {data.dataQualityAlerts &&
          Object.values(data.dataQualityAlerts).some((v) => Number(v) > 0) ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-4 text-sm text-amber-950 space-y-2">
              <p className="font-semibold flex items-center gap-2">
                <Info className="h-4 w-4" />
                Alertas de qualidade de dados
              </p>
              <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1 text-xs">
                {data.dataQualityAlerts.missingDueDate > 0 ? (
                  <li>Sem vencimento: {formatFinanceInteger(data.dataQualityAlerts.missingDueDate)}</li>
                ) : null}
                {data.dataQualityAlerts.missingPersonCnpj > 0 ? (
                  <li>Sem CNPJ: {formatFinanceInteger(data.dataQualityAlerts.missingPersonCnpj)}</li>
                ) : null}
                {data.dataQualityAlerts.negativeBalance > 0 ? (
                  <li>Saldo negativo: {formatFinanceInteger(data.dataQualityAlerts.negativeBalance)}</li>
                ) : null}
                {data.dataQualityAlerts.suspendedCollectionOpen > 0 ? (
                  <li>
                    Cobrança suspensa em aberto:{" "}
                    {formatFinanceInteger(data.dataQualityAlerts.suspendedCollectionOpen)}
                  </li>
                ) : null}
              </ul>
            </div>
          ) : null}

          <p className="text-xs text-muted-foreground">
            Dados gerados em {formatFinanceDateTime(data.generatedAt)}
          </p>
        </>
      ) : null}
    </div>
  );
}

function Kpi({
  label,
  value,
  hint,
  loading,
}: {
  label: string;
  value: string;
  hint: string;
  loading: boolean;
}) {
  return (
    <ContextualDashboardKpiCard
      label={label}
      value={loading ? "…" : value}
      hint={hint}
    />
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
  onChange: (value: string) => void;
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
  onChange: (value: string) => void;
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

function CriticalTitlesTable({
  rows,
}: {
  rows: FinanceArDashboardPayload["criticalTitles"];
}) {
  if (!rows.length) {
    return (
      <p className="text-sm text-muted-foreground rounded-xl border border-border bg-card/40 p-4">
        Nenhum título crítico na seleção atual.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card/60">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-left text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            <th className="p-3">ID Nomus</th>
            <th className="p-3">Empresa</th>
            <th className="p-3">Cliente</th>
            <th className="p-3">CNPJ</th>
            <th className="p-3">Vencimento</th>
            <th className="p-3 text-right">Saldo</th>
            <th className="p-3">Forma pag.</th>
            <th className="p-3">NF origem</th>
            <th className="p-3">Status</th>
            <th className="p-3 text-right">Dias atraso</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.externalId} className="border-b border-border/60 hover:bg-muted/20">
              <td className="p-3 font-mono text-xs">{row.externalId}</td>
              <td className="p-3">{displayFinanceText(row.companyName)}</td>
              <td className="p-3">{displayFinanceText(row.personName)}</td>
              <td className="p-3 font-mono text-xs">{displayFinanceText(row.personCnpj)}</td>
              <td className="p-3">{formatFinanceDate(row.dueDate)}</td>
              <td className="p-3 text-right font-semibold tabular-nums">
                {formatFinanceCurrency(row.balanceReceivable)}
              </td>
              <td className="p-3">{displayFinanceText(row.paymentMethodName)}</td>
              <td className="p-3 font-mono text-xs">
                {displayFinanceText(row.sourceInvoiceNumber ?? (row.sourceInvoiceId != null ? String(row.sourceInvoiceId) : null))}
              </td>
              <td className="p-3">
                <span
                  className={cn(
                    "inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold",
                    statusBadgeClass(row.calculatedStatus)
                  )}
                >
                  {formatFinanceCalculatedStatus(row.calculatedStatus)}
                </span>
              </td>
              <td className="p-3 text-right tabular-nums">
                {formatFinanceDaysOverdue(row.daysOverdue)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
