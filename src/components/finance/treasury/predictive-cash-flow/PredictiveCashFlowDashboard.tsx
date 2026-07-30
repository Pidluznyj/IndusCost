import React, { useMemo } from "react";
import { RefreshCw } from "lucide-react";
import type {
  PredictiveCashFlowAccount,
  PredictiveCashFlowDailyBalance,
  PredictiveCashFlowTransaction,
} from "@/src/lib/treasury/treasuryPredictiveCashFlow.js";
import { filterPredictiveCashFlowAccountsByCompanyCode } from "@/src/lib/treasury/treasuryPredictiveCashFlow.js";
import type { TreasurySimpleCashRiskSummaryDto } from "@/src/lib/treasury/domain/treasurySimpleCashRiskProjectionRules.js";
import type { TreasurySimpleCashRiskFilterState } from "@/src/lib/treasury/treasurySimpleCashRiskProjectionUi.js";
import {
  TREASURY_SIMPLE_CASH_RISK_MONTH_OPTIONS,
  TREASURY_SIMPLE_CASH_RISK_PERIODS,
  TREASURY_SIMPLE_CASH_RISK_PERIOD_LABELS,
  TREASURY_SIMPLE_CASH_RISK_SCENARIOS,
  TREASURY_SIMPLE_CASH_RISK_SCENARIO_LABELS,
  daysInTreasuryCivilMonth,
  joinTreasurySimpleCashRiskCivilDate,
  listTreasurySimpleCashRiskYearOptions,
  resolveTreasurySimpleCashRiskRange,
  splitTreasurySimpleCashRiskCivilDate,
} from "@/src/lib/treasury/treasurySimpleCashRiskProjectionUi.js";
import { todayCivilDateLocal } from "@/src/lib/treasury/treasuryAgendaUi.js";
import {
  financeModuleFilterFieldClass,
  financeModuleFilterLabelClass,
} from "@/src/lib/financeModuleUiStandards.js";
import { FinanceModuleErrorBanner } from "@/src/components/finance/shared/FinanceModuleStates";
import { PredictiveCashFlowTimelineChart } from "./PredictiveCashFlowTimelineChart.js";
import { PredictiveCashFlowAccountsPanel } from "./PredictiveCashFlowAccountsPanel.js";
import { PredictiveCashFlowBalanceKpis } from "./PredictiveCashFlowBalanceKpis.js";
import { PredictiveCashFlowAccountCrCpPanel } from "./PredictiveCashFlowAccountCrCpPanel.js";
import { PredictiveCashFlowRiskStrip } from "./PredictiveCashFlowRiskStrip.js";
import { PredictiveCashFlowReconciliationPanel } from "./PredictiveCashFlowReconciliationPanel.js";
import { PredictiveCashFlowTransactionsPanel } from "./PredictiveCashFlowTransactionsPanel.js";
import { cn } from "@/src/lib/utils";

const FILTER_FIELD_COMPACT = cn(
  financeModuleFilterFieldClass(),
  "h-8 px-2.5 py-1 text-xs"
);

export type PredictiveCashFlowDashboardProps = {
  timeline: readonly PredictiveCashFlowDailyBalance[];
  accounts: readonly PredictiveCashFlowAccount[];
  transactions: readonly PredictiveCashFlowTransaction[];
  filters: TreasurySimpleCashRiskFilterState;
  companyCode: string | null;
  companyCodes?: readonly string[];
  riskSummary: TreasurySimpleCashRiskSummaryDto | null;
  loading: boolean;
  error: string | null;
  staleMessage: string | null;
  isSuperAdmin?: boolean;
  onFiltersChange: (next: TreasurySimpleCashRiskFilterState) => void;
  onRefresh: () => void;
  onDismissError?: () => void;
};

export function PredictiveCashFlowDashboard({
  timeline,
  accounts,
  transactions,
  filters,
  companyCode,
  companyCodes = [],
  riskSummary,
  loading,
  error,
  staleMessage,
  isSuperAdmin = false,
  onFiltersChange,
  onRefresh,
  onDismissError,
}: PredictiveCashFlowDashboardProps) {
  const kpiCivilDate =
    filters.selectedCivilDate || timeline[0]?.date || todayCivilDateLocal();

  const scopedAccounts = useMemo(
    () => filterPredictiveCashFlowAccountsByCompanyCode(accounts, companyCode),
    [accounts, companyCode]
  );

  const dateParts = useMemo(
    () => splitTreasurySimpleCashRiskCivilDate(kpiCivilDate),
    [kpiCivilDate]
  );

  const horizon = useMemo(
    () =>
      resolveTreasurySimpleCashRiskRange(
        filters.period,
        todayCivilDateLocal(),
        kpiCivilDate
      ),
    [filters.period, kpiCivilDate]
  );

  const yearOptions = useMemo(
    () => listTreasurySimpleCashRiskYearOptions(Number(dateParts.year)),
    [dateParts.year]
  );

  const dayOptions = useMemo(() => {
    const max = daysInTreasuryCivilMonth(
      Number(dateParts.year),
      Number(dateParts.month)
    );
    return Array.from({ length: max }, (_, i) =>
      String(i + 1).padStart(2, "0")
    );
  }, [dateParts.year, dateParts.month]);

  const showCompanyFilter = companyCodes.length >= 2;

  function patchCivilDate(next: {
    year?: string;
    month?: string;
    day?: string;
  }) {
    const joined = joinTreasurySimpleCashRiskCivilDate({
      year: next.year ?? dateParts.year,
      month: next.month ?? dateParts.month,
      day: next.day ?? dateParts.day,
    });
    if (!joined) return;
    onFiltersChange({ ...filters, selectedCivilDate: joined });
  }

  return (
    <div
      className="flex flex-col gap-3"
      data-testid="predictive-cash-flow-dashboard"
    >
      {error ? (
        <FinanceModuleErrorBanner
          message={error}
          onRetry={onRefresh}
          onDismiss={onDismissError}
        />
      ) : null}

      {staleMessage ? (
        <div
          role="status"
          className="rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-950"
        >
          {staleMessage}
        </div>
      ) : null}

      <section
        className="rounded-lg border border-border bg-card px-3 py-2.5 shadow-sm"
        data-testid="predictive-cf-filters"
      >
        <div className="flex flex-wrap items-end gap-2">
          <label className="w-[4.75rem] space-y-0.5">
            <span className={financeModuleFilterLabelClass()}>Ano</span>
            <select
              className={FILTER_FIELD_COMPACT}
              value={dateParts.year}
              onChange={(e) => patchCivilDate({ year: e.target.value })}
              data-testid="predictive-cf-filter-year"
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-[7.5rem] flex-1 space-y-0.5 sm:max-w-[9rem]">
            <span className={financeModuleFilterLabelClass()}>Mês</span>
            <select
              className={FILTER_FIELD_COMPACT}
              value={dateParts.month}
              onChange={(e) => patchCivilDate({ month: e.target.value })}
              data-testid="predictive-cf-filter-month"
            >
              {TREASURY_SIMPLE_CASH_RISK_MONTH_OPTIONS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label className="w-[4.25rem] space-y-0.5">
            <span className={financeModuleFilterLabelClass()}>Dia</span>
            <select
              className={FILTER_FIELD_COMPACT}
              value={dateParts.day}
              onChange={(e) => patchCivilDate({ day: e.target.value })}
              data-testid="predictive-cf-filter-day"
            >
              {dayOptions.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-[8rem] flex-1 space-y-0.5 sm:max-w-[11rem]">
            <span className={financeModuleFilterLabelClass()}>Horizonte</span>
            <select
              className={FILTER_FIELD_COMPACT}
              value={filters.period}
              onChange={(e) =>
                onFiltersChange({
                  ...filters,
                  period: e.target.value as typeof filters.period,
                })
              }
              data-testid="predictive-cf-filter-period"
            >
              {TREASURY_SIMPLE_CASH_RISK_PERIODS.map((p) => (
                <option key={p} value={p}>
                  {TREASURY_SIMPLE_CASH_RISK_PERIOD_LABELS[p]}
                </option>
              ))}
            </select>
          </label>
          {showCompanyFilter ? (
            <label className="min-w-[5.5rem] space-y-0.5 sm:w-[6.5rem]">
              <span className={financeModuleFilterLabelClass()}>Empresa</span>
              <select
                className={FILTER_FIELD_COMPACT}
                value={filters.companyCode || companyCodes[0] || ""}
                onChange={(e) =>
                  onFiltersChange({
                    ...filters,
                    companyCode: e.target.value,
                  })
                }
                data-testid="predictive-cf-filter-company"
              >
                {companyCodes.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <div className="min-w-[12rem] flex-1 space-y-0.5 sm:max-w-none">
            <span className={financeModuleFilterLabelClass()}>Cenário</span>
            <div className="flex flex-wrap gap-1">
              {TREASURY_SIMPLE_CASH_RISK_SCENARIOS.map((s) => {
                const meta = TREASURY_SIMPLE_CASH_RISK_SCENARIO_LABELS[s];
                const selected = filters.scenario === s;
                return (
                  <button
                    key={s}
                    type="button"
                    title={meta.description}
                    onClick={() =>
                      onFiltersChange({ ...filters, scenario: s })
                    }
                    className={cn(
                      "h-8 rounded-md border px-2.5 text-xs font-semibold transition",
                      selected
                        ? "border-sky-300 bg-sky-50 text-sky-950"
                        : "border-border bg-background text-foreground hover:bg-muted/40"
                    )}
                  >
                    {meta.short}
                  </button>
                );
              })}
            </div>
          </div>

          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-semibold text-foreground hover:bg-muted/40 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </button>
        </div>
        <p className="mt-1.5 text-[11px] text-[#6B7280]">
          Base do horizonte:{" "}
          <span className="font-semibold tabular-nums text-[#111827]">
            {horizon.baseDate}
          </span>
          {" → "}
          <span className="font-semibold tabular-nums text-[#111827]">
            {horizon.endDate}
          </span>
        </p>
      </section>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        <PredictiveCashFlowAccountsPanel
          accounts={scopedAccounts}
          companyCode={companyCode}
          disabled={loading}
          isSuperAdmin={isSuperAdmin}
          onChanged={onRefresh}
          variant="hero"
        />

        <PredictiveCashFlowBalanceKpis
          accounts={scopedAccounts}
          transactions={transactions}
          civilDate={kpiCivilDate}
        />
      </div>

      <PredictiveCashFlowRiskStrip summary={riskSummary} />

      <PredictiveCashFlowAccountCrCpPanel
        companyCode={companyCode}
        fromDate={horizon.baseDate}
        toDate={horizon.endDate}
      />

      <section className="rounded-lg border border-border bg-card p-3 shadow-sm">
        <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              Evolução do saldo
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Horizonte · consolidado ou por banco · limite R$ 0
            </p>
          </div>
        </div>
        <PredictiveCashFlowTimelineChart
          timeline={timeline}
          accounts={scopedAccounts}
          transactions={transactions}
          fromDate={horizon.baseDate}
          toDate={horizon.endDate}
        />
      </section>

      <PredictiveCashFlowReconciliationPanel
        accounts={scopedAccounts}
        transactions={transactions}
        defaultDate={kpiCivilDate}
      />

      <PredictiveCashFlowTransactionsPanel
        transactions={transactions}
        accounts={scopedAccounts}
        disabled={loading}
        onChanged={onRefresh}
      />
    </div>
  );
}
