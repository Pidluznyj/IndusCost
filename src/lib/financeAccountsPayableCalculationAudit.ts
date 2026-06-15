/**
 * Recálculo independente das métricas AP — prova consistência do dashboard.
 */
import {
  buildFinanceAccountsPayableDashboard,
  classifyFinanceApTitle,
  filterFinanceApRows,
  isFinanceApOpen,
  isFinanceApSettled,
  resolveFinanceApSupplierKey,
  roundMoney,
  safeRatio,
  startOfLocalDay,
  type FinanceApDashboardFilters,
  type FinanceApDashboardRow,
} from "./financeAccountsPayableDashboard.js";
import {
  isFinanceApCancelledTitle,
  resolveFinanceApEffectivePaymentDate,
  resolveFinanceApOpenAmount,
  resolveFinanceApRealizedAmount,
} from "./financeAccountsPayableRules.js";
import {
  computeFinanceApDaysOverdue,
  getAccountsPayableOperationalDueDate,
} from "./financeAccountsPayableOperational.js";

export type FinanceApIndependentMetrics = {
  totalOpenAmount: number;
  overdueAmount: number;
  overdueOver30DaysAmount: number;
  overdueOver30DaysCount: number;
  paidThisMonthAmount: number;
  dueTodayAmount: number;
  dueNext7DaysAmount: number;
  dueNext30DaysAmount: number;
  overduePercent: number;
  avgDaysOverdue: number | null;
  agingOpenTotal: number;
  topSuppliersTotalOpen: number;
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

function isDueInRange(dueDate: Date | null, from: Date, to: Date): boolean {
  if (!dueDate) return false;
  const due = startOfLocalDay(dueDate).getTime();
  return due >= from.getTime() && due <= to.getTime();
}

export function computeFinanceApIndependentMetrics(
  rows: FinanceApDashboardRow[],
  filters: FinanceApDashboardFilters,
  referenceDate: Date = new Date()
): FinanceApIndependentMetrics {
  const filtered = filterFinanceApRows(rows, filters, referenceDate);
  const today = startOfLocalDay(referenceDate);
  const in7Days = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7, 23, 59, 59, 999);
  const in30Days = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 30, 23, 59, 59, 999);
  const { start: monthStart, end: monthEnd } = monthBounds(referenceDate);

  let totalOpenAmount = 0;
  let overdueAmount = 0;
  let overdueOver30DaysAmount = 0;
  let overdueOver30DaysCount = 0;
  let paidThisMonthAmount = 0;
  let dueTodayAmount = 0;
  let dueNext7DaysAmount = 0;
  let dueNext30DaysAmount = 0;
  let avgWeightedDays = 0;
  let avgWeightedBalance = 0;
  let agingOpenTotal = 0;

  const supplierAcc = new Map<string, number>();

  for (const row of filtered) {
    if (isFinanceApCancelledTitle(row)) continue;

    const payAt = resolveFinanceApEffectivePaymentDate(row);
    const realized = resolveFinanceApRealizedAmount(row);
    if (
      payAt &&
      realized > 0 &&
      payAt.getTime() >= monthStart.getTime() &&
      payAt.getTime() <= monthEnd.getTime()
    ) {
      paidThisMonthAmount += realized;
    }

    if (isFinanceApSettled(row)) continue;

    const balance = resolveFinanceApOpenAmount(row);
    totalOpenAmount += balance;
    const status = classifyFinanceApTitle(row, today);

    const operationalDueDate = getAccountsPayableOperationalDueDate(row);

    if (status === "overdue") {
      overdueAmount += balance;
      const days = computeFinanceApDaysOverdue(row, today);
      if (days > 30) {
        overdueOver30DaysAmount += balance;
        overdueOver30DaysCount += 1;
      }
      if (days > 0 && balance > 0) {
        avgWeightedDays += days * balance;
        avgWeightedBalance += balance;
      }
    } else if (status === "dueToday") {
      dueTodayAmount += balance;
    } else if (status === "upcoming") {
      if (operationalDueDate && isDueInRange(operationalDueDate, today, in7Days)) {
        dueNext7DaysAmount += balance;
      }
      if (operationalDueDate && isDueInRange(operationalDueDate, today, in30Days)) {
        dueNext30DaysAmount += balance;
      }
    }

    if (operationalDueDate) agingOpenTotal += balance;

    const key = resolveFinanceApSupplierKey(row);
    supplierAcc.set(key, (supplierAcc.get(key) ?? 0) + balance);
  }

  const topSuppliersTotalOpen = [...supplierAcc.values()]
    .sort((a, b) => b - a)
    .slice(0, 10)
    .reduce((sum, v) => sum + v, 0);

  const criticalTitlesOpenTotal = filtered
    .filter((row) => isFinanceApOpen(row))
    .sort(
      (a, b) =>
        computeFinanceApDaysOverdue(b, today) - computeFinanceApDaysOverdue(a, today) ||
        b.balancePayable - a.balancePayable
    )
    .slice(0, 20)
    .reduce((sum, row) => sum + resolveFinanceApOpenAmount(row), 0);

  return {
    totalOpenAmount: roundMoney(totalOpenAmount),
    overdueAmount: roundMoney(overdueAmount),
    overdueOver30DaysAmount: roundMoney(overdueOver30DaysAmount),
    overdueOver30DaysCount,
    paidThisMonthAmount: roundMoney(paidThisMonthAmount),
    dueTodayAmount: roundMoney(dueTodayAmount),
    dueNext7DaysAmount: roundMoney(dueNext7DaysAmount),
    dueNext30DaysAmount: roundMoney(dueNext30DaysAmount),
    overduePercent: roundMoney(safeRatio(overdueAmount, totalOpenAmount) * 100),
    avgDaysOverdue:
      avgWeightedBalance > 0 ? roundMoney(avgWeightedDays / avgWeightedBalance) : null,
    agingOpenTotal: roundMoney(agingOpenTotal),
    topSuppliersTotalOpen: roundMoney(topSuppliersTotalOpen),
    criticalTitlesOpenTotal: roundMoney(criticalTitlesOpenTotal),
  };
}

export function auditFinanceApDashboardCalculations(
  rows: FinanceApDashboardRow[],
  filters: FinanceApDashboardFilters,
  referenceDate: Date = new Date()
): { ok: boolean; mismatches: string[] } {
  const dash = buildFinanceAccountsPayableDashboard(rows, filters, referenceDate);
  const ind = computeFinanceApIndependentMetrics(rows, filters, referenceDate);
  const mismatches: string[] = [];

  const pairs: Array<[string, number | null, number | null]> = [
    ["totalOpenAmount", dash.cards.totalOpenAmount, ind.totalOpenAmount],
    ["overdueAmount", dash.cards.overdueAmount, ind.overdueAmount],
    ["overdueOver30DaysAmount", dash.cards.overdueOver30DaysAmount, ind.overdueOver30DaysAmount],
    ["paidThisMonthAmount", dash.cards.paidThisMonthAmount, ind.paidThisMonthAmount],
    ["dueTodayAmount", dash.cards.dueTodayAmount, ind.dueTodayAmount],
    ["dueNext7DaysAmount", dash.cards.dueNext7DaysAmount, ind.dueNext7DaysAmount],
    ["dueNext30DaysAmount", dash.cards.dueNext30DaysAmount, ind.dueNext30DaysAmount],
    ["overduePercent", dash.cards.overduePercent, ind.overduePercent],
    ["avgDaysOverdue", dash.cards.avgDaysOverdue, ind.avgDaysOverdue],
  ];

  for (const [name, actual, expected] of pairs) {
    if (actual !== expected) mismatches.push(`${name}: dashboard=${actual} independent=${expected}`);
  }

  const agingSum = roundMoney(dash.agingBuckets.reduce((s, b) => s + b.amount, 0));
  if (agingSum !== ind.agingOpenTotal) {
    mismatches.push(`agingBuckets sum: dashboard=${agingSum} independent=${ind.agingOpenTotal}`);
  }

  return { ok: mismatches.length === 0, mismatches };
}
