import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Scale } from "lucide-react";
import type { PredictiveCashFlowDailyBalance } from "@/src/lib/treasury/treasuryPredictiveCashFlow.js";
import {
  computePredictiveReconciliationDiff,
  findPredictiveTimelineDay,
  formatPredictiveCashFlowMoney,
} from "@/src/lib/treasury/treasuryPredictiveCashFlow.js";

export type PredictiveCashFlowReconciliationPanelProps = {
  timeline: readonly PredictiveCashFlowDailyBalance[];
  baseBalance: number;
  defaultDate: string;
};

function parseMoneyInput(raw: string): number {
  const n = Number(String(raw).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function glassInputClass() {
  return "w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-sky-400/40";
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
      className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-xl"
      data-testid="predictive-cf-reconciliation"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Scale className="h-4 w-4 text-slate-400" />
          <div>
            <h3 className="text-sm font-semibold text-slate-100">
              Fechamento diário
            </h3>
            <p className="text-xs text-slate-400">
              Compare extrato real × projeção processada
            </p>
          </div>
        </div>
        <Link
          to="/finance/treasury/today/closing"
          className="text-xs text-sky-300 hover:text-sky-200"
        >
          Fechar o dia
        </Link>
      </div>

      <div className="space-y-2">
        <label className="block text-xs text-slate-400">
          Data
          <input
            type="date"
            className={`${glassInputClass()} mt-1`}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label className="block text-xs text-slate-400">
          Saldo inicial real
          <input
            className={`${glassInputClass()} mt-1`}
            placeholder="0,00"
            value={realOpening}
            onChange={(e) => setRealOpening(e.target.value)}
          />
        </label>
        <label className="block text-xs text-slate-400">
          Saldo final real
          <input
            className={`${glassInputClass()} mt-1`}
            placeholder="0,00"
            value={realClosing}
            onChange={(e) => setRealClosing(e.target.value)}
          />
        </label>
      </div>

      <div className="mt-3 space-y-1.5 rounded-xl border border-white/5 bg-black/20 px-3 py-2 text-xs">
        <p className="flex justify-between text-slate-400">
          <span>Processado (saldo do dia)</span>
          <span className="tabular-nums text-slate-200">
            {processed
              ? formatPredictiveCashFlowMoney(processed.balance)
              : "—"}
          </span>
        </p>
        <p className="flex justify-between text-slate-400">
          <span>Entradas / Saídas do dia</span>
          <span className="tabular-nums text-slate-200">
            {processed
              ? `${formatPredictiveCashFlowMoney(processed.receivables)} / ${formatPredictiveCashFlowMoney(processed.payables)}`
              : "—"}
          </span>
        </p>
        {openingDiff != null ? (
          <p className="flex justify-between">
            <span className="text-slate-400">Δ inicial (real − processado)</span>
            <span
              className={`tabular-nums ${
                openingDiff === 0
                  ? "text-emerald-400"
                  : "text-rose-400"
              }`}
            >
              {formatPredictiveCashFlowMoney(openingDiff)}
            </span>
          </p>
        ) : null}
        {closingDiff != null ? (
          <p className="flex justify-between">
            <span className="text-slate-400">Δ final (real − processado)</span>
            <span
              className={`tabular-nums ${
                closingDiff === 0 ? "text-emerald-400" : "text-rose-400"
              }`}
            >
              {formatPredictiveCashFlowMoney(closingDiff)}
            </span>
          </p>
        ) : null}
        <p className="flex justify-between border-t border-white/10 pt-1.5 text-slate-300">
          <span>Soma de todos os saldos (base)</span>
          <span className="tabular-nums font-medium text-emerald-400">
            {formatPredictiveCashFlowMoney(baseBalance)}
          </span>
        </p>
      </div>
    </section>
  );
}
