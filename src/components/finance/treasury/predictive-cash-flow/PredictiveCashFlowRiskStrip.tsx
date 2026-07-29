/**
 * Faixa compacta de risco de caixa — menor saldo, negativo e reserva.
 * Fonte: buildTreasurySimpleCashRiskSummary (agenda canônica).
 */

import React from "react";
import { AlertTriangle, TrendingDown, Shield } from "lucide-react";
import type { TreasurySimpleCashRiskSummaryDto } from "@/src/lib/treasury/domain/treasurySimpleCashRiskProjectionRules.js";
import {
  formatTreasurySimpleCashRiskDate,
  formatTreasurySimpleCashRiskMoney,
  reserveIndicatorLabel,
} from "@/src/lib/treasury/treasurySimpleCashRiskProjectionUi.js";

export type PredictiveCashFlowRiskStripProps = {
  summary: TreasurySimpleCashRiskSummaryDto | null;
};

function RiskMetric({
  label,
  value,
  hint,
  testId,
}: {
  label: string;
  value: string;
  hint?: string | null;
  testId: string;
}) {
  return (
    <div className="min-w-0" data-testid={testId}>
      <p className="text-[10px] font-bold uppercase tracking-wider text-[#6B7280]">
        {label}
      </p>
      <p className="mt-1 text-base font-bold tabular-nums text-[#111827]">
        {value}
      </p>
      {hint ? (
        <p className="mt-0.5 truncate text-xs text-[#6B7280]">{hint}</p>
      ) : null}
    </div>
  );
}

export function PredictiveCashFlowRiskStrip({
  summary,
}: PredictiveCashFlowRiskStripProps) {
  if (!summary) return null;

  const hasNegative = Boolean(summary.firstNegativeDate);
  const lowestHint = summary.lowestBalanceDate
    ? formatTreasurySimpleCashRiskDate(summary.lowestBalanceDate)
    : null;

  return (
    <section
      className="rounded-xl border border-border bg-card p-5 shadow-sm"
      data-testid="predictive-cf-risk-strip"
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-foreground">
            Risco de caixa no horizonte
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Indicadores derivados da agenda consolidada (saldo de fechamento
            projetado).
          </p>
        </div>
        {hasNegative ? (
          <span
            className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-800"
            data-testid="predictive-cf-risk-negative-badge"
          >
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
            Saldo negativo previsto
          </span>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex gap-3">
          <TrendingDown
            className="mt-0.5 h-4 w-4 shrink-0 text-[#6B7280]"
            aria-hidden
          />
          <RiskMetric
            label="Menor saldo projetado"
            value={formatTreasurySimpleCashRiskMoney(summary.lowestBalance)}
            hint={lowestHint}
            testId="predictive-cf-risk-lowest"
          />
        </div>
        <RiskMetric
          label="Primeiro dia negativo"
          value={formatTreasurySimpleCashRiskDate(summary.firstNegativeDate)}
          hint={
            summary.largestDeficit
              ? `Maior déficit ${formatTreasurySimpleCashRiskMoney(summary.largestDeficit)}`
              : null
          }
          testId="predictive-cf-risk-first-negative"
        />
        <RiskMetric
          label="Entradas previstas"
          value={formatTreasurySimpleCashRiskMoney(summary.plannedInflows)}
          testId="predictive-cf-risk-inflows"
        />
        <RiskMetric
          label="Saídas previstas"
          value={formatTreasurySimpleCashRiskMoney(summary.plannedOutflows)}
          testId="predictive-cf-risk-outflows"
        />
      </div>

      {summary.reserve ? (
        <div
          className="mt-4 flex gap-3 rounded-lg border border-border bg-muted/30 px-3 py-3"
          data-testid="predictive-cf-risk-reserve"
        >
          <Shield
            className="mt-0.5 h-4 w-4 shrink-0 text-[#6B7280]"
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">
              Reserva mínima ·{" "}
              {formatTreasurySimpleCashRiskMoney(summary.reserve.minimumReserve)}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {reserveIndicatorLabel(summary)}
              {summary.firstDayBelowReserve
                ? ` · abaixo da reserva em ${formatTreasurySimpleCashRiskDate(summary.firstDayBelowReserve)}`
                : ""}
            </p>
          </div>
        </div>
      ) : null}
    </section>
  );
}
