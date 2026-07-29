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
      ? "text-emerald-400"
      : tone === "out"
        ? "text-rose-400"
        : tone === "final"
          ? "text-sky-300"
          : "text-slate-100";
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur-xl">
      <p className="text-xs text-slate-400">{label}</p>
      <p className={`mt-1 text-lg font-semibold tabular-nums ${valueClass}`}>
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
      className="relative flex h-[calc(100vh-7.5rem)] min-h-[36rem] flex-col overflow-hidden rounded-3xl border border-white/10 bg-slate-950 text-slate-100 shadow-2xl"
      data-testid="predictive-cash-flow-dashboard"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-blue-600/20 blur-[120px]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-28 right-0 h-80 w-80 rounded-full bg-emerald-500/10 blur-[120px]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute right-1/3 top-1/4 h-56 w-56 rounded-full bg-rose-500/10 blur-[100px]"
      />

      <header className="relative z-10 flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-white/10 px-5 py-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-50">
            Fluxo Gerencial
          </h1>
          <p className="mt-0.5 max-w-2xl text-sm text-slate-400">
            Projeção de caixa a partir das contas, títulos e lançamentos canônicos
            da Tesouraria — sem armazenamento local.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none"
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
          <select
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none"
            value={filters.scenario}
            onChange={(e) =>
              onFiltersChange({
                ...filters,
                scenario: e.target.value as typeof filters.scenario,
              })
            }
          >
            {TREASURY_SIMPLE_CASH_RISK_SCENARIOS.map((s) => (
              <option key={s} value={s}>
                {TREASURY_SIMPLE_CASH_RISK_SCENARIO_LABELS[s].short}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200 hover:bg-white/10 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </button>
        </div>
      </header>

      {(error || staleMessage) && (
        <div className="relative z-10 shrink-0 space-y-1 px-5 pt-3">
          {error ? (
            <div className="flex items-start justify-between gap-2 rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
              <span>{error}</span>
              {onDismissError ? (
                <button
                  type="button"
                  className="text-xs text-rose-100/80"
                  onClick={onDismissError}
                >
                  Fechar
                </button>
              ) : null}
            </div>
          ) : null}
          {staleMessage ? (
            <p className="rounded-xl border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
              {staleMessage}
            </p>
          ) : null}
        </div>
      )}

      <div className="relative z-10 grid shrink-0 grid-cols-2 gap-3 px-5 py-4 lg:grid-cols-4">
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

      <div className="relative z-10 min-h-0 flex-1 overflow-y-auto px-5 pb-5">
        <section className="mb-4 rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-xl">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-100">
              Evolução do saldo
            </h2>
            <p className="text-[11px] text-slate-500">
              Azul = saldo projetado · entradas emerald · saídas rose
            </p>
          </div>
          <PredictiveCashFlowTimelineChart timeline={timeline} />
        </section>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <div className="flex flex-col gap-4 lg:col-span-4">
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
          <div className="lg:col-span-8">
            <PredictiveCashFlowTransactionsPanel
              transactions={transactions}
              accounts={accounts}
              disabled={loading}
              onChanged={onRefresh}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
