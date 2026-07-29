import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Scale } from "lucide-react";
import type { PredictiveCashFlowDailyBalance } from "@/src/lib/treasury/treasuryPredictiveCashFlow.js";
import {
  computePredictiveReconciliationDiff,
  findPredictiveTimelineDay,
  formatPredictiveCashFlowMoney,
} from "@/src/lib/treasury/treasuryPredictiveCashFlow.js";
import {
  financeModuleFilterFieldClass,
  financeModuleFilterLabelClass,
} from "@/src/lib/financeModuleUiStandards.js";

export type PredictiveCashFlowReconciliationPanelProps = {
  timeline: readonly PredictiveCashFlowDailyBalance[];
  baseBalance: number;
  defaultDate: string;
};

function parseMoneyInput(raw: string): number {
  const n = Number(String(raw).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

export function PredictiveCashFlowReconciliationPanel({
  timeline,
  baseBalance,
  defaultDate,
}: PredictiveCashFlowReconciliationPanelProps) {
  const [date, setDate] = useState(defaultDate);
  const [realOpening, setRealOpening] = useState("");
  const [realClosing, setRealClosing] = useState("");

  const processed = useMemo(
    () => findPredictiveTimelineDay(timeline, date),
    [timeline, date]
  );

  const openingDiff =
    realOpening.trim() && processed
      ? computePredictiveReconciliationDiff(
          parseMoneyInput(realOpening),
          processed.openingBalance
        )
      : null;
  const closingDiff =
    realClosing.trim() && processed
      ? computePredictiveReconciliationDiff(
          parseMoneyInput(realClosing),
          processed.balance
        )
      : null;

  return (
    <section
      className="rounded-xl border border-border bg-card p-5 shadow-sm"
      data-testid="predictive-cf-reconciliation"
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <Scale className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div>
            <h3 className="text-base font-semibold text-foreground">
              Fechamento diário
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Compare extrato real × projeção processada
            </p>
          </div>
        </div>
        <Link
          to="/finance/treasury/today/closing"
          className="text-sm font-medium text-sky-700 hover:underline"
        >
          Fechar o dia
        </Link>
      </div>

      <div className="space-y-3">
        <label className="block space-y-1.5">
          <span className={financeModuleFilterLabelClass()}>Data</span>
          <input
            type="date"
            className={financeModuleFilterFieldClass()}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label className="block space-y-1.5">
          <span className={financeModuleFilterLabelClass()}>
            Saldo inicial real
          </span>
          <input
            className={financeModuleFilterFieldClass()}
            placeholder="0,00"
            value={realOpening}
            onChange={(e) => setRealOpening(e.target.value)}
          />
        </label>
        <label className="block space-y-1.5">
          <span className={financeModuleFilterLabelClass()}>
            Saldo final real
          </span>
          <input
            className={financeModuleFilterFieldClass()}
            placeholder="0,00"
            value={realClosing}
            onChange={(e) => setRealClosing(e.target.value)}
          />
        </label>
      </div>

      <div className="mt-4 space-y-2 rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm">
        <p className="flex justify-between gap-3 text-muted-foreground">
          <span>Processado (saldo do dia)</span>
          <span className="tabular-nums font-medium text-foreground">
            {processed
              ? formatPredictiveCashFlowMoney(processed.balance)
              : "—"}
          </span>
        </p>
        <p className="flex justify-between gap-3 text-muted-foreground">
          <span>Entradas / Saídas do dia</span>
          <span className="tabular-nums font-medium text-foreground">
            {processed
              ? `${formatPredictiveCashFlowMoney(processed.receivables)} / ${formatPredictiveCashFlowMoney(processed.payables)}`
              : "—"}
          </span>
        </p>
        {openingDiff != null ? (
          <p className="flex justify-between gap-3">
            <span className="text-muted-foreground">
              Δ inicial (real − processado)
            </span>
            <span
              className={`tabular-nums font-semibold ${
                openingDiff === 0 ? "text-emerald-700" : "text-rose-700"
              }`}
            >
              {formatPredictiveCashFlowMoney(openingDiff)}
            </span>
          </p>
        ) : null}
        {closingDiff != null ? (
          <p className="flex justify-between gap-3">
            <span className="text-muted-foreground">
              Δ final (real − processado)
            </span>
            <span
              className={`tabular-nums font-semibold ${
                closingDiff === 0 ? "text-emerald-700" : "text-rose-700"
              }`}
            >
              {formatPredictiveCashFlowMoney(closingDiff)}
            </span>
          </p>
        ) : null}
        <p className="flex justify-between gap-3 border-t border-border pt-2 font-medium text-foreground">
          <span>Soma de todos os saldos (base)</span>
          <span className="tabular-nums text-emerald-700">
            {formatPredictiveCashFlowMoney(baseBalance)}
          </span>
        </p>
      </div>
    </section>
  );
}
