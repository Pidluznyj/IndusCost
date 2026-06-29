import { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";
import {
  decimalToNumber,
  startOfMonth,
  endOfMonth,
} from "./executiveDashboardHelpers.js";
import {
  endOfYear,
  startOfYear,
} from "./executiveDashboardWorkdays.js";
import { getSalesOrderNetValue } from "./crmCommercialOrderRules.js";
import { computeTicketAverage } from "./salesOrderDashboardRules.js";
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
import {
  buildOfficialSalesOrderRulesResult,
  buildOfficialSellerBreakdownFromManagementRows,
  buildOfficialTopCustomersFromRulesOrders,
  mapFinanceSalesOrdersFiltersToRulesInput,
  mapOfficialFinancePeriodAgg,
  mapOfficialFinancePortfolioFromManagementRows,
  mapOfficialSellerBreakdownToFinanceTopSellers,
  mapPrismaOrderToSalesOrderRulesInput,
  buildOfficialMonthlyAmountMaps,
  OFFICIAL_SO_RULES_SOURCE,
  SALES_ORDER_RULES_PRISMA_SELECT,
  type OfficialFinancePortfolioSnapshot,
} from "./salesOrderRulesAdapter.js";
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

async function loadFinanceRulesOrders(
  filters: FinanceSalesOrdersDashboardFilters,
  years: number[]
) {
  const where: Prisma.SalesOrderWhereInput = {
    issueDate: {
      gte: startOfYear(new Date(Math.min(...years), 0, 1)),
      lte: endOfYear(new Date(Math.max(...years), 0, 1)),
    },
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

  const rows = await prisma.salesOrder.findMany({
    where,
    select: SALES_ORDER_RULES_PRISMA_SELECT,
    orderBy: { issueDate: "desc" },
  });
  return rows.map(mapPrismaOrderToSalesOrderRulesInput);
}

async function buildOfficialFinanceRulesBundle(
  filters: FinanceSalesOrdersDashboardFilters,
  now: Date
) {
  const rulesInput = mapFinanceSalesOrdersFiltersToRulesInput(filters);
  const month = filters.month ?? now.getMonth() + 1;
  const orders = await loadFinanceRulesOrders(filters, [filters.year, filters.year - 1]);
  const linkedMap = await loadSalesOrderLinkedNfeContextMap(
    orders.map((order) => ({
      id: order.id,
      totalNetValue: order.totalNetValue,
      issueDate: order.issueDate,
      expectedDeliveryDate: order.expectedDeliveryDate,
      nomusRawResponse: order.nomusRawResponse,
    })),
    now
  );

  const current = buildOfficialSalesOrderRulesResult({
    orders,
    ...rulesInput,
    referenceDate: now,
    year: filters.year,
    month,
    linkedNfeContextMap: linkedMap,
    scope: "unified",
  });

  const prevRef = new Date(
    filters.year - 1,
    now.getMonth(),
    now.getDate(),
    23,
    59,
    59,
    999
  );
  const previous = buildOfficialSalesOrderRulesResult({
    orders,
    listFilters: { ...rulesInput.listFilters, year: filters.year - 1 },
    managementFilters: { ...rulesInput.managementFilters, year: filters.year - 1 },
    referenceDate: prevRef,
    year: filters.year - 1,
    month,
    linkedNfeContextMap: linkedMap,
    scope: "unified",
  });

  return { current, previous, linkedMap, orders };
}

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
  portfolio: OfficialFinancePortfolioSnapshot
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
  const rulesBundle = await buildOfficialFinanceRulesBundle(filters, now);
  const rulesInput = mapFinanceSalesOrdersFiltersToRulesInput(filters);

  const periodAgg = mapOfficialFinancePeriodAgg(rulesBundle.current);
  const monthlyMaps = buildOfficialMonthlyAmountMaps(
    rulesBundle.current.monthlyTimeline,
    rulesBundle.previous.monthlyTimeline
  );
  const currentMonthly = monthlyMaps.current;
  const previousMonthly = monthlyMaps.previous;

  const portfolio = mapOfficialFinancePortfolioFromManagementRows(
    rulesBundle.current.managementBundle.rows
  );
  const topCustomers = buildOfficialTopCustomersFromRulesOrders(
    rulesBundle.orders,
    { ...rulesInput.listFilters, year: filters.year, month: filters.month ?? null },
    10
  );

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
    topSellers: mapOfficialSellerBreakdownToFinanceTopSellers(
      buildOfficialSellerBreakdownFromManagementRows(rulesBundle.current.managementBundle.rows)
    ),
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
      source: OFFICIAL_SO_RULES_SOURCE,
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
