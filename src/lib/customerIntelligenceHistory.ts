/**
 * Histórico de compras, sazonalidade e análise anual/mensal — Inteligência do Cliente.
 */

import type {
  CustomerIntelligenceOrderInput,
  CustomerIntelligencePurchaseHistory,
  CustomerIntelligencePurchasesAnalysis,
  CustomerIntelligenceSeasonality,
  CustomerIntelligenceStrongMonth,
} from "@/src/lib/customerIntelligenceTypes.js";
import {
  monthLabelPt,
  roundMoney,
  safeCommercialNumber,
  safeDivide,
  safeFiniteNumber,
} from "@/src/lib/customerIntelligenceUtils.js";
import { computeWeightedMarginPercent } from "@/src/lib/salesMarginRulesAdapter.js";

const MONTH_NAMES_PT = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
] as const;

export const CUSTOMER_INTELLIGENCE_MIN_YEARS_FOR_SEASONALITY = 2;
export const CUSTOMER_INTELLIGENCE_SEASONALITY_CONCENTRATION_RATIO = 1.8;

export function monthNamePtFull(month: number): string {
  if (month < 1 || month > 12) return "—";
  return MONTH_NAMES_PT[month - 1]!;
}

/** Crescimento percentual vs ano anterior; null se sem base (anterior zero ou inválido). */
export function computeYearOverYearGrowthPercent(
  currentRevenue: number,
  previousRevenue: number | null | undefined
): number | null {
  if (previousRevenue == null || previousRevenue <= 0 || !Number.isFinite(previousRevenue)) {
    return null;
  }
  if (!Number.isFinite(currentRevenue)) return null;
  const growth = ((currentRevenue - previousRevenue) / previousRevenue) * 100;
  if (!Number.isFinite(growth)) return null;
  return roundMoney(growth);
}

type YearAgg = {
  year: number;
  ordersCount: number;
  revenue: number;
  marginAmount: number;
};

type MonthAgg = {
  year: number;
  month: number;
  ordersCount: number;
  revenue: number;
  marginAmount: number;
};

function finalizeYearBucket(
  agg: YearAgg,
  growth: number | null
): CustomerIntelligencePurchaseHistory["byYear"][number] {
  return {
    year: agg.year,
    ordersCount: agg.ordersCount,
    validOrdersCount: agg.ordersCount,
    revenue: roundMoney(agg.revenue) ?? 0,
    averageTicket: safeDivide(agg.revenue, agg.ordersCount),
    marginAmount: roundMoney(agg.marginAmount),
    marginPercent: computeWeightedMarginPercent(agg.marginAmount, agg.revenue),
    growthPercentVsPreviousYear: growth,
  };
}

function finalizeMonthBucket(agg: MonthAgg): CustomerIntelligencePurchaseHistory["byMonth"][number] {
  return {
    year: agg.year,
    month: agg.month,
    label: `${monthLabelPt(agg.month)}/${agg.year}`,
    ordersCount: agg.ordersCount,
    revenue: roundMoney(agg.revenue) ?? 0,
    averageTicket: safeDivide(agg.revenue, agg.ordersCount),
    marginAmount: roundMoney(agg.marginAmount),
    marginPercent: computeWeightedMarginPercent(agg.marginAmount, agg.revenue),
  };
}

export function buildPurchasesAnalysis(
  byYear: CustomerIntelligencePurchaseHistory["byYear"],
  referenceDate: Date
): CustomerIntelligencePurchasesAnalysis {
  if (byYear.length === 0) {
    return {
      bestYear: null,
      bestYearRevenue: null,
      declinedYear: null,
      declinedYearRevenue: null,
      referenceYear: null,
      referenceYearRevenue: null,
      growthPercentVsPreviousYear: null,
      growthStatus: "insufficient",
      trendReading: null,
    };
  }

  const best = [...byYear].sort((a, b) => b.revenue - a.revenue)[0]!;
  const worst = [...byYear].sort((a, b) => a.revenue - b.revenue)[0]!;

  const refYear = referenceDate.getFullYear();
  const refBucket = byYear.find((y) => y.year === refYear) ?? byYear[byYear.length - 1]!;
  const growth = refBucket.growthPercentVsPreviousYear;

  let growthStatus: CustomerIntelligencePurchasesAnalysis["growthStatus"] = "sem_base";
  if (byYear.length < 2) {
    growthStatus = "insufficient";
  } else if (growth == null) {
    growthStatus = "sem_base";
  } else if (growth > 5) {
    growthStatus = "growth";
  } else if (growth < -5) {
    growthStatus = "decline";
  } else {
    growthStatus = "stable";
  }

  let trendReading: string | null = null;
  if (byYear.length < 2) {
    trendReading = "Histórico anual insuficiente para avaliar tendência.";
  } else if (growthStatus === "sem_base") {
    trendReading = `Receita em ${refBucket.year} sem base comparável no ano anterior.`;
  } else if (growthStatus === "growth") {
    trendReading = `Crescimento de ${growth!.toFixed(1)}% em ${refBucket.year} vs ano anterior.`;
  } else if (growthStatus === "decline") {
    trendReading = `Queda de ${Math.abs(growth!).toFixed(1)}% em ${refBucket.year} vs ano anterior.`;
  } else {
    trendReading = `Receita estável em ${refBucket.year} (variação ${growth!.toFixed(1)}% vs ano anterior).`;
  }

  return {
    bestYear: best.year,
    bestYearRevenue: best.revenue,
    declinedYear: worst.year,
    declinedYearRevenue: worst.revenue,
    referenceYear: refBucket.year,
    referenceYearRevenue: refBucket.revenue,
    growthPercentVsPreviousYear: growth,
    growthStatus,
    trendReading,
  };
}

export function buildCustomerIntelligenceHistory(
  metricsOrders: CustomerIntelligenceOrderInput[],
  referenceDate: Date = new Date()
): CustomerIntelligencePurchaseHistory {
  if (metricsOrders.length === 0) {
    const analysis = buildPurchasesAnalysis([], referenceDate);
    return {
      byYear: [],
      byMonth: [],
      strongestMonths: [],
      analysis,
      lifetimeAnalysis: analysis,
      scopeNotice: null,
    };
  }

  const byYearMap = new Map<number, YearAgg>();
  const byMonthMap = new Map<string, MonthAgg>();
  const calendarMonthAgg = new Map<
    number,
    { ordersCount: number; revenue: number; years: Set<number> }
  >();

  for (const order of metricsOrders) {
    const year = order.issueDate.getFullYear();
    const month = order.issueDate.getMonth() + 1;
    const net = safeCommercialNumber(order.totalNetValue);
    const marginVal = safeFiniteNumber(order.totalMarginValue) ?? 0;

    const yearBucket = byYearMap.get(year) ?? {
      year,
      ordersCount: 0,
      revenue: 0,
      marginAmount: 0,
    };
    yearBucket.ordersCount += 1;
    yearBucket.revenue += net;
    yearBucket.marginAmount += marginVal;
    byYearMap.set(year, yearBucket);

    const monthKey = `${year}-${String(month).padStart(2, "0")}`;
    const monthBucket = byMonthMap.get(monthKey) ?? {
      year,
      month,
      ordersCount: 0,
      revenue: 0,
      marginAmount: 0,
    };
    monthBucket.ordersCount += 1;
    monthBucket.revenue += net;
    monthBucket.marginAmount += marginVal;
    byMonthMap.set(monthKey, monthBucket);

    const cal = calendarMonthAgg.get(month) ?? {
      ordersCount: 0,
      revenue: 0,
      years: new Set<number>(),
    };
    cal.ordersCount += 1;
    cal.revenue += net;
    cal.years.add(year);
    calendarMonthAgg.set(month, cal);
  }

  const yearsSorted = [...byYearMap.keys()].sort((a, b) => a - b);
  const byYear = yearsSorted.map((year, idx) => {
    const agg = byYearMap.get(year)!;
    const prevYear = idx > 0 ? byYearMap.get(yearsSorted[idx - 1]!) : undefined;
    const growth = computeYearOverYearGrowthPercent(agg.revenue, prevYear?.revenue ?? null);
    return finalizeYearBucket(agg, growth);
  });

  const byMonth = [...byMonthMap.values()]
    .map(finalizeMonthBucket)
    .sort((a, b) => a.year - b.year || a.month - b.month);

  const distinctYears = new Set(metricsOrders.map((o) => o.issueDate.getFullYear()));
  const yearsSpan = distinctYears.size;

  const byRevenue = [...calendarMonthAgg.entries()].sort((a, b) => b[1].revenue - a[1].revenue);
  const byQty = [...calendarMonthAgg.entries()].sort((a, b) => b[1].ordersCount - a[1].ordersCount);
  const revenueRank = new Map<number, number>();
  byRevenue.forEach(([month], idx) => revenueRank.set(month, idx + 1));
  const qtyRank = new Map<number, number>();
  byQty.forEach(([month], idx) => qtyRank.set(month, idx + 1));

  const strongestMonths: CustomerIntelligenceStrongMonth[] = byRevenue.slice(0, 12).map(
    ([month, data]) => ({
      month,
      monthName: monthNamePtFull(month),
      totalRevenue: roundMoney(data.revenue) ?? 0,
      ordersCount: data.ordersCount,
      recurrenceScore:
        yearsSpan >= CUSTOMER_INTELLIGENCE_MIN_YEARS_FOR_SEASONALITY
          ? roundMoney(data.years.size / yearsSpan)
          : null,
      rankByRevenue: revenueRank.get(month) ?? 0,
      rankByQuantity: qtyRank.get(month) ?? 0,
    })
  );

  const analysis = buildPurchasesAnalysis(byYear, referenceDate);

  return {
    byYear,
    byMonth,
    strongestMonths,
    analysis,
    lifetimeAnalysis: analysis,
    scopeNotice: null,
  };
}

export function buildCustomerIntelligenceSeasonality(
  history: CustomerIntelligencePurchaseHistory
): CustomerIntelligenceSeasonality {
  const empty: CustomerIntelligenceSeasonality = {
    strongestMonth: null,
    weakestMonth: null,
    activeMonthsCount: 0,
    hasSeasonality: false,
    reading: null,
    peakMonths: [],
    lowMonths: [],
  };

  if (history.strongestMonths.length === 0) return empty;

  const activeMonthsCount = history.strongestMonths.filter((m) => m.ordersCount > 0).length;
  const ranked = [...history.strongestMonths].sort((a, b) => b.totalRevenue - a.totalRevenue);
  const peakMonths = ranked.slice(0, 3);
  const lowMonths = [...ranked].reverse().slice(0, 3).filter((m) => m.totalRevenue > 0);

  const top = ranked[0]!;
  const bottom = [...ranked].reverse().find((m) => m.totalRevenue > 0) ?? null;

  const strongestMonth = {
    month: top.month,
    monthName: top.monthName,
    totalRevenue: top.totalRevenue,
    ordersCount: top.ordersCount,
  };

  const weakestMonth = bottom
    ? {
        month: bottom.month,
        monthName: bottom.monthName,
        totalRevenue: bottom.totalRevenue,
        ordersCount: bottom.ordersCount,
      }
    : null;

  const totalRevenue = ranked.reduce((acc, m) => acc + m.totalRevenue, 0);
  const avgRevenue = activeMonthsCount > 0 ? totalRevenue / activeMonthsCount : 0;
  const concentrationRatio = avgRevenue > 0 ? top.totalRevenue / avgRevenue : 0;

  const distinctYears = new Set(history.byMonth.map((m) => m.year)).size;
  const hasEnoughHistory =
    distinctYears >= CUSTOMER_INTELLIGENCE_MIN_YEARS_FOR_SEASONALITY && activeMonthsCount >= 2;

  const hasSeasonality =
    hasEnoughHistory &&
    Number.isFinite(concentrationRatio) &&
    concentrationRatio >= CUSTOMER_INTELLIGENCE_SEASONALITY_CONCENTRATION_RATIO;

  let reading: string | null = null;
  if (!hasEnoughHistory) {
    reading = "Histórico insuficiente para concluir sazonalidade (mínimo 2 anos com compras).";
  } else if (hasSeasonality) {
    reading = `Compra concentrada em ${top.monthName} (receita ${top.totalRevenue.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}). ${activeMonthsCount} mês(es) calendário com movimento.`;
  } else {
    reading = `Compras distribuídas em ${activeMonthsCount} mês(es); sem sazonalidade marcante. Mês mais forte: ${top.monthName}.`;
  }

  return {
    strongestMonth,
    weakestMonth,
    activeMonthsCount,
    hasSeasonality,
    reading,
    peakMonths,
    lowMonths,
  };
}
