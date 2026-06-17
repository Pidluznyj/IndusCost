/**
 * Recálculo independente das métricas AR — prova consistência do dashboard.
 * Não altera regras de produção; espelha fórmulas para auditoria.
 */
import {
  buildFinanceAccountsReceivableDashboard,
  classifyFinanceArTitle,
  computeDaysOverdue,
  hasFinanceArSourceInvoice,
  isFinanceArReceivedOrSettled,
  resolveFinanceArCustomerKey,
  roundMoney,
  safeRatio,
  startOfLocalDay,
  type FinanceArDashboardFilters,
  type FinanceArDashboardRow,
} from "./financeAccountsReceivableDashboard.js";
import { filterFinanceArManagementReportRows } from "./financeAccountsReceivableManagement.js";
import type { NomusArReportSyncCutoff } from "./financeNomusArReportFreshness.js";

export type FinanceArIndependentMetrics = {
  totalOpenAmount: number;
  overdueAmount: number;
  overdueOver30DaysAmount: number;
  overdueOver30DaysCount: number;
  receivedThisMonthAmount: number;
  delinquencyRate: number;
  avgDaysOverdue: number | null;
  agingOpenTotal: number;
  topDebtorsTotalOpen: number;
  criticalTitlesOpenTotal: number;
};

function monthBounds(referenceDate: Date): { start: Date; end: Date } {
  const start = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth() + 1,
    0,
    23,
    59,
    59,
    999
  );
  return { start, end };
}

/** Recalcula métricas principais a partir das linhas filtradas. */
export function computeFinanceArIndependentMetrics(
  rows: FinanceArDashboardRow[],
  filters: FinanceArDashboardFilters,
  referenceDate: Date = new Date(),
  syncCutoff?: NomusArReportSyncCutoff | null
): FinanceArIndependentMetrics {
  const filtered = filterFinanceArManagementReportRows(rows, filters, referenceDate, syncCutoff);
  const today = startOfLocalDay(referenceDate);
  const { start: monthStart, end: monthEnd } = monthBounds(referenceDate);

  let totalOpenAmount = 0;
  let overdueAmount = 0;
  let overdueOver30DaysAmount = 0;
  let overdueOver30DaysCount = 0;
  let receivedThisMonthAmount = 0;
  let avgWeightedDays = 0;
  let avgWeightedBalance = 0;
  let agingOpenTotal = 0;

  const debtorAcc = new Map<string, number>();

  for (const row of filtered) {
    if (
      row.settlementDate &&
      row.settlementDate.getTime() >= monthStart.getTime() &&
      row.settlementDate.getTime() <= monthEnd.getTime()
    ) {
      receivedThisMonthAmount += row.amountReceived;
    }

    if (isFinanceArReceivedOrSettled(row)) continue;

    const balance = row.balanceReceivable;
    totalOpenAmount += balance;

    const status = classifyFinanceArTitle(row, today);
    if (status === "overdue") {
      overdueAmount += balance;
      const days = computeDaysOverdue(row.dueDate, today);
      if (days > 30) {
        overdueOver30DaysAmount += balance;
        overdueOver30DaysCount += 1;
      }
      if (days > 0 && balance > 0) {
        avgWeightedDays += days * balance;
        avgWeightedBalance += balance;
      }
    }

    if (row.dueDate) {
      agingOpenTotal += balance;
    }

    const key = resolveFinanceArCustomerKey(row);
    debtorAcc.set(key, (debtorAcc.get(key) ?? 0) + balance);
  }

  const topDebtorsTotalOpen = [...debtorAcc.values()]
    .sort((a, b) => b - a)
    .slice(0, 10)
    .reduce((sum, v) => sum + v, 0);

  const criticalTitlesOpenTotal = filtered
    .filter((row) => !isFinanceArReceivedOrSettled(row))
    .sort(
      (a, b) =>
        computeDaysOverdue(b.dueDate, today) - computeDaysOverdue(a.dueDate, today) ||
        b.balanceReceivable - a.balanceReceivable
    )
    .slice(0, 20)
    .reduce((sum, row) => sum + row.balanceReceivable, 0);

  return {
    totalOpenAmount: roundMoney(totalOpenAmount),
    overdueAmount: roundMoney(overdueAmount),
    overdueOver30DaysAmount: roundMoney(overdueOver30DaysAmount),
    overdueOver30DaysCount,
    receivedThisMonthAmount: roundMoney(receivedThisMonthAmount),
    delinquencyRate: roundMoney(safeRatio(overdueAmount, totalOpenAmount) * 100),
    avgDaysOverdue:
      avgWeightedBalance > 0
        ? roundMoney(avgWeightedDays / avgWeightedBalance)
        : null,
    agingOpenTotal: roundMoney(agingOpenTotal),
    topDebtorsTotalOpen: roundMoney(topDebtorsTotalOpen),
    criticalTitlesOpenTotal: roundMoney(criticalTitlesOpenTotal),
  };
}

export type FinanceArDashboardAuditResult = {
  ok: boolean;
  mismatches: string[];
};

/** Compara payload do dashboard com recálculo independente. */
export function auditFinanceArDashboardCalculations(
  rows: FinanceArDashboardRow[],
  filters: FinanceArDashboardFilters,
  referenceDate: Date = new Date(),
  syncCutoff?: NomusArReportSyncCutoff | null
): FinanceArDashboardAuditResult {
  const dash = buildFinanceAccountsReceivableDashboard(rows, filters, referenceDate, syncCutoff);
  const ind = computeFinanceArIndependentMetrics(rows, filters, referenceDate, syncCutoff);
  const mismatches: string[] = [];

  const pairs: Array<[string, number | null, number | null]> = [
    ["totalOpenAmount", dash.cards.totalOpenAmount, ind.totalOpenAmount],
    ["overdueAmount", dash.cards.overdueAmount, ind.overdueAmount],
    ["overdueOver30DaysAmount", dash.cards.overdueOver30DaysAmount, ind.overdueOver30DaysAmount],
    ["overdueOver30DaysCount", dash.cards.overdueOver30DaysCount, ind.overdueOver30DaysCount],
    ["receivedThisMonthAmount", dash.cards.receivedThisMonthAmount, ind.receivedThisMonthAmount],
    ["delinquencyRate", dash.cards.delinquencyRate, ind.delinquencyRate],
    ["avgDaysOverdue", dash.cards.avgDaysOverdue, ind.avgDaysOverdue],
  ];

  for (const [name, actual, expected] of pairs) {
    if (actual !== expected) {
      mismatches.push(`${name}: dashboard=${actual} independent=${expected}`);
    }
  }

  const agingSum = roundMoney(
    dash.agingBuckets.reduce((sum, b) => sum + b.amount, 0)
  );
  if (agingSum !== ind.agingOpenTotal) {
    mismatches.push(
      `agingBuckets sum: dashboard=${agingSum} independent=${ind.agingOpenTotal}`
    );
  }

  const topSum = roundMoney(
    dash.topDebtors.reduce((sum, d) => sum + d.totalOpenAmount, 0)
  );
  if (topSum !== ind.topDebtorsTotalOpen) {
    mismatches.push(`topDebtors sum: dashboard=${topSum} independent=${ind.topDebtorsTotalOpen}`);
  }

  const criticalSum = roundMoney(
    dash.criticalTitles.reduce((sum, t) => sum + t.balanceReceivable, 0)
  );
  if (criticalSum !== ind.criticalTitlesOpenTotal) {
    mismatches.push(
      `criticalTitles sum: dashboard=${criticalSum} independent=${ind.criticalTitlesOpenTotal}`
    );
  }

  return { ok: mismatches.length === 0, mismatches };
}

/** Verifica que draft ≠ applied até o usuário aplicar (simulação de query strings). */
export function financeArDraftDiffersFromApplied(
  draftQuery: string,
  appliedQuery: string
): boolean {
  return draftQuery !== appliedQuery;
}

/** Confirma que invoiceIssued segue regra hasFinanceArSourceInvoice. */
export function countFinanceArInvoiceIssued(
  rows: FinanceArDashboardRow[],
  mode: "yes" | "no"
): number {
  return rows.filter((row) => {
    const has = hasFinanceArSourceInvoice(row);
    return mode === "yes" ? has : !has;
  }).length;
}
