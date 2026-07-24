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

/**
 * Extrai xNome do destinatário no XML da NF-e (PostgreSQL ARE).
 * Usa `.*?` + flag `s` (`.` casa newline). Não usar `\s`/`\S` — PG rejeita (2201B).
 */
const NFE_XML_DEST_XNOME_REGEXP = "<dest[^>]*>.*?<xNome>([^<]+)</xNome>";

export const FISCAL_NFE_BILLING_NOTE =
  "Faturamento fiscal NF-e: status 4 (Autorizada), venda de mercado, classificação MARKET_REVENUE, valor líquido da NF-e. Alinhado ao BI fiscal.";

function nfeXmlDestNameSql(xmlExpr: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`NULLIF(TRIM((regexp_match(COALESCE(${xmlExpr}, ''), ${NFE_XML_DEST_XNOME_REGEXP}, 'is'))[1]), '')`;
}
/** Data de competência oficial do faturamento NF-e (exportada para motores derivados, ex.: DRE). */
export function nfeCompetenceDateSql(dateBase: FinanceBillingDateBase, alias = ""): Prisma.Sql {
  const prefix = alias ? `${alias}.` : "";
  if (dateBase === "processamento") {
    return Prisma.sql`COALESCE(${Prisma.raw(`${prefix}"dataProcessamento"`)}, ${Prisma.raw(`${prefix}"xmlDhEmi"`)})`;
  }
  return Prisma.sql`COALESCE(${Prisma.raw(`${prefix}"xmlDhEmi"`)}, ${Prisma.raw(`${prefix}"dataProcessamento"`)})`;
}

/** Predicado oficial MARKET_REVENUE autorizado (exportado para motores derivados, ex.: DRE). */
export function fiscalNfeWhereSql(
  dateBase: FinanceBillingDateBase,
  emitterCnpjDigits?: string,
  alias = ""
): Prisma.Sql {
  const prefix = alias ? `${alias}.` : "";
  const col = (name: string) => Prisma.raw(`${prefix}"${name}"`);
  const emitterFilter =
    emitterCnpjDigits && emitterCnpjDigits.length > 0
      ? Prisma.sql`AND regexp_replace(COALESCE(${col("cnpjEmitente")}, ''), '[^0-9]', '', 'g') = ${emitterCnpjDigits}`
      : Prisma.empty;
  return Prisma.sql`
    ${col("status")} = ${NOMUS_NFE_STATUS_AUTHORIZED}
    AND ${col("isMarketSale")} = true
    AND ${col("billingClassification")} = ${NomusNfeBillingClassification.MARKET_REVENUE}::"NomusNfeBillingClassification"
    AND ${nfeCompetenceDateSql(dateBase, alias)} IS NOT NULL
    AND ${col("valorLiquido")} IS NOT NULL
    ${emitterFilter}
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
  dateBase: FinanceBillingDateBase = "emissao",
  emitterCnpjDigits?: string
): Promise<{ count: number | null; net: number | null }> {
  const dateExpr = nfeCompetenceDateSql(dateBase);
  const [row] = await prisma.$queryRaw<{ c: bigint; v: unknown }[]>(
    Prisma.sql`
      SELECT COUNT(*)::bigint AS c, COALESCE(SUM("valorLiquido"), 0) AS v
      FROM "NomusNfe"
      WHERE ${fiscalNfeWhereSql(dateBase, emitterCnpjDigits)}
        AND ${dateExpr} >= ${from}
        AND ${dateExpr} <= ${to}
    `
  );
  return { count: safeMetricNumber(Number(row?.c ?? 0n)), net: decimalToNumber(row?.v) };
}

export async function queryMonthlyFiscalNfe(
  year: number,
  dateBase: FinanceBillingDateBase = "emissao",
  emitterCnpjDigits?: string
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
      WHERE ${fiscalNfeWhereSql(dateBase, emitterCnpjDigits)}
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
  dateBase: FinanceBillingDateBase,
  emitterCnpjDigits?: string
): Promise<RecentInvoicedOrderRow[]> {
  const dateExpr = nfeCompetenceDateSql(dateBase, "n");
  const rows = await prisma.$queryRaw<
    {
      id: string;
      numero: string | null;
      dest_doc: string | null;
      dest_name: string | null;
      competence: Date;
      valor: unknown;
      status: number | null;
    }[]
  >(
    Prisma.sql`
      SELECT
        n.id,
        n.numero,
        n."xmlDestCnpjCpf" AS dest_doc,
        COALESCE(
          NULLIF(TRIM(c."tradeName"), ''),
          NULLIF(TRIM(c."companyName"), ''),
          ${nfeXmlDestNameSql(Prisma.sql`n."xmlRaw"`)},
          n."xmlDestCnpjCpf"
        ) AS dest_name,
        ${dateExpr} AS competence,
        n."valorLiquido" AS valor,
        n.status
      FROM "NomusNfe" n
      LEFT JOIN "Customer" c
        ON regexp_replace(COALESCE(c."taxId", ''), '[^0-9]', '', 'g')
         = regexp_replace(COALESCE(n."xmlDestCnpjCpf", ''), '[^0-9]', '', 'g')
      WHERE ${fiscalNfeWhereSql(dateBase, emitterCnpjDigits, "n")}
      ORDER BY ${dateExpr} DESC
      LIMIT ${RECENT_NFE_LIMIT}
    `
  );
  return rows.map((row) => ({
    orderId: row.id,
    orderCode: row.numero ? `NF ${row.numero}` : row.id.slice(0, 8),
    customerName: row.dest_name?.trim() || row.dest_doc || "—",
    invoiceDate: row.competence.toISOString(),
    totalNetValue: decimalToNumber(row.valor),
    invoiceStatus: row.status != null ? String(row.status) : null,
  }));
}

async function queryTopFiscalNfeCustomers(
  from: Date,
  to: Date,
  dateBase: FinanceBillingDateBase,
  emitterCnpjDigits?: string
): Promise<BillingTopCustomerRow[]> {
  const dateExpr = nfeCompetenceDateSql(dateBase, "n");
  const rows = await prisma.$queryRaw<
    { customer_id: string; customer_name: string; order_count: bigint; total: unknown }[]
  >(
    Prisma.sql`
      SELECT
        COALESCE(
          NULLIF(regexp_replace(COALESCE(n."xmlDestCnpjCpf", ''), '[^0-9]', '', 'g'), ''),
          '—'
        ) AS customer_id,
        COALESCE(
          MAX(NULLIF(TRIM(c."tradeName"), '')),
          MAX(NULLIF(TRIM(c."companyName"), '')),
          MAX(${nfeXmlDestNameSql(Prisma.sql`n."xmlRaw"`)}),
          MAX(n."xmlDestCnpjCpf"),
          '—'
        ) AS customer_name,
        COUNT(*)::bigint AS order_count,
        COALESCE(SUM(n."valorLiquido"), 0) AS total
      FROM "NomusNfe" n
      LEFT JOIN "Customer" c
        ON regexp_replace(COALESCE(c."taxId", ''), '[^0-9]', '', 'g')
         = regexp_replace(COALESCE(n."xmlDestCnpjCpf", ''), '[^0-9]', '', 'g')
      WHERE ${fiscalNfeWhereSql(dateBase, emitterCnpjDigits, "n")}
        AND ${dateExpr} >= ${from}
        AND ${dateExpr} <= ${to}
      GROUP BY 1
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

export type BillingDashboardNfeOptions = {
  /** CNPJ emitente (somente dígitos) — filtra NF-e por empresa do grupo. */
  emitterCnpjDigits?: string;
};

export async function buildBillingDashboardFromNfes(
  yearCtx: ExecutiveDashboardYearContext,
  dateBase: FinanceBillingDateBase = "emissao",
  options: BillingDashboardNfeOptions = {}
): Promise<BillingDashboardTab> {
  const emitterCnpjDigits = options.emitterCnpjDigits?.replace(/\D/g, "") || undefined;
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

  /** Forecast (SalesOrder) começa assim que o mensal do ano estiver pronto, em paralelo com o restante. */
  const currentYearMonthlyPromise = queryMonthlyFiscalNfe(year, dateBase, emitterCnpjDigits);
  const forecastPromise = currentYearMonthlyPromise.then((monthly) =>
    buildBillingForecastBlock(yearCtx, monthly)
  );

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
    forecast,
    ...extraYearMonthlies
  ] = await Promise.all([
    queryFiscalNfeInPeriod(monthStart, monthEnd, dateBase, emitterCnpjDigits),
    queryFiscalNfeInPeriod(yearStart, yearEnd, dateBase, emitterCnpjDigits),
    queryFiscalNfeInPeriod(prevYearSameMonthStart, prevYearSameMonthEnd, dateBase, emitterCnpjDigits),
    queryFiscalNfeInPeriod(prevYearStart, prevYearEnd, dateBase, emitterCnpjDigits),
    queryFiscalNfeInPeriod(yearStart, ref, dateBase, emitterCnpjDigits),
    queryFiscalNfeInPeriod(prevYearStart, ytdPrevEnd, dateBase, emitterCnpjDigits),
    currentYearMonthlyPromise,
    queryMonthlyFiscalNfe(yearCtx.previousYear, dateBase, emitterCnpjDigits),
    queryRecentFiscalNfes(dateBase, emitterCnpjDigits),
    queryTopFiscalNfeCustomers(yearStart, yearEnd, dateBase, emitterCnpjDigits),
    forecastPromise,
    ...extraYears.map((y) => queryMonthlyFiscalNfe(y, dateBase, emitterCnpjDigits)),
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
