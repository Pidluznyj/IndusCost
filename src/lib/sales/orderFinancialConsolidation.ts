/**
 * Consolidação financeira Pedido × CR × planejado — frontend-safe.
 * Sem Prisma / sem services de auditoria.
 */
import type { OrderFullAuditPlannedReceivablesTotal } from "@/src/lib/finance/orderFullAuditClient.js";
import {
  computeOrderTotalFinancialValue,
  resolveApplicablePlannedExpected,
  roundOrderMoney,
} from "@/src/lib/sales/orderFiscalFinancialMetrics.js";

export type ConsolidatedReceivablesTotalsInput = {
  totalAmount: number;
  openAmount: number;
  receivedAmount: number;
};

export type ConsolidatedFinancialSummary = {
  totalFinancialValue: number;
  totalFinancialOpen: number;
  realCrTotal: number;
  realCrOpen: number;
  /** Planejado ainda aplicável (exclui substituído). */
  plannedTotal: number;
  plannedGrossTotal: number;
  plannedReplacedAmount: number;
  plannedOpen: number;
  receivedTotal: number;
};

/**
 * Total financeiro = CR real + planejado aplicável.
 * Planejado substituído por CR real NÃO entra novamente.
 */
export function computeConsolidatedFinancialSummary(payload: {
  totals: ConsolidatedReceivablesTotalsInput;
  plannedTotals: Pick<
    OrderFullAuditPlannedReceivablesTotal,
    "totalExpected" | "replacedAmount" | "openExpected"
  > & { applicableExpected?: number };
}): ConsolidatedFinancialSummary {
  const plannedApplicable = roundOrderMoney(
    payload.plannedTotals.applicableExpected ??
      resolveApplicablePlannedExpected({
        totalExpected: payload.plannedTotals.totalExpected ?? 0,
        replacedAmount: payload.plannedTotals.replacedAmount ?? 0,
      })
  );

  return {
    totalFinancialValue: computeOrderTotalFinancialValue({
      crOriginal: payload.totals.totalAmount,
      plannedApplicableExpected: plannedApplicable,
    }),
    totalFinancialOpen: roundOrderMoney(
      payload.totals.openAmount + payload.plannedTotals.openExpected
    ),
    realCrTotal: roundOrderMoney(payload.totals.totalAmount),
    realCrOpen: roundOrderMoney(payload.totals.openAmount),
    plannedTotal: plannedApplicable,
    plannedGrossTotal: roundOrderMoney(payload.plannedTotals.totalExpected),
    plannedReplacedAmount: roundOrderMoney(payload.plannedTotals.replacedAmount ?? 0),
    plannedOpen: roundOrderMoney(payload.plannedTotals.openExpected),
    receivedTotal: roundOrderMoney(payload.totals.receivedAmount),
  };
}
