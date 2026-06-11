import { NomusNfeBillingClassification, Prisma } from "@prisma/client";
import {
  buildAccumulatedSeriesPoints,
  buildChartSeriesConfig,
  buildCumulativeFromMonthlySeries,
  buildMonthlySeriesPoints,
} from "@/src/lib/executiveDashboardChartSeries.js";
import {
  buildBillingMultiYearMonthlyPoints,
  buildBillingMultiYearSummaries,
} from "@/src/lib/financeBillingChartData.js";
import { resolveFinanceBillingComparisonYears } from "@/src/lib/financeBillingChartTheme.js";
import type { FinanceBillingDateBase } from "@/src/lib/financeBillingSourceTypes.js";
import type { ExecutiveDashboardYearContext } from "@/src/lib/executiveDashboardYear.js";
import { prisma } from "@/src/lib/prisma.js";
import {
  decimalToNumber,
  endOfMonth,
  safeMetricNumber,
  startOfMonth,
} from "@/src/lib/executiveDashboardHelpers.js";
import {
  formatExecutiveCompactCurrency,
  formatExecutiveCurrency,
  formatExecutiveInteger,
  formatExecutivePercent,
} from "@/src/lib/executiveDashboardFormatters.js";
import {
  countWorkdaysElapsedInYear,
  countWorkdaysInMonth,
  countWorkdaysInYear,
  endOfYear,
  startOfYear,
} from "@/src/lib/executiveDashboardWorkdays.js";
import {
  computeAchievementPercent,
  computeGrowthTarget,
  computeMonthProjection,
  computeTargetGap,
  computeTicketAverage,
  computeYearProjection,
  computeYtdDailyAverageByWorkday,
  EXECUTIVE_BILLING_YTD_DAILY_AVERAGE_HINT,
} from "@/src/lib/salesOrderDashboardRules.js";
import { buildBillingForecastBlock } from "@/src/lib/financeBillingForecast.js";
import { NOMUS_NFE_STATUS_AUTHORIZED } from "@/src/lib/nomusNfeClassification.js";
import type {
  BillingDashboardTab,
  BillingProjectionBlock,
  BillingRealizedVsProjected,
  BillingTopCustomerRow,
  BillingYearComparison,
  DashboardCumulativeChartPoint,
  DashboardMetricCard,
  DashboardTargetBlock,
  RecentInvoicedOrderRow,
} from "@/src/lib/executiveDashboardTypes.js";

const RECENT_NFE_LIMIT = 15;
const TOP_CUSTOMERS_LIMIT = 10;

export const FISCAL_NFE_BILLING_NOTE =
  "Faturamento fiscal NF-e: status 4 (Autorizada), venda de mercado, classificação MARKET_REVENUE, valor líquido da NF-e. Alinhado ao BI fiscal.";

function nfeCompetenceDateSql(dateBase: FinanceBillingDateBase): Prisma.Sql {
  if (dateBase === "processamento") {
    return Prisma.sql`COALESCE("dataProcessamento", "xmlDhEmi")`;
  }
  return Prisma.sql`COALESCE("xmlDhEmi", "dataProcessamento")`;
}

function fiscalNfeWhereSql(dateBase: FinanceBillingDateBase): Prisma.Sql {
  return Prisma.sql`
    "status" = ${NOMUS_NFE_STATUS_AUTHORIZED}
    AND "isMarketSale" = true
    AND "billingClassification" = ${NomusNfeBillingClassification.MARKET_REVENUE}::"NomusNfeBillingClassification"
    AND ${nfeCompetenceDateSql(dateBase)} IS NOT NULL
    AND "valorLiquido" IS NOT NULL
  `;
}

function metricCard(
  id: string,
  label: string,
  value: number | null,
  opts?: { hint?: string; asCurrency?: boolean; compact?: boolean; asPercent?: boolean }
): DashboardMetricCard {
  return {
    id,
    label,
    value,
    formatted: opts?.asPercent
      ? formatExecutivePercent(value, 1)
      : opts?.asCurrency
        ? formatExecutiveCurrency(value)
        : formatExecutiveInteger(value),
    compactFormatted:
      opts?.compact && opts?.asCurrency ? formatExecutiveCompactCurrency(value) : undefined,
    hint: opts?.hint,
  };
}

function buildTargetBlock(actual: number | null, previousPeriod: number | null): DashboardTargetBlock {
  const target = computeGrowthTarget(previousPeriod);
  const gap = computeTargetGap(actual, target);
  const achievementPercent = computeAchievementPercent(actual, target);
  return {
    actual,
    previousPeriod,
    target,
    gap,
    achievementPercent,
    formatted: {
      actual: formatExecutiveCurrency(actual),
      previousPeriod: formatExecutiveCurrency(previousPeriod),
      target: formatExecutiveCurrency(target),
      gap: formatExecutiveCurrency(gap),
      achievementPercent: formatExecutivePercent(achievementPercent, 1),
    },
  };
}

export async function queryFiscalNfeInPeriod(
  from: Date,
  to: Date,
  dateBase: FinanceBillingDateBase = "emissao"
): Promise<{ count: number | null; net: number | null }> {
  const dateExpr = nfeCompetenceDateSql(dateBase);
  const [row] = await prisma.$queryRaw<{ c: bigint; v: unknown }[]>(
    Prisma.sql`
      SELECT COUNT(*)::bigint AS c, COALESCE(SUM("valorLiquido"), 0) AS v
      FROM "NomusNfe"
      WHERE ${fiscalNfeWhereSql(dateBase)}
        AND ${dateExpr} >= ${from}
        AND ${dateExpr} <= ${to}
    `
  );
  return { count: safeMetricNumber(Number(row?.c ?? 0n)), net: decimalToNumber(row?.v) };
}

export async function queryMonthlyFiscalNfe(
  year: number,
  dateBase: FinanceBillingDateBase = "emissao"
): Promise<Map<number, number>> {
  const from = startOfYear(new Date(year, 0, 1));
  const to = endOfYear(new Date(year, 0, 1));
  const dateExpr = nfeCompetenceDateSql(dateBase);
  const rows = await prisma.$queryRaw<{ month: number; total: unknown }[]>(
    Prisma.sql`
      SELECT
        EXTRACT(MONTH FROM ${dateExpr})::int AS month,
        COALESCE(SUM("valorLiquido"), 0) AS total
      FROM "NomusNfe"
      WHERE ${fiscalNfeWhereSql(dateBase)}
        AND ${dateExpr} >= ${from}
        AND ${dateExpr} <= ${to}
      GROUP BY 1
      ORDER BY 1
    `
  );
  const map = new Map<number, number>();
  for (const row of rows) {
    map.set(row.month, decimalToNumber(row.total) ?? 0);
  }
  return map;
}

async function queryRecentFiscalNfes(
  dateBase: FinanceBillingDateBase
): Promise<RecentInvoicedOrderRow[]> {
  const dateExpr = nfeCompetenceDateSql(dateBase);
  const rows = await prisma.$queryRaw<
    {
      id: string;
      numero: string | null;
      dest: string | null;
      competence: Date;
      valor: unknown;
      status: number | null;
    }[]
  >(
    Prisma.sql`
      SELECT
        id,
        numero,
        "xmlDestCnpjCpf" AS dest,
        ${dateExpr} AS competence,
        "valorLiquido" AS valor,
        status
      FROM "NomusNfe"
      WHERE ${fiscalNfeWhereSql(dateBase)}
      ORDER BY ${dateExpr} DESC
      LIMIT ${RECENT_NFE_LIMIT}
    `
  );
  return rows.map((row) => ({
    orderId: row.id,
    orderCode: row.numero ? `NF ${row.numero}` : row.id.slice(0, 8),
    customerName: row.dest ?? "—",
    invoiceDate: row.competence.toISOString(),
    totalNetValue: decimalToNumber(row.valor),
    invoiceStatus: row.status != null ? String(row.status) : null,
  }));
}

async function queryTopFiscalNfeCustomers(
  from: Date,
  to: Date,
  dateBase: FinanceBillingDateBase
): Promise<BillingTopCustomerRow[]> {
  const dateExpr = nfeCompetenceDateSql(dateBase);
  const rows = await prisma.$queryRaw<
    { customer_id: string; customer_name: string; order_count: bigint; total: unknown }[]
  >(
    Prisma.sql`
      SELECT
        COALESCE("xmlDestCnpjCpf", '—') AS customer_id,
        COALESCE("xmlDestCnpjCpf", '—') AS customer_name,
        COUNT(*)::bigint AS order_count,
        COALESCE(SUM("valorLiquido"), 0) AS total
      FROM "NomusNfe"
      WHERE ${fiscalNfeWhereSql(dateBase)}
        AND ${dateExpr} >= ${from}
        AND ${dateExpr} <= ${to}
      GROUP BY 1, 2
      ORDER BY total DESC
      LIMIT ${TOP_CUSTOMERS_LIMIT}
    `
  );
  return rows.map((row) => ({
    customerId: row.customer_id,
    customerName: row.customer_name,
    orderCount: Number(row.order_count),
    totalNetValue: decimalToNumber(row.total),
  }));
}

function toCumulativeBillingPoints(
  series: ReturnType<typeof buildMonthlySeriesPoints>
): DashboardCumulativeChartPoint[] {
  const cumulative = buildCumulativeFromMonthlySeries(series);
  return cumulative.map((row) => ({
    month: row.month,
    label: row.periodLabel,
    currentYear: row.currentYearValue,
    previousYear: row.previousYearValue,
    twoYearsAgo: null,
  }));
}

export async function buildBillingDashboardFromNfes(
  yearCtx: ExecutiveDashboardYearContext,
  dateBase: FinanceBillingDateBase = "emissao"
): Promise<BillingDashboardTab> {
  const ref = yearCtx.referenceDate;
  const year = yearCtx.selectedYear;
  const monthStart = startOfMonth(ref);
  const monthEnd = endOfMonth(ref);
  const yearStart = startOfYear(ref);
  const yearEnd = endOfYear(ref);
  const prevYearSameMonthStart = startOfMonth(new Date(yearCtx.previousYear, ref.getMonth(), 1));
  const prevYearSameMonthEnd = endOfMonth(new Date(yearCtx.previousYear, ref.getMonth(), 1));
  const prevYearStart = startOfYear(new Date(yearCtx.previousYear, 0, 1));
  const prevYearEnd = endOfYear(new Date(yearCtx.previousYear, 0, 1));
  const ytdPrevEnd = new Date(
    yearCtx.previousYear,
    ref.getMonth(),
    ref.getDate(),
    23,
    59,
    59,
    999
  );

  const comparisonYears = resolveFinanceBillingComparisonYears(year, 3);
  const extraYears = comparisonYears.filter((y) => y !== year && y !== yearCtx.previousYear);

  const [
    monthAgg,
    yearAgg,
    prevMonthAgg,
    prevYearTotalAgg,
    ytdCurrentAgg,
    ytdPreviousAgg,
    currentYearMonthly,
    previousYearMonthly,
    recentInvoiced,
    topCustomers,
    ...extraYearMonthlies
  ] = await Promise.all([
    queryFiscalNfeInPeriod(monthStart, monthEnd, dateBase),
    queryFiscalNfeInPeriod(yearStart, yearEnd, dateBase),
    queryFiscalNfeInPeriod(prevYearSameMonthStart, prevYearSameMonthEnd, dateBase),
    queryFiscalNfeInPeriod(prevYearStart, prevYearEnd, dateBase),
    queryFiscalNfeInPeriod(yearStart, ref, dateBase),
    queryFiscalNfeInPeriod(prevYearStart, ytdPrevEnd, dateBase),
    queryMonthlyFiscalNfe(year, dateBase),
    queryMonthlyFiscalNfe(yearCtx.previousYear, dateBase),
    queryRecentFiscalNfes(dateBase),
    queryTopFiscalNfeCustomers(yearStart, yearEnd, dateBase),
    ...extraYears.map((y) => queryMonthlyFiscalNfe(y, dateBase)),
  ]);

  const yearMaps = new Map<number, Map<number, number>>();
  yearMaps.set(year, currentYearMonthly);
  yearMaps.set(yearCtx.previousYear, previousYearMonthly);
  extraYears.forEach((y, idx) => {
    yearMaps.set(y, extraYearMonthlies[idx] ?? new Map());
  });

  const ticketAvg = computeTicketAverage(monthAgg.net, monthAgg.count);
  const yearWorkdaysElapsed = countWorkdaysElapsedInYear(ref);
  const workdaysInMonth = countWorkdaysInMonth(year, ref.getMonth());
  const workdaysInYear = countWorkdaysInYear(year);
  const dailyAvgYtd = computeYtdDailyAverageByWorkday(ytdCurrentAgg.net, yearWorkdaysElapsed);
  const projectedMonth = computeMonthProjection(dailyAvgYtd, workdaysInMonth);
  const projectedYear = computeYearProjection(dailyAvgYtd, workdaysInYear);
  const target = buildTargetBlock(monthAgg.net, prevMonthAgg.net);
  const annualTarget = computeGrowthTarget(prevYearTotalAgg.net);

  const projection: BillingProjectionBlock = {
    dailyAverage: dailyAvgYtd,
    projectedMonth,
    projectedYear,
    workdaysElapsed: yearWorkdaysElapsed,
    workdaysInMonth,
    workdaysInYear,
    ytdDailyAverageHint: EXECUTIVE_BILLING_YTD_DAILY_AVERAGE_HINT,
    formatted: {
      dailyAverage: formatExecutiveCurrency(dailyAvgYtd),
      projectedMonth: formatExecutiveCurrency(projectedMonth),
      projectedYear: formatExecutiveCurrency(projectedYear),
    },
  };

  const yearComparison: BillingYearComparison = {
    yearToDateCurrent: ytdCurrentAgg.net,
    yearToDatePrevious: ytdPreviousAgg.net,
    previousYearTotal: prevYearTotalAgg.net,
    annualTarget,
    formatted: {
      yearToDateCurrent: formatExecutiveCurrency(ytdCurrentAgg.net),
      yearToDatePrevious: formatExecutiveCurrency(ytdPreviousAgg.net),
      previousYearTotal: formatExecutiveCurrency(prevYearTotalAgg.net),
      annualTarget: formatExecutiveCurrency(annualTarget),
    },
  };

  const realizedVsProjected: BillingRealizedVsProjected = {
    realized: monthAgg.net,
    projected: projectedMonth,
    target: target.target,
    formatted: {
      realized: formatExecutiveCurrency(monthAgg.net),
      projected: formatExecutiveCurrency(projectedMonth),
      target: formatExecutiveCurrency(target.target),
    },
  };

  const dateBaseLabel = dateBase === "emissao" ? "data fiscal/emissão" : "data processamento";

  const summaryCards: DashboardMetricCard[] = [
    metricCard("billing-month", "Mês atual — NF-e fiscal", monthAgg.net, {
      asCurrency: true,
      compact: true,
      hint: dateBaseLabel,
    }),
    metricCard("billing-prev-month", "Mesmo mês ano anterior", prevMonthAgg.net, {
      asCurrency: true,
      compact: true,
    }),
    metricCard("billing-year", `Faturamento ${year} — NF-e`, yearAgg.net, {
      asCurrency: true,
      compact: true,
    }),
    metricCard("billing-daily-avg", "Média faturamento/dia útil YTD", dailyAvgYtd, {
      asCurrency: true,
      hint: EXECUTIVE_BILLING_YTD_DAILY_AVERAGE_HINT,
    }),
    metricCard("billing-projected", "Projeção do mês (YTD)", projectedMonth, {
      asCurrency: true,
      compact: true,
      hint: `Média YTD × ${workdaysInMonth} dias úteis no mês`,
    }),
    metricCard("billing-target", "Meta do mês (+30%)", target.target, { asCurrency: true, compact: true }),
    metricCard("billing-achievement", "% atingimento meta", target.achievementPercent, { asPercent: true }),
    metricCard("billing-gap", "Diferença p/ meta", target.gap, { asCurrency: true, compact: true }),
    metricCard("billing-count-month", "NF-e autorizadas no mês", monthAgg.count),
    metricCard("billing-ticket", "Ticket médio NF-e", ticketAvg, { asCurrency: true }),
  ];

  const monthlySeries = buildMonthlySeriesPoints(
    yearCtx,
    currentYearMonthly,
    previousYearMonthly,
    { projectedMonthValue: projectedMonth, projectionMonth: yearCtx.ytdMonthLimit }
  );

  const accumulatedEvolution = buildAccumulatedSeriesPoints(yearCtx, monthlySeries, {
    dailyAverageYtd: dailyAvgYtd,
  });

  const multiYearMonthly = buildBillingMultiYearMonthlyPoints(
    year,
    yearMaps,
    yearCtx.ytdMonthLimit,
    yearCtx.isSelectedYearCurrent
  );

  const multiYearSummary = buildBillingMultiYearSummaries(
    year,
    yearMaps,
    yearCtx.ytdMonthLimit,
    yearCtx.isSelectedYearCurrent
  );

  const forecast = await buildBillingForecastBlock(yearCtx, currentYearMonthly);

  return {
    available: true,
    source: `NomusNfe.valorLiquido · status ${NOMUS_NFE_STATUS_AUTHORIZED} · mercado · ${dateBaseLabel}`,
    periodLabel: ref.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }),
    yearLabel: year,
    summaryCards,
    target,
    projection,
    yearComparison,
    realizedVsProjected,
    monthlySeries,
    chartSeries: buildChartSeriesConfig("billing", yearCtx),
    cumulativeBilling: toCumulativeBillingPoints(monthlySeries),
    accumulatedEvolution,
    multiYearMonthly,
    multiYearSummary,
    recentInvoicedOrders: recentInvoiced,
    topCustomers,
    intercompanyExclusionApplied: true,
    marketBillingNote: FISCAL_NFE_BILLING_NOTE,
    forecast,
  };
}
