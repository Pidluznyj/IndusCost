import React from "react";
import { RefreshCw } from "lucide-react";
import type {
  PredictiveCashFlowAccount,
  PredictiveCashFlowDailyBalance,
  PredictiveCashFlowKpis,
  PredictiveCashFlowTransaction,
} from "@/src/lib/treasury/treasuryPredictiveCashFlow.js";
import { formatPredictiveCashFlowMoney } from "@/src/lib/treasury/treasuryPredictiveCashFlow.js";
import type { TreasurySimpleCashRiskFilterState } from "@/src/lib/treasury/treasurySimpleCashRiskProjectionUi.js";
import {
  TREASURY_SIMPLE_CASH_RISK_PERIODS,
  TREASURY_SIMPLE_CASH_RISK_PERIOD_LABELS,
  TREASURY_SIMPLE_CASH_RISK_SCENARIOS,
  TREASURY_SIMPLE_CASH_RISK_SCENARIO_LABELS,
} from "@/src/lib/treasury/treasurySimpleCashRiskProjectionUi.js";
import {
  financeModuleFilterFieldClass,
  financeModuleFilterLabelClass,
} from "@/src/lib/financeModuleUiStandards.js";
import {
  FinanceModuleErrorBanner,
} from "@/src/components/finance/shared/FinanceModuleStates";
import { PredictiveCashFlowTimelineChart } from "./PredictiveCashFlowTimelineChart.js";
import { PredictiveCashFlowAccountsPanel } from "./PredictiveCashFlowAccountsPanel.js";
import { PredictiveCashFlowReconciliationPanel } from "./PredictiveCashFlowReconciliationPanel.js";
import { PredictiveCashFlowTransactionsPanel } from "./PredictiveCashFlowTransactionsPanel.js";

export type PredictiveCashFlowDashboardProps = {
  kpis: PredictiveCashFlowKpis;
  timeline: readonly PredictiveCashFlowDailyBalance[];
  accounts: readonly PredictiveCashFlowAccount[];
  transactions: readonly PredictiveCashFlowTransaction[];
  filters: TreasurySimpleCashRiskFilterState;
  companyCode: string | null;
  loading: boolean;
  error: string | null;
  staleMessage: string | null;
  onFiltersChange: (next: TreasurySimpleCashRiskFilterState) => void;
  onRefresh: () => void;
  onDismissError?: () => void;
};

function KpiCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "neutral" | "in" | "out" | "final";
}) {
  const valueClass =
    tone === "in"
      ? "text-emerald-700"
      : tone === "out"
        ? "text-rose-700"
        : tone === "final"
          ? "text-sky-800"
          : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-4 shadow-sm">
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className={`mt-2 text-xl font-semibold tabular-nums ${valueClass}`}>
        {value}
      </p>
    </div>
  );
}

export function PredictiveCashFlowDashboard({
  kpis,
  timeline,
  accounts,
  transactions,
  filters,
  companyCode,
  loading,
  error,
  staleMessage,
  onFiltersChange,
  onRefresh,
  onDismissError,
}: PredictiveCashFlowDashboardProps) {
  return (
    <div
      className="flex flex-col gap-6"
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
          className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
        >
          {staleMessage}
        </div>
      ) : null}

      <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="grid flex-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <label className="space-y-1.5">
              <span className={financeModuleFilterLabelClass()}>Período</span>
              <select
                className={financeModuleFilterFieldClass()}
                value={filters.period}
                onChange={(e) =>
                  onFiltersChange({
                    ...filters,
                    period: e.target.value as typeof filters.period,
                  })
                }
              >
                {TREASURY_SIMPLE_CASH_RISK_PERIODS.map((p) => (
                  <option key={p} value={p}>
                    {TREASURY_SIMPLE_CASH_RISK_PERIOD_LABELS[p]}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1.5 sm:col-span-2 lg:col-span-2">
              <span className={financeModuleFilterLabelClass()}>Cenário</span>
              <div className="flex flex-wrap gap-2">
                {TREASURY_SIMPLE_CASH_RISK_SCENARIOS.map((s) => {
                  const meta = TREASURY_SIMPLE_CASH_RISK_SCENARIO_LABELS[s];
                  const selected = filters.scenario === s;
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() =>
                        onFiltersChange({ ...filters, scenario: s })
                      }
                      className={`rounded-lg border px-3 py-2 text-left text-sm transition ${
                        selected
                          ? "border-sky-300 bg-sky-50 text-sky-950"
                          : "border-border bg-background text-foreground hover:bg-muted/40"
                      }`}
                    >
                      <span className="font-medium">{meta.short}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {meta.description}
                      </span>
                    </button>
                  );
                })}
              </div>
            </label>
          </div>
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2.5 text-sm font-semibold text-foreground hover:bg-muted/40 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </button>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Saldo Base Atual"
          value={formatPredictiveCashFlowMoney(kpis.baseBalance)}
          tone="neutral"
        />
        <KpiCard
          label="Total A Receber"
          value={formatPredictiveCashFlowMoney(kpis.totalReceivables)}
          tone="in"
        />
        <KpiCard
          label="Total A Pagar"
          value={formatPredictiveCashFlowMoney(kpis.totalPayables)}
          tone="out"
        />
        <KpiCard
          label="Projeção Final"
          value={formatPredictiveCashFlowMoney(kpis.finalProjection)}
          tone="final"
        />
      </div>

      <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-foreground">
              Evolução do saldo
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Saldo projetado no horizonte · entradas em verde · saídas em vermelho
            </p>
          </div>
        </div>
        <PredictiveCashFlowTimelineChart timeline={timeline} />
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <div className="flex flex-col gap-6 xl:col-span-4">
          <PredictiveCashFlowAccountsPanel
            accounts={accounts}
            companyCode={companyCode}
            disabled={loading}
            onChanged={onRefresh}
          />
          <PredictiveCashFlowReconciliationPanel
            timeline={timeline}
            baseBalance={kpis.baseBalance}
            defaultDate={filters.selectedCivilDate || timeline[0]?.date || ""}
          />
        </div>
        <div className="xl:col-span-8">
          <PredictiveCashFlowTransactionsPanel
            transactions={transactions}
            accounts={accounts}
            disabled={loading}
            onChanged={onRefresh}
          />
        </div>
      </div>
    </div>
  );
}
