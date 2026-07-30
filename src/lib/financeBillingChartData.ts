import { computeGrowthTarget } from "@/src/lib/salesOrderDashboardRules.js";
import { resolveFinanceBillingComparisonYears } from "@/src/lib/financeBillingChartTheme.js";

const MONTH_SHORT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export type BillingMultiYearMonthlyPoint = {
  month: number;
  monthLabel: string;
  /** year → valor mensal (null = mês futuro sem realizado) */
  values: Record<number, number | null>;
  /** Meta do ano selecionado = mesmo mês do ano anterior × 1,20 */
  targetValue: number | null;
};

export type BillingMultiYearSummary = {
  year: number;
  yearTotal: number;
  currentMonthValue: number | null;
  ytdTotal: number;
};

export function buildBillingMultiYearMonthlyPoints(
  selectedYear: number,
  yearMaps: Map<number, Map<number, number>>,
  ytdMonthLimit: number,
  isSelectedYearCurrent: boolean
): BillingMultiYearMonthlyPoint[] {
  const years = resolveFinanceBillingComparisonYears(selectedYear, 3);
  const previousYear = selectedYear - 1;
  const prevYearMap = yearMaps.get(previousYear) ?? new Map();

  return MONTH_SHORT.map((monthLabel, idx) => {
    const month = idx + 1;
    const values: Record<number, number | null> = {};

    for (const year of years) {
      const map = yearMaps.get(year);
      if (!map) {
        values[year] = null;
        continue;
      }
      if (year === selectedYear && isSelectedYearCurrent && month > ytdMonthLimit) {
        values[year] = null;
      } else {
        values[year] = map.get(month) ?? 0;
      }
    }

    const prevMonthValue = prevYearMap.get(month) ?? 0;
    const targetValue = computeGrowthTarget(prevMonthValue) ?? 0;

    return {
      month,
      monthLabel,
      values,
      targetValue,
    };
  });
}

export function buildBillingMultiYearSummaries(
  selectedYear: number,
  yearMaps: Map<number, Map<number, number>>,
  ytdMonthLimit: number,
  isSelectedYearCurrent: boolean
): BillingMultiYearSummary[] {
  const years = resolveFinanceBillingComparisonYears(selectedYear, 3);

  return years.map((year) => {
    const map = yearMaps.get(year) ?? new Map();
    let yearTotal = 0;
    let ytdTotal = 0;
    let currentMonthValue: number | null = null;

    for (let m = 1; m <= 12; m += 1) {
      const val = map.get(m) ?? 0;
      yearTotal += val;
      if (isSelectedYearCurrent && year === selectedYear) {
        if (m <= ytdMonthLimit) ytdTotal += val;
        if (m === ytdMonthLimit) currentMonthValue = val;
      } else if (!isSelectedYearCurrent && year === selectedYear) {
        ytdTotal += val;
        if (m === ytdMonthLimit) currentMonthValue = val;
      } else if (year !== selectedYear) {
        if (m <= ytdMonthLimit) ytdTotal += val;
      }
    }

    if (year !== selectedYear) {
      currentMonthValue = map.get(ytdMonthLimit) ?? 0;
    }

    return { year, yearTotal, currentMonthValue, ytdTotal };
  });
}

/** Acumula valores mensais; meses futuros ficam null no acumulado do ano corrente. */
export function buildBillingAccumulatedByYear(
  points: BillingMultiYearMonthlyPoint[],
  year: number
): Array<{ month: number; monthLabel: string; accumulated: number | null }> {
  let cum = 0;
  return points.map((p) => {
    const val = p.values[year];
    if (val == null) {
      return { month: p.month, monthLabel: p.monthLabel, accumulated: null };
    }
    cum += val;
    return { month: p.month, monthLabel: p.monthLabel, accumulated: cum };
  });
}
