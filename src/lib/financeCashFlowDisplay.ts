import {
  formatFinanceCurrency,
  formatFinanceCurrencyCompact,
} from "./financeAccountsReceivableFormat.js";
import type { FinanceCashFlowMonthlyPoint } from "./financeCashFlowDashboardTypes.js";

/** Posição líquida de caixa = total a receber em aberto − total a pagar em aberto. */
export function computeCashFlowNetPosition(
  totalReceivableOpen: number,
  totalPayableOpen: number
): number {
  return totalReceivableOpen - totalPayableOpen;
}

export type CashFlowNetPositionTone = {
  isSurplus: boolean;
  statusLabel: string;
};

export function resolveCashFlowNetPositionTone(posicaoLiquida: number): CashFlowNetPositionTone {
  if (posicaoLiquida >= 0) {
    return { isSurplus: true, statusLabel: "Superávit projetado" };
  }
  return { isSurplus: false, statusLabel: "Déficit projetado" };
}

export function cashFlowMonthlySeriesHasData(points: FinanceCashFlowMonthlyPoint[]): boolean {
  return points.some(
    (p) =>
      (p.inflowAmount != null && p.inflowAmount !== 0) ||
      (p.outflowAmount != null && p.outflowAmount !== 0) ||
      (p.netFlowAmount != null && p.netFlowAmount !== 0)
  );
}

export type CashFlowNetPositionChartRow = {
  name: string;
  receivable: number;
  payable: number;
  netPosition: number;
  accumulated: number | null;
  status: "positive" | "negative" | null;
};

export function buildCashFlowNetPositionChartRows(
  points: FinanceCashFlowMonthlyPoint[]
): CashFlowNetPositionChartRow[] {
  return points.map((p) => {
    const receivable = p.inflowAmount ?? 0;
    const payable = p.outflowAmount ?? 0;
    const netPosition = p.netFlowAmount ?? receivable - payable;
    const status =
      p.status ?? (p.netFlowAmount == null ? null : p.netFlowAmount >= 0 ? "positive" : "negative");
    return {
      name: p.monthLabel,
      receivable,
      payable,
      netPosition,
      accumulated: p.accumulatedBalance,
      status,
    };
  });
}

export function formatCashFlowKpiDisplay(amount: number): { display: string; full: string } {
  const full = formatFinanceCurrency(amount);
  const display = formatFinanceCurrencyCompact(amount);
  return { display, full };
}
