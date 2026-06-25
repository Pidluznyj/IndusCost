import { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";
import {
  decimalToNumber,
  safeMetricNumber,
  startOfMonth,
  endOfMonth,
} from "./executiveDashboardHelpers.js";
import {
  endOfYear,
  startOfYear,
} from "./executiveDashboardWorkdays.js";
import { getSalesOrderNetValue } from "./crmCommercialOrderRules.js";
import { computeTicketAverage } from "./salesOrderDashboardRules.js";
import {
  orderIsInvoicedSql,
  orderNotInvoicedSql,
  toPgDateYmd,
} from "./salesOrderInvoicingSql.js";
import { buildSalesOrdersDashboardTab } from "./salesOrdersDashboardMetrics.js";
import {
  parseExecutiveDashboardYear,
  resolveExecutiveDashboardYearContext,
  type ExecutiveDashboardYearContext,
} from "./executiveDashboardYear.js";
import { buildSalesOrderListWhere } from "./salesOrdersListSummary.js";
import {
  buildExtendedMetricsFromOrders,
  mapPrismaOrderToDashboardRow,
  OPEN_PORTFOLIO_EVOLUTION_NOTE,
} from "./financeSalesOrdersExtendedMetrics.js";
import { loadSalesOrderLinkedNfeContextMap } from "./salesOrderLinkedNfe.js";
import { aggregateSalesOrderMarginSummaries } from "./salesOrderMarginDisplay.js";
import { calculateSalesOrderMarginsForOrders } from "./salesOrderMarginService.server.js";
import {
  isBiLogisticStatusCardId,
  type BiLogisticStatusCardId,
} from "./salesOrderLogisticStatus.js";
import type {
  FinanceSalesOrdersDashboardFilters,
  FinanceSalesOrdersDashboardPayload,
  FinanceSalesOrdersDashboardSummary,
  FinanceSalesOrdersInvoiceStatus,
  FinanceSalesOrdersMonthlyComparisonRow,
  FinanceSalesOrdersRealizedProjectedRow,
  FinanceSalesOrdersTopCustomerRow,
} from "./financeSalesOrdersDashboardTypes.js";
import {
  FINANCE_SALES_ORDERS_CALCULATION_RULES,
  FINANCE_SALES_ORDERS_MONTH_LABELS,
} from "./financeSalesOrdersDashboardTypes.js";

export { getSalesOrderNetValue as resolveSalesOrderNetAmount };

const VALID_METRICS_WHERE = Prisma.sql`so.status NOT IN ('CANCELLED', 'ERROR')`;

function parseMonthParam(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 12) return null;
  return n;
}

function parseInvoiceStatus(value: unknown): FinanceSalesOrdersInvoiceStatus {
  const v = String(value ?? "").trim();
  if (v === "with_invoice" || v === "without_invoice") return v;
  return "all";
}

function parseLogisticStatus(value: unknown): BiLogisticStatusCardId | null {
  const v = String(value ?? "").trim();
  return isBiLogisticStatusCardId(v) ? v : null;
}

export function parseFinanceSalesOrdersFilters(
  query: Record<string, unknown>,
  now = new Date()
): FinanceSalesOrdersDashboardFilters {
  return {
    year: parseExecutiveDashboardYear(query.year, now),
    month: parseMonthParam(query.month),
    company: typeof query.company === "string" ? query.company.trim() || null : null,
    customerId: typeof query.customerId === "string" ? query.customerId.trim() || null : null,
    customerSearch:
      typeof query.customerSearch === "string" ? query.customerSearch.trim() || null : null,
    sellerName: typeof query.sellerName === "string" ? query.sellerName.trim() || null : null,
    status: typeof query.status === "string" ? query.status.trim() || null : null,
    invoiceStatus: parseInvoiceStatus(query.invoiceStatus),
    logisticStatus: parseLogisticStatus(query.logisticStatus),
  };
}

export function resolveFinanceSalesOrdersYearContext(
  filters: FinanceSalesOrdersDashboardFilters,
  now = new Date()
): ExecutiveDashboardYearContext {
  const base = resolveExecutiveDashboardYearContext(filters.year, now);
  if (filters.month == null) return base;

  const month = filters.month;
  const isCurrentMonthYear =
    base.selectedYear === now.getFullYear() && month === now.getMonth() + 1;
  const referenceDate = isCurrentMonthYear
    ? now
    : new Date(base.selectedYear, month, 0, 23, 59, 59, 999);

  return {
    ...base,
    referenceDate,
    ytdMonthLimit: month,
    isSelectedYearCurrent: base.selectedYear === now.getFullYear(),
  };
}

function hasExtraDashboardFilters(filters: FinanceSalesOrdersDashboardFilters): boolean {
  return Boolean(
    filters.month ||
      filters.company ||
      filters.customerId ||
      filters.customerSearch ||
      filters.sellerName ||
      filters.status ||
      filters.invoiceStatus !== "all" ||
      filters.logisticStatus
  );
}

export function resolveFinanceSalesOrdersPeriodBounds(
  filters: FinanceSalesOrdersDashboardFilters
): { from: Date; to: Date } {
  if (filters.month != null) {
    const anchor = new Date(filters.year, filters.month - 1, 1);
    return { from: startOfMonth(anchor), to: endOfMonth(anchor) };
  }
  const anchor = new Date(filters.year, 0, 1);
  return { from: startOfYear(anchor), to: endOfYear(anchor) };
}

function buildPrismaPeriodWhere(
  filters: FinanceSalesOrdersDashboardFilters,
  from: Date,
  to: Date
): Prisma.SalesOrderWhereInput {
  return {
    status: { notIn: ["CANCELLED", "ERROR"] },
    issueDate: { gte: from, lte: to },
    ...buildSalesOrderListWhere({
      status: filters.status ?? undefined,
      customerId: filters.customerId ?? undefined,
      responsible: filters.sellerName ?? undefined,
    }),
    ...(filters.company
      ? { companyIssuer: { contains: filters.company, mode: "insensitive" } }
      : {}),
    ...(filters.customerSearch
      ? {
          Customer: {
            OR: [
              { companyName: { contains: filters.customerSearch, mode: "insensitive" } },
              { tradeName: { contains: filters.customerSearch, mode: "insensitive" } },
            ],
          },
        }
      : {}),
  };
}

function buildSqlFilterFragments(filters: FinanceSalesOrdersDashboardFilters): Prisma.Sql[] {
  const parts: Prisma.Sql[] = [VALID_METRICS_WHERE];
  if (filters.status) {
    parts.push(Prisma.sql`so.status::text = ${filters.status}`);
  }
  if (filters.customerId) {
    parts.push(Prisma.sql`so."customerId" = ${filters.customerId}`);
  }
  if (filters.sellerName) {
    parts.push(Prisma.sql`so.responsible ILIKE ${`%${filters.sellerName}%`}`);
  }
  if (filters.company) {
    parts.push(Prisma.sql`so."companyIssuer" ILIKE ${`%${filters.company}%`}`);
  }
  if (filters.customerSearch) {
    const term = `%${filters.customerSearch}%`;
    parts.push(
      Prisma.sql`(
        c."companyName" ILIKE ${term}
        OR c."tradeName" ILIKE ${term}
      )`
    );
  }
  if (filters.invoiceStatus === "with_invoice") {
    parts.push(orderIsInvoicedSql("so"));
  } else if (filters.invoiceStatus === "without_invoice") {
    parts.push(orderNotInvoicedSql("so"));
  }
  return parts;
}

function sqlAnd(parts: Prisma.Sql[]): Prisma.Sql {
  if (parts.length === 0) return Prisma.sql`TRUE`;
  return Prisma.join(parts, " AND ");
}

async function aggregateFiltered(
  filters: FinanceSalesOrdersDashboardFilters,
  from: Date,
  to: Date
): Promise<{ count: number; net: number; items: number }> {
  const where = buildPrismaPeriodWhere(filters, from, to);
  const agg = await prisma.salesOrder.aggregate({
    where,
    _count: true,
    _sum: { totalNetValue: true, totalItems: true },
  });
  return {
    count: safeMetricNumber(agg._count) ?? 0,
    net: decimalToNumber(agg._sum.totalNetValue) ?? 0,
    items: safeMetricNumber(decimalToNumber(agg._sum.totalItems)) ?? 0,
  };
}

async function queryMonthlyFiltered(
  filters: FinanceSalesOrdersDashboardFilters,
  year: number
): Promise<Map<number, number>> {
  const from = startOfYear(new Date(year, 0, 1));
  const to = endOfYear(new Date(year, 0, 1));
  const extra = buildSqlFilterFragments(filters);
  const needsJoin = Boolean(filters.customerSearch);
  const rows = await prisma.$queryRaw<{ month: number; total: unknown }[]>(
  needsJoin
    ? Prisma.sql`
        SELECT EXTRACT(MONTH FROM so."issueDate")::int AS month,
               COALESCE(SUM(so."totalNetValue"), 0) AS total
        FROM "SalesOrder" so
        INNER JOIN "Customer" c ON c.id = so."customerId"
        WHERE so."issueDate" >= ${from} AND so."issueDate" <= ${to}
          AND ${sqlAnd(extra)}
        GROUP BY 1 ORDER BY 1
      `
    : Prisma.sql`
        SELECT EXTRACT(MONTH FROM so."issueDate")::int AS month,
               COALESCE(SUM(so."totalNetValue"), 0) AS total
        FROM "SalesOrder" so
        WHERE so."issueDate" >= ${from} AND so."issueDate" <= ${to}
          AND ${sqlAnd(extra)}
        GROUP BY 1 ORDER BY 1
      `
  );
  const map = new Map<number, number>();
  for (const row of rows) map.set(row.month, decimalToNumber(row.total) ?? 0);
  return map;
}

async function queryPortfolioFiltered(
  filters: FinanceSalesOrdersDashboardFilters,
  year: number,
  today: Date
): Promise<{
  open: { count: number; net: number };
  invoiced: { count: number; net: number };
  overdue: { count: number; net: number };
}> {
  const yearStart = startOfYear(new Date(year, 0, 1));
  const yearEnd = endOfYear(new Date(year, 0, 1));
  const todayYmd = toPgDateYmd(today);
  const extra = buildSqlFilterFragments(filters);
  const join = filters.customerSearch
    ? Prisma.sql`INNER JOIN "Customer" c ON c.id = so."customerId"`
    : Prisma.empty;

  const [openRow] = await prisma.$queryRaw<{ c: bigint; v: unknown }[]>(
    Prisma.sql`
      SELECT COUNT(*)::bigint AS c, COALESCE(SUM(so."totalNetValue"), 0) AS v
      FROM "SalesOrder" so ${join}
      WHERE so."issueDate" >= ${yearStart} AND so."issueDate" <= ${yearEnd}
        AND ${sqlAnd([...extra, orderNotInvoicedSql("so")])}
    `
  );
  const [invoicedRow] = await prisma.$queryRaw<{ c: bigint; v: unknown }[]>(
    Prisma.sql`
      SELECT COUNT(*)::bigint AS c, COALESCE(SUM(so."totalNetValue"), 0) AS v
      FROM "SalesOrder" so ${join}
      WHERE so."issueDate" >= ${yearStart} AND so."issueDate" <= ${yearEnd}
        AND ${sqlAnd([...extra, orderIsInvoicedSql("so")])}
    `
  );
  const [overdueRow] = await prisma.$queryRaw<{ c: bigint; v: unknown }[]>(
    Prisma.sql`
      SELECT COUNT(*)::bigint AS c, COALESCE(SUM(so."totalNetValue"), 0) AS v
      FROM "SalesOrder" so ${join}
      WHERE so."issueDate" >= ${yearStart} AND so."issueDate" <= ${yearEnd}
        AND ${sqlAnd([...extra, orderNotInvoicedSql("so")])}
        AND so."expectedDeliveryDate" IS NOT NULL
        AND so."expectedDeliveryDate"::date < ${todayYmd}::date
    `
  );

  return {
    open: {
      count: Number(openRow?.c ?? 0n),
      net: decimalToNumber(openRow?.v) ?? 0,
    },
    invoiced: {
      count: Number(invoicedRow?.c ?? 0n),
      net: decimalToNumber(invoicedRow?.v) ?? 0,
    },
    overdue: {
      count: Number(overdueRow?.c ?? 0n),
      net: decimalToNumber(overdueRow?.v) ?? 0,
    },
  };
}

async function queryTopCustomersFiltered(
  filters: FinanceSalesOrdersDashboardFilters,
  year: number
): Promise<FinanceSalesOrdersTopCustomerRow[]> {
  const from = startOfYear(new Date(year, 0, 1));
  const to = endOfYear(new Date(year, 0, 1));
  const extra = buildSqlFilterFragments(filters);
  const rows = await prisma.$queryRaw<
    { customer_id: string; customer_name: string; cnt: bigint; total: unknown }[]
  >(
    Prisma.sql`
      SELECT
        c.id AS customer_id,
        COALESCE(NULLIF(TRIM(c."tradeName"), ''), c."companyName") AS customer_name,
        COUNT(*)::bigint AS cnt,
        COALESCE(SUM(so."totalNetValue"), 0) AS total
      FROM "SalesOrder" so
      INNER JOIN "Customer" c ON c.id = so."customerId"
      WHERE so."issueDate" >= ${from} AND so."issueDate" <= ${to}
        AND ${sqlAnd(extra)}
      GROUP BY c.id, customer_name
      ORDER BY total DESC
      LIMIT 10
    `
  );
  const totalAll = rows.reduce((s, r) => s + (decimalToNumber(r.total) ?? 0), 0);
  return rows.map((row) => {
    const amount = decimalToNumber(row.total) ?? 0;
    const orderCount = Number(row.cnt);
    return {
      customerId: row.customer_id,
      customerName: row.customer_name,
      amount,
      orderCount,
      averageTicketAmount: computeTicketAverage(amount, orderCount),
      sharePercent: totalAll > 0 ? (amount / totalAll) * 100 : null,
    };
  });
}

function growthPercent(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous === 0) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

function buildMonthlyComparison(
  currentMap: Map<number, number>,
  previousMap: Map<number, number>
): FinanceSalesOrdersMonthlyComparisonRow[] {
  return FINANCE_SALES_ORDERS_MONTH_LABELS.map((monthLabel, i) => {
    const month = i + 1;
    const currentYearAmount = currentMap.get(month) ?? 0;
    const previousYearAmount = previousMap.get(month) ?? 0;
    return {
      month,
      monthLabel,
      currentYearAmount,
      previousYearAmount,
      differenceAmount: currentYearAmount - previousYearAmount,
      growthPercent: growthPercent(currentYearAmount, previousYearAmount),
    };
  });
}

function buildRealizedProjectedRows(
  tab: Awaited<ReturnType<typeof buildSalesOrdersDashboardTab>>
): FinanceSalesOrdersRealizedProjectedRow[] {
  return tab.monthlySeries.map((point) => ({
    month: point.month,
    monthLabel: point.monthLabel,
    realizedAmount: point.currentYearValue,
    projectedAmount: point.projectedValue,
    targetAmount: point.targetValue,
    previousYearAmount: point.previousYearValue,
  }));
}

function buildSummaryFromTab(
  tab: Awaited<ReturnType<typeof buildSalesOrdersDashboardTab>>,
  filters: FinanceSalesOrdersDashboardFilters,
  periodAgg: { count: number; net: number; items: number },
  portfolio: Awaited<ReturnType<typeof queryPortfolioFiltered>>
): FinanceSalesOrdersDashboardSummary {
  const monthAgg = tab.targets.monthly.actual ?? 0;
  const prevMonth = tab.targets.monthly.previousPeriod ?? 0;
  const ytd = tab.targets.annual.actualYtd ?? 0;
  const prevYtd = tab.targets.annual.previousPeriod ?? 0;
  const projectedMonth = tab.projection.monthlyProjection;
  const projectedYear = tab.projection.annualProjection;
  const monthTargetConfigured = false;

  return {
    selectedYear: filters.year,
    selectedMonth: filters.month,
    totalOrdersAmount: periodAgg.net,
    monthSalesAmount: monthAgg,
    monthSalesPreviousYearAmount: prevMonth,
    monthSalesGrowthAmount: monthAgg - prevMonth,
    monthSalesGrowthPercent: growthPercent(monthAgg, prevMonth),
    ytdSalesAmount: ytd,
    previousYtdSalesAmount: prevYtd,
    ytdGrowthAmount: ytd - prevYtd,
    ytdGrowthPercent: growthPercent(ytd, prevYtd),
    monthTargetAmount: null,
    yearTargetAmount: null,
    monthTargetConfigured,
    monthAchievementPercent: null,
    yearAchievementPercent: null,
    monthProjectedAmount: projectedMonth,
    yearProjectedAmount: projectedYear,
    projectedMonthAchievementPercent: null,
    projectedYearAchievementPercent: null,
    dailyAverageAmount: tab.projection.ytdDailyAverage,
    orderCount: periodAgg.count,
    itemCount: periodAgg.items,
    averageTicketAmount: computeTicketAverage(periodAgg.net, periodAgg.count),
    openPortfolioAmount: portfolio.open.net,
    openPortfolioCount: portfolio.open.count,
    invoicedOrdersAmount: portfolio.invoiced.net,
    invoicedOrdersCount: portfolio.invoiced.count,
    notInvoicedOrdersAmount: portfolio.open.net,
    notInvoicedOrdersCount: portfolio.open.count,
    overdueOpenOrdersAmount: portfolio.overdue.net,
    overdueOpenOrdersCount: portfolio.overdue.count,
  };
}

async function loadDashboardOrders(
  filters: FinanceSalesOrdersDashboardFilters,
  from: Date,
  to: Date
) {
  const where = buildPrismaPeriodWhere(filters, from, to);
  const orders = await prisma.salesOrder.findMany({
    where,
    select: {
      id: true,
      orderCode: true,
      issueDate: true,
      expectedDeliveryDate: true,
      totalNetValue: true,
      responsible: true,
      nomusRawResponse: true,
      updatedAt: true,
      sentToNomusAt: true,
      Customer: {
        select: { id: true, companyName: true, tradeName: true },
      },
    },
    orderBy: { issueDate: "desc" },
  });
  return orders.map(mapPrismaOrderToDashboardRow);
}

async function queryExcludedCounts(): Promise<{
  cancelled: number;
  error: number;
  missingIssueDate: number;
  missingCustomer: number;
}> {
  const fallback = {
    cancelled: 0,
    error: 0,
    missingIssueDate: 0,
    missingCustomer: 0,
  };
  try {
    const [cancelled, error] = await Promise.all([
      prisma.salesOrder.count({ where: { status: "CANCELLED" } }),
      prisma.salesOrder.count({ where: { status: "ERROR" } }),
    ]);
    // issueDate e customerId são NOT NULL em schema.prisma — Prisma não aceita where: { field: null }.
    // Legado com NULL no banco, se existir, não entra neste contador diagnóstico (evita quebra do dashboard).
    return { cancelled, error, missingIssueDate: 0, missingCustomer: 0 };
  } catch (err) {
    console.error("financeSalesOrdersDashboard queryExcludedCounts", err);
    return fallback;
  }
}

export async function buildFinanceSalesOrdersDashboard(
  query: Record<string, unknown> = {},
  now = new Date()
): Promise<FinanceSalesOrdersDashboardPayload> {
  const filters = parseFinanceSalesOrdersFilters(query, now);
  const yearCtx = resolveFinanceSalesOrdersYearContext(filters, now);
  const tab = await buildSalesOrdersDashboardTab(yearCtx);
  const periodBounds = resolveFinanceSalesOrdersPeriodBounds(filters);

  let periodAgg: { count: number; net: number; items: number };
  let currentMonthly: Map<number, number>;
  let previousMonthly: Map<number, number>;
  let portfolio: Awaited<ReturnType<typeof queryPortfolioFiltered>>;
  let topCustomers: FinanceSalesOrdersTopCustomerRow[];

  if (hasExtraDashboardFilters(filters)) {
    periodAgg = await aggregateFiltered(filters, periodBounds.from, periodBounds.to);
    currentMonthly = await queryMonthlyFiltered(filters, filters.year);
    previousMonthly = await queryMonthlyFiltered(filters, filters.year - 1);
  } else {
    periodAgg = await aggregateFiltered(filters, periodBounds.from, periodBounds.to);
    currentMonthly = new Map(
      tab.monthlySeries.map((p) => [p.month, p.currentYearValue ?? 0])
    );
    previousMonthly = new Map(
      tab.monthlySeries.map((p) => [p.month, p.previousYearValue ?? 0])
    );
  }

  portfolio = await queryPortfolioFiltered(filters, filters.year, now);
  topCustomers = await queryTopCustomersFiltered(filters, filters.year);

  const dashboardOrders = await loadDashboardOrders(filters, periodBounds.from, periodBounds.to);
  const marginByOrder = await calculateSalesOrderMarginsForOrders(
    prisma,
    dashboardOrders.map((order) => ({
      id: order.id,
      nomusRawResponse: order.nomusRawResponse,
    }))
  );
  const marginPortfolio = aggregateSalesOrderMarginSummaries(
    [...marginByOrder.values()].map((row) => row.marginSummary)
  );
  const linkedNfeContextMap = await loadSalesOrderLinkedNfeContextMap(
    dashboardOrders.map((order) => ({
      id: order.id,
      totalNetValue: order.totalNetValue,
      issueDate: order.issueDate,
      expectedDeliveryDate: order.expectedDeliveryDate,
      nomusRawResponse: order.nomusRawResponse,
    }))
  );
  const extended = buildExtendedMetricsFromOrders({
    orders: dashboardOrders,
    filters,
    referenceDate: now,
    linkedNfeContextMap,
  });

  const criticalOrders = extended.criticalOrders.map((row) => ({
    ...row,
    marginSummary: marginByOrder.get(row.orderId)?.marginSummary,
  }));

  const excluded = await queryExcludedCounts();
  const monthlyComparison = buildMonthlyComparison(currentMonthly, previousMonthly);
  const summary = {
    ...buildSummaryFromTab(tab, filters, periodAgg, portfolio),
    marginPortfolio,
  };

  const warnings: string[] = [];
  if (excluded.cancelled > 0) {
    warnings.push(`${excluded.cancelled} pedido(s) cancelado(s) excluído(s) dos indicadores.`);
  }
  if (excluded.error > 0) {
    warnings.push(`${excluded.error} pedido(s) com erro excluído(s) dos indicadores.`);
  }
  if (summary.overdueOpenOrdersCount > 0 && summary.openPortfolioCount === 0) {
    warnings.push("Há pedidos atrasados na carteira filtrada.");
  }
  if (!summary.monthTargetConfigured) {
    warnings.push("Meta comercial não configurada no sistema — card exibe estado sem valor.");
  }

  return {
    generatedAt: now.toISOString(),
    filters,
    summary,
    monthlyComparison,
    realizedProjected: buildRealizedProjectedRows(tab),
    topCustomers,
    topSellers: extended.topSellers,
    statusBreakdown: tab.statusBreakdown.map((row) => ({
      status: row.status,
      label: row.label,
      amount: row.value ?? 0,
      orderCount: row.count,
    })),
    manufacturingStatusBreakdown: extended.manufacturingStatusBreakdown,
    logisticStatusBreakdown: extended.logisticStatusBreakdown,
    criticalOrders,
    openPortfolioEvolution: extended.openPortfolioEvolution,
    portfolioBreakdown: {
      notInvoicedAmount: portfolio.open.net,
      notInvoicedCount: portfolio.open.count,
      invoicedAmount: portfolio.invoiced.net,
      invoicedCount: portfolio.invoiced.count,
      overdueAmount: portfolio.overdue.net,
      overdueCount: portfolio.overdue.count,
      onTimeOpenAmount: Math.max(0, portfolio.open.net - portfolio.overdue.net),
      onTimeOpenCount: Math.max(0, portfolio.open.count - portfolio.overdue.count),
    },
    chartSeries: tab.chartSeries,
    tab,
    dataQuality: {
      warnings,
      source: "SalesOrder/SalesOrderItem",
      excludedCancelledOrdersCount: excluded.cancelled,
      excludedErrorOrdersCount: excluded.error,
      missingIssueDateCount: excluded.missingIssueDate,
      missingCustomerCount: excluded.missingCustomer,
      targetConfigured: false,
      targetDerived: false,
      targetRule: "Meta comercial não configurada — aguardando fonte oficial no sistema.",
      lastNomusSyncAt: extended.lastNomusSyncAt,
      calculationRules: [...FINANCE_SALES_ORDERS_CALCULATION_RULES],
      openPortfolioEvolutionNote: OPEN_PORTFOLIO_EVOLUTION_NOTE,
    },
  };
}

export function financeSalesOrdersMetricsAreFinite(
  payload: Pick<
    FinanceSalesOrdersDashboardPayload,
    "summary" | "monthlyComparison" | "topCustomers"
  > &
    Partial<
      Pick<
        FinanceSalesOrdersDashboardPayload,
        | "topSellers"
        | "manufacturingStatusBreakdown"
        | "logisticStatusBreakdown"
        | "criticalOrders"
        | "openPortfolioEvolution"
      >
    >
): boolean {
  const { monthTargetConfigured: _configured, ...numericSummary } = payload.summary;
  const nums: Array<number | null | undefined> = [
    ...Object.values(numericSummary),
    ...payload.monthlyComparison.flatMap((r) => [
      r.currentYearAmount,
      r.previousYearAmount,
      r.differenceAmount,
      r.growthPercent,
    ]),
    ...(payload.topCustomers ?? []).flatMap((c) => [c.amount, c.averageTicketAmount, c.sharePercent]),
    ...(payload.topSellers ?? []).flatMap((s) => [s.amount, s.averageTicketAmount, s.sharePercent]),
    ...(payload.manufacturingStatusBreakdown ?? []).flatMap((r) => [r.amount, r.orderCount]),
    ...(payload.logisticStatusBreakdown ?? []).flatMap((r) => [r.amount, r.orderCount, r.sharePercent]),
    ...(payload.criticalOrders ?? []).map((r) => r.amount),
    ...(payload.openPortfolioEvolution ?? []).flatMap((r) => [
      r.openAmount,
      r.openCount,
      r.issuedAmount,
    ]),
  ];
  return nums.every((v) => v == null || Number.isFinite(v));
}
