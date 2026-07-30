/**
 * KPIs do Fluxo Gerencial — dois grids lado a lado:
 * Informado (extrato) × Calculado (sistema / CR·CP).
 */

import React, { useEffect, useMemo, useState } from "react";
import { Calculator, Landmark } from "lucide-react";
import type {
  PredictiveCashFlowAccount,
  PredictiveCashFlowTransaction,
} from "@/src/lib/treasury/treasuryPredictiveCashFlow.js";
import { formatPredictiveCashFlowMoney } from "@/src/lib/treasury/treasuryPredictiveCashFlow.js";
import { fetchTreasuryTodayOpening } from "@/src/lib/treasury/treasuryTodayOpeningApi.js";
import { fetchTreasuryTodayClosing } from "@/src/lib/treasury/treasuryTodayClosingApi.js";
import {
  buildPredictiveCashFlowReconciliationBoard,
  buildPredictiveCashFlowReconciliationBoardFromLocal,
  filterPredictiveCashFlowReconciliationBoardByAccountIds,
  formatPredictiveReconciliationMoney,
  type PredictiveCashFlowReconciliationTotals,
} from "@/src/lib/treasury/treasuryPredictiveCashFlowReconciliation.js";
import { cn } from "@/src/lib/utils";

export type PredictiveCashFlowBalanceKpisProps = {
  accounts: readonly PredictiveCashFlowAccount[];
  transactions: readonly PredictiveCashFlowTransaction[];
  civilDate: string;
};

function MetricTile({
  label,
  value,
  tone,
  testId,
}: {
  label: string;
  value: string;
  tone: "informed" | "calculated";
  testId: string;
}) {
  return (
    <div
      className={cn(
        "rounded-md border bg-white px-2.5 py-1.5 shadow-none",
        tone === "informed" ? "border-[#BFDBFE]" : "border-[#A7F3D0]"
      )}
      data-testid={testId}
    >
      <p className="text-[9px] font-bold uppercase tracking-wider text-[#6B7280]">
        {label}
      </p>
      <p
        className={cn(
          "mt-0.5 text-sm font-extrabold tabular-nums tracking-tight sm:text-base",
          tone === "informed" ? "text-[#1E3A8A]" : "text-[#065F46]"
        )}
        data-testid={`${testId}-value`}
      >
        {value}
      </p>
    </div>
  );
}

function KpiGrid({
  title,
  subtitle,
  icon,
  tone,
  opening,
  closing,
  testIdPrefix,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  tone: "informed" | "calculated";
  opening: string;
  closing: string;
  testIdPrefix: string;
}) {
  return (
    <section
      className={cn(
        "rounded-lg border px-2.5 py-2",
        tone === "informed"
          ? "border-[#BFDBFE] bg-gradient-to-br from-[#EFF6FF] to-white"
          : "border-[#A7F3D0] bg-gradient-to-br from-[#ECFDF5] to-white"
      )}
      data-testid={testIdPrefix}
    >
      <div className="mb-1.5 flex items-center gap-2">
        <div
          className={cn(
            "flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
            tone === "informed"
              ? "bg-[#DBEAFE] text-[#1D4ED8]"
              : "bg-[#D1FAE5] text-[#047857]"
          )}
        >
          {icon}
        </div>
        <div className="min-w-0">
          <h3 className="text-xs font-extrabold tracking-tight text-[#111827]">
            {title}
          </h3>
          <p className="truncate text-[10px] text-[#6B7280]">{subtitle}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <MetricTile
          label="Abertura"
          value={opening}
          tone={tone}
          testId={`${testIdPrefix}-opening`}
        />
        <MetricTile
          label="Fechamento"
          value={closing}
          tone={tone}
          testId={`${testIdPrefix}-closing`}
        />
      </div>
    </section>
  );
}

function formatTotal(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) {
    return formatPredictiveReconciliationMoney(null);
  }
  return formatPredictiveCashFlowMoney(value);
}

export function PredictiveCashFlowBalanceKpis({
  accounts,
  transactions,
  civilDate,
}: PredictiveCashFlowBalanceKpisProps) {
  const [totals, setTotals] = useState<PredictiveCashFlowReconciliationTotals | null>(
    null
  );

  const accountIds = useMemo(
    () => accounts.map((a) => a.id),
    [accounts]
  );

  const localTotals = useMemo(() => {
    if (!civilDate) return null;
    return buildPredictiveCashFlowReconciliationBoardFromLocal({
      civilDate,
      accounts,
      transactions,
    }).totals;
  }, [civilDate, accounts, transactions]);

  useEffect(() => {
    if (!civilDate) {
      setTotals(localTotals);
      return;
    }
    const ac = new AbortController();
    void Promise.all([
      fetchTreasuryTodayOpening({ date: civilDate, signal: ac.signal }),
      fetchTreasuryTodayClosing({ date: civilDate, signal: ac.signal }),
    ])
      .then(([openingWs, closingWs]) => {
        if (ac.signal.aborted) return;
        const board = filterPredictiveCashFlowReconciliationBoardByAccountIds(
          buildPredictiveCashFlowReconciliationBoard({
            civilDate,
            openingAccounts: openingWs.accounts,
            closingAccounts: closingWs.accounts,
          }),
          accountIds
        );
        setTotals(board.totals);
      })
      .catch(() => {
        if (ac.signal.aborted) return;
        setTotals(localTotals);
      });
    return () => ac.abort();
  }, [civilDate, localTotals, accountIds]);

  const view = totals ?? localTotals;
  const informedOpening = formatTotal(view?.informedOpening);
  const informedClosing = formatTotal(view?.informedClosing);
  const calculatedOpening = formatTotal(
    view?.calculatedOpening ?? view?.informedOpening ?? null
  );
  const calculatedClosing = formatTotal(view?.calculatedClosing);

  return (
    <div
      className="grid grid-cols-1 gap-2 sm:grid-cols-2"
      data-testid="predictive-cf-balance-kpis"
    >
      <KpiGrid
        title="Saldos informados"
        subtitle="Extrato / rotina canônica do dia"
        icon={<Landmark className="h-3.5 w-3.5" aria-hidden />}
        tone="informed"
        opening={informedOpening}
        closing={informedClosing}
        testIdPrefix="predictive-cf-kpi-informed"
      />
      <KpiGrid
        title="Saldos calculados"
        subtitle="Sistema com base em CR e CP"
        icon={<Calculator className="h-3.5 w-3.5" aria-hidden />}
        tone="calculated"
        opening={calculatedOpening}
        closing={calculatedClosing}
        testIdPrefix="predictive-cf-kpi-calculated"
      />
    </div>
  );
}
