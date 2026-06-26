/**
 * Projeção de vendas por dias úteis — reutiliza regras oficiais do dashboard de pedidos.
 */
import {
  countWorkdaysElapsedInMonth,
  countWorkdaysElapsedInYear,
  countWorkdaysInMonth,
  countWorkdaysInYear,
} from "./executiveDashboardWorkdays.js";
import {
  computeDailyAverageByWorkday,
  computeGrowthTarget,
  computeMonthProjection,
  computeYearProjection,
} from "./salesOrderDashboardRules.js";
import { roundPricingMoney } from "./pricingCalculations.js";
import type {
  SalesOrderResultProjection,
  SalesOrderResultRealizedVsProjectedRow,
} from "./salesOrderResultTypes.js";

const MONTH_LABELS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export function countRemainingWorkdaysInMonth(referenceDate: Date): number {
  const total = countWorkdaysInMonth(referenceDate.getFullYear(), referenceDate.getMonth());
  const elapsed = countWorkdaysElapsedInMonth(referenceDate);
  return Math.max(0, total - elapsed);
}

export function projectCurrentMonthSales(
  realizedMonth: number,
  referenceDate: Date
): number | null {
  const elapsed = countWorkdaysElapsedInMonth(referenceDate);
  const total = countWorkdaysInMonth(referenceDate.getFullYear(), referenceDate.getMonth());
  if (elapsed <= 0 || total <= 0) return null;
  const dailyAvg = computeDailyAverageByWorkday(realizedMonth, elapsed);
  return computeMonthProjection(dailyAvg, total);
}

export function projectFutureMonthSales(
  ytdRealized: number,
  referenceDate: Date,
  targetMonth: number
): number | null {
  const year = referenceDate.getFullYear();
  const elapsedYearDays = countWorkdaysElapsedInYear(referenceDate);
  if (elapsedYearDays <= 0) return null;
  const dailyAvgYtd = computeDailyAverageByWorkday(ytdRealized, elapsedYearDays);
  const workdaysInTargetMonth = countWorkdaysInMonth(year, targetMonth - 1);
  return computeMonthProjection(dailyAvgYtd, workdaysInTargetMonth);
}

export function buildSalesOrderResultRealizedVsProjected(input: {
  monthlySales: Array<{ month: number; amount: number }>;
  year: number;
  referenceDate: Date;
  previousYearMonthlySales?: Map<number, number>;
}): {
  rows: SalesOrderResultRealizedVsProjectedRow[];
  projection: SalesOrderResultProjection;
} {
  const { monthlySales, year, referenceDate, previousYearMonthlySales } = input;
  const currentMonth = referenceDate.getMonth() + 1;
  const salesByMonth = new Map(monthlySales.map((row) => [row.month, row.amount]));

  let ytdRealized = 0;
  for (let m = 1; m <= currentMonth; m += 1) {
    ytdRealized += salesByMonth.get(m) ?? 0;
  }
  ytdRealized = roundPricingMoney(ytdRealized);

  const elapsedBusinessDays = countWorkdaysElapsedInMonth(referenceDate);
  const remainingBusinessDays = countRemainingWorkdaysInMonth(referenceDate);
  const totalBusinessDaysInMonth = countWorkdaysInMonth(
    referenceDate.getFullYear(),
    referenceDate.getMonth()
  );
  const totalBusinessDaysInYearElapsed = countWorkdaysElapsedInYear(referenceDate);
  const currentMonthRealized = salesByMonth.get(currentMonth) ?? 0;
  const averageBusinessDaySales = computeDailyAverageByWorkday(
    currentMonthRealized,
    elapsedBusinessDays
  );
  const averageBusinessDaySalesYtd = computeDailyAverageByWorkday(
    ytdRealized,
    totalBusinessDaysInYearElapsed
  );
  const currentMonthProjected = projectCurrentMonthSales(currentMonthRealized, referenceDate);

  let yearProjected = ytdRealized;
  const rows: SalesOrderResultRealizedVsProjectedRow[] = [];

  for (let month = 1; month <= 12; month += 1) {
    const realizedAmount = roundPricingMoney(salesByMonth.get(month) ?? 0);
    const isPast = month < currentMonth;
    const isCurrentMonth = month === currentMonth;
    const isFuture = month > currentMonth;

    let projectedAmount: number | null = null;
    if (isPast) {
      projectedAmount = null;
    } else if (isCurrentMonth) {
      projectedAmount = currentMonthProjected;
    } else {
      projectedAmount = projectFutureMonthSales(ytdRealized, referenceDate, month);
    }

    if (isFuture && projectedAmount != null) {
      yearProjected += projectedAmount;
    } else if (isCurrentMonth && projectedAmount != null) {
      yearProjected += Math.max(0, projectedAmount - realizedAmount);
    }

    const prevYearAmount = previousYearMonthlySales?.get(month) ?? null;
    const targetAmount = prevYearAmount != null ? computeGrowthTarget(prevYearAmount) : null;

    rows.push({
      month,
      monthLabel: MONTH_LABELS[month - 1] ?? String(month),
      realizedAmount,
      projectedAmount: projectedAmount != null ? roundPricingMoney(projectedAmount) : null,
      targetAmount: targetAmount != null ? roundPricingMoney(targetAmount) : null,
      isRealized: isPast || isCurrentMonth,
      isCurrentMonth,
      isFuture,
    });
  }

  yearProjected = roundPricingMoney(yearProjected);
  const yearTarget =
    previousYearMonthlySales != null
      ? computeGrowthTarget(
          [...previousYearMonthlySales.values()].reduce((acc, v) => acc + v, 0)
        )
      : null;
  const projectedAchievementPercent =
    yearTarget != null && yearTarget > 0 ? roundPricingMoney((yearProjected / yearTarget) * 100) : null;

  return {
    rows,
    projection: {
      currentMonthRealized: roundPricingMoney(currentMonthRealized),
      currentMonthProjected:
        currentMonthProjected != null ? roundPricingMoney(currentMonthProjected) : null,
      yearRealized: ytdRealized,
      yearProjected,
      yearTarget: yearTarget != null ? roundPricingMoney(yearTarget) : null,
      projectedAchievementPercent,
      averageBusinessDaySales,
      averageBusinessDaySalesYtd,
      elapsedBusinessDays,
      remainingBusinessDays,
      totalBusinessDaysInMonth,
      totalBusinessDaysInYearElapsed,
    },
  };
}

export function buildMonthlySalesFromOrders(
  orders: Array<{ issueMonth: number; totalNetValue: number }>
): Array<{ month: number; amount: number }> {
  const map = new Map<number, number>();
  for (const order of orders) {
    if (order.issueMonth < 1 || order.issueMonth > 12) continue;
    map.set(order.issueMonth, roundPricingMoney((map.get(order.issueMonth) ?? 0) + order.totalNetValue));
  }
  return [...map.entries()].map(([month, amount]) => ({ month, amount }));
}

export { countWorkdaysInYear };
