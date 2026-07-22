import { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";
import {
  decimalToNumber,
  startOfMonth,
  endOfMonth,
} from "./executiveDashboardHelpers.js";
import {
  countWorkdaysElapsedInYear,
  countWorkdaysInMonth,
  countWorkdaysInYear,
  endOfYear,
  startOfYear,
} from "./executiveDashboardWorkdays.js";
import { buildChartSeriesConfig } from "./executiveDashboardChartSeries.js";
import { getSalesOrderNetValue } from "./crmCommercialOrderRules.js";
import { salesOrderHasInvoicing } from "./customerCommercialSalesOrderView.js";
import {
  computeMonthProjection,
  computeTicketAverage,
  computeYearProjection,
  computeYtdDailyAverageByWorkday,
} from "./salesOrderDashboardRules.js";
import { buildSalesOrdersDashboardTab } from "./salesOrdersDashboardMetrics.js";
import {
  parseExecutiveDashboardYear,
  resolveExecutiveDashboardYearContext,
  type ExecutiveDashboardYearContext,
} from "./executiveDashboardYear.js";
import {
  buildSalesOrderListTotalsFromPrismaOrders,
  type SalesOrderListFilters,
} from "./salesOrdersListSummary.js";
import {
  buildExtendedMetricsFromOrders,
  enrichOrdersWithLogisticStatus,
  filterOrdersByLogisticStatus,
  mapPrismaOrderToDashboardRow,
  OPEN_PORTFOLIO_EVOLUTION_NOTE,
  type FinanceSalesOrdersDashboardOrderRow,
} from "./financeSalesOrdersExtendedMetrics.js";
import {
  loadSalesOrderLinkedNfeContextMap,
  type SalesOrderLinkedNfeContext,
} from "./salesOrderLinkedNfe.js";
import { aggregateSalesOrderMarginSummaries } from "./salesOrderMarginDisplay.js";
import { calculateSalesOrderMarginsForOrders } from "./salesOrderMarginService.server.js";
import {
  isBiLogisticStatusCardId,
  type BiLogisticStatusCardId,
} from "./salesOrderLogisticStatus.js";
import { andSalesOrderListWhere } from "./salesOrderListReceivableFilter.js";
import {
  resolveSalesOrderListSellerWhere,
  resolveSalesOrderOperationalPopulationWhere,
} from "./salesOrderOperationalPopulation.server.js";
import {
  buildOfficialSellerBreakdownFromManagementRows,
  mapOfficialFinancePortfolioFromManagementRows,
  mapOfficialSellerBreakdownToFinanceTopSellers,
  type OfficialFinancePortfolioSnapshot,
} from "./salesOrderRulesAdapter.js";
import { SALES_ORDER_STATUS_LABELS } from "./materialDemandFilters.js";
import type {
  FinanceSalesOrdersDashboardFilters,
  FinanceSalesOrdersDashboardPayload,
  FinanceSalesOrdersDashboardSummary,
  FinanceSalesOrdersInvoiceStatus,
  FinanceSalesOrdersMonthlyComparisonRow,
  FinanceSalesOrdersRealizedProjectedRow,
  FinanceSalesOrdersStatusBreakdownRow,
  FinanceSalesOrdersTopCustomerRow,
} from "./financeSalesOrdersDashboardTypes.js";
import {
  FINANCE_SALES_ORDERS_CALCULATION_RULES,
  FINANCE_SALES_ORDERS_DATA_SOURCE,
  FINANCE_SALES_ORDERS_MONTH_LABELS,
} from "./financeSalesOrdersDashboardTypes.js";

export { getSalesOrderNetValue as resolveSalesOrderNetAmount };

/**
 * Paridade Comercial: KPIs de período não excluem clientes do grupo.
 * Mantido como contrato de produto (OP-02 / resolveSalesOrderOperationalPopulationWhere).
 */
const FINANCE_SO_EXCLUDE_GROUP_COMPANIES = false;
void FINANCE_SO_EXCLUDE_GROUP_COMPANIES;

function invoiceStatusToHasInvoice(
  invoiceStatus: FinanceSalesOrdersInvoiceStatus
): boolean | null {
  if (invoiceStatus === "with_invoice") return true;
  if (invoiceStatus === "without_invoice") return false;
  return null;
}

function buildFinanceExtraWhere(
  filters: FinanceSalesOrdersDashboardFilters
): Prisma.SalesOrderWhereInput | null {
  const parts: Prisma.SalesOrderWhereInput[] = [];
  if (filters.company) {
    parts.push({
      companyIssuer: { contains: filters.company, mode: "insensitive" },
    });
  }
  if (filters.customerSearch) {
    parts.push({
      Customer: {
        OR: [
          {
            companyName: {
              contains: filters.customerSearch,
              mode: "insensitive",
            },
          },
          {
            tradeName: {
              contains: filters.customerSearch,
              mode: "insensitive",
            },
          },
        ],
      },
    });
  }
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0]!;
  return { AND: parts };
}

/**
 * Where OP-02 alinhado à listagem Comercial (presença + CANCELLED + seller Nomus + NF).
 * Empresa / busca de cliente são extras do dashboard financeiro.
 */
export async function resolveFinanceSalesOrdersOperationalWhere(
  filters: FinanceSalesOrdersDashboardFilters,
  opts: {
    year: number;
    month?: number | null;
    /** Quando false, ignora filtro de NF (ex.: séries anuais internas). Default true. */
    applyInvoiceFilter?: boolean;
  }
): Promise<Prisma.SalesOrderWhereInput> {
  const sellerWhere = await resolveSalesOrderListSellerWhere(prisma, {
    sellerKeyRaw: "",
    sellerText: filters.sellerName ?? "",
  });
  const hasInvoice =
    opts.applyInvoiceFilter === false
      ? null
      : invoiceStatusToHasInvoice(filters.invoiceStatus);

  const listFilters: SalesOrderListFilters = {
    year: opts.year,
    month: opts.month ?? null,
    status: filters.status ?? undefined,
    customerId: filters.customerId ?? undefined,
    sellerWhere,
    hasInvoice,
  };

  const base = await resolveSalesOrderOperationalPopulationWhere(prisma, {
    listFilters,
    context: "OPERATIONAL",
  });
  return andSalesOrderListWhere(base, buildFinanceExtraWhere(filters));
}

/**
 * Linhas leves do período filtrado para carteira NF/aberta e top vendedores.
 * Mesma classificação de NF (SalesOrderNfeLink) e status logístico BI dos cards.
 */
export function buildFinancePeriodPortfolioLiteRows(
  orders: FinanceSalesOrdersDashboardOrderRow[],
  linkedNfeContextMap: Map<string, SalesOrderLinkedNfeContext> | undefined,
  referenceDate = new Date()
): Array<{
  hasInvoice: boolean;
  totalNetValue: number;
  logisticStatusCardId: BiLogisticStatusCardId;
  sellerName: string | null;
  responsible: string | null;
}> {
  const enriched = enrichOrdersWithLogisticStatus(
    orders,
    referenceDate,
    linkedNfeContextMap
  );
  return enriched.map((row) => {
    const linked = linkedNfeContextMap?.get(row.id);
    const hasInvoice =
      linked != null ? linked.hasNfe : salesOrderHasInvoicing(row.nomusRawResponse);
    return {
      hasInvoice,
      totalNetValue: row.totalNetValue,
      logisticStatusCardId: row.logisticStatusCardId,
      sellerName: row.responsible,
      responsible: row.responsible,
    };
  });
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

/** Séries mensais a partir da população OP-02 (mesmos filtros do Comercial, sem mês). */
export function buildMonthlyAmountMapFromOrders(
  orders: Array<{ issueDate: Date; totalNetValue: unknown }>,
  year: number
): Map<number, number> {
  const map = new Map<number, number>();
  for (let m = 1; m <= 12; m += 1) map.set(m, 0);
  for (const order of orders) {
    if (order.issueDate.getFullYear() !== year) continue;
    const month = order.issueDate.getMonth() + 1;
    const net = decimalToNumber(order.totalNetValue) ?? 0;
    map.set(month, (map.get(month) ?? 0) + net);
  }
  return map;
}

function sumMapThroughMonth(map: Map<number, number>, throughMonth: number): number {
  let sum = 0;
  for (let m = 1; m <= throughMonth; m += 1) sum += map.get(m) ?? 0;
  return sum;
}

function buildStatusBreakdownFromOrders(
  orders: Array<{ status: string; totalNetValue: unknown }>
): FinanceSalesOrdersStatusBreakdownRow[] {
  const byStatus = new Map<string, { amount: number; orderCount: number }>();
  for (const order of orders) {
    const status = String(order.status ?? "").trim() || "UNKNOWN";
    const current = byStatus.get(status) ?? { amount: 0, orderCount: 0 };
    current.amount += decimalToNumber(order.totalNetValue) ?? 0;
    current.orderCount += 1;
    byStatus.set(status, current);
  }
  return [...byStatus.entries()]
    .map(([status, row]) => ({
      status,
      label:
        (SALES_ORDER_STATUS_LABELS as Record<string, string>)[status] ?? status,
      amount: row.amount,
      orderCount: row.orderCount,
    }))
    .sort((a, b) => b.amount - a.amount);
}

function buildRealizedProjectedFromMonthlyMaps(
  currentMap: Map<number, number>,
  previousMap: Map<number, number>,
  yearCtx: ExecutiveDashboardYearContext,
  projectedMonth: number | null
): FinanceSalesOrdersRealizedProjectedRow[] {
  return FINANCE_SALES_ORDERS_MONTH_LABELS.map((monthLabel, i) => {
    const month = i + 1;
    const previousYearAmount = previousMap.get(month) ?? 0;
    const realizedAmount =
      month <= yearCtx.ytdMonthLimit ? (currentMap.get(month) ?? 0) : null;
    const projectedAmount =
      yearCtx.isSelectedYearCurrent &&
      projectedMonth != null &&
      month === yearCtx.ytdMonthLimit
        ? projectedMonth
        : null;
    return {
      month,
      monthLabel,
      realizedAmount,
      projectedAmount,
      targetAmount: null,
      previousYearAmount,
    };
  });
}

function buildSummaryFromOperational(input: {
  filters: FinanceSalesOrdersDashboardFilters;
  yearCtx: ExecutiveDashboardYearContext;
  periodAgg: { count: number; net: number; items: number };
  portfolio: OfficialFinancePortfolioSnapshot;
  currentMonthly: Map<number, number>;
  previousMonthly: Map<number, number>;
  now: Date;
}): FinanceSalesOrdersDashboardSummary {
  const { filters, yearCtx, periodAgg, portfolio, currentMonthly, previousMonthly, now } =
    input;
  const refMonth = filters.month ?? yearCtx.ytdMonthLimit;
  const monthAgg = currentMonthly.get(refMonth) ?? 0;
  const prevMonth = previousMonthly.get(refMonth) ?? 0;
  const ytd = sumMapThroughMonth(currentMonthly, yearCtx.ytdMonthLimit);
  const prevYtd = sumMapThroughMonth(previousMonthly, yearCtx.ytdMonthLimit);

  const workdaysElapsed = yearCtx.isSelectedYearCurrent
    ? countWorkdaysElapsedInYear(yearCtx.referenceDate)
    : countWorkdaysInYear(filters.year);
  const dailyAverageAmount = computeYtdDailyAverageByWorkday(ytd, workdaysElapsed);
  const workdaysInMonth = countWorkdaysInMonth(filters.year, refMonth - 1);
  const workdaysInYear = countWorkdaysInYear(filters.year);
  const projectedMonth = computeMonthProjection(dailyAverageAmount, workdaysInMonth);
  const projectedYear = computeYearProjection(dailyAverageAmount, workdaysInYear);

  void now;

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
    monthTargetConfigured: false,
    monthAchievementPercent: null,
    yearAchievementPercent: null,
    monthProjectedAmount: projectedMonth,
    yearProjectedAmount: projectedYear,
    projectedMonthAchievementPercent: null,
    projectedYearAchievementPercent: null,
    dailyAverageAmount,
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
  year: number,
  month: number | null
) {
  const where = await resolveFinanceSalesOrdersOperationalWhere(filters, {
    year,
    month,
  });
  const orders = await prisma.salesOrder.findMany({
    where,
    select: {
      id: true,
      orderCode: true,
      status: true,
      issueDate: true,
      expectedDeliveryDate: true,
      totalNetValue: true,
      totalItems: true,
      responsible: true,
      nomusSellerName: true,
      nomusRawResponse: true,
      updatedAt: true,
      sentToNomusAt: true,
      Customer: {
        select: { id: true, companyName: true, tradeName: true },
      },
    },
    orderBy: { issueDate: "desc" },
  });
  return orders.map((order) => ({
    ...mapPrismaOrderToDashboardRow({
      ...order,
      responsible: order.nomusSellerName ?? order.responsible,
    }),
    status: order.status,
    totalItems: order.totalItems,
  }));
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

function buildTopCustomersFromPeriodOrders(
  orders: Array<{
    id: string;
    customerId: string;
    customerName: string;
    totalNetValue: number;
  }>,
  limit = 10
): FinanceSalesOrdersTopCustomerRow[] {
  const byCustomer = new Map<
    string,
    { customerName: string; orderCount: number; amount: number }
  >();
  for (const order of orders) {
    const customerId = order.customerId?.trim() || order.id;
    const current = byCustomer.get(customerId) ?? {
      customerName: order.customerName,
      orderCount: 0,
      amount: 0,
    };
    current.orderCount += 1;
    current.amount += order.totalNetValue;
    byCustomer.set(customerId, current);
  }
  const ranked = [...byCustomer.entries()]
    .sort((a, b) => b[1].amount - a[1].amount)
    .slice(0, limit);
  const totalAll = ranked.reduce((sum, [, row]) => sum + row.amount, 0);
  return ranked.map(([customerId, row]) => {
    const amount = Math.round(row.amount * 100) / 100;
    return {
      customerId,
      customerName: row.customerName,
      amount,
      orderCount: row.orderCount,
      averageTicketAmount: computeTicketAverage(amount, row.orderCount),
      sharePercent: totalAll > 0 ? Math.round((amount / totalAll) * 10000) / 100 : null,
    };
  });
}

export async function buildFinanceSalesOrdersDashboard(
  query: Record<string, unknown> = {},
  now = new Date()
): Promise<FinanceSalesOrdersDashboardPayload> {
  const filters = parseFinanceSalesOrdersFilters(query, now);
  const yearCtx = resolveFinanceSalesOrdersYearContext(filters, now);
  // Mantido no payload por compatibilidade de contrato; KPIs filtrados NÃO usam o tab.
  const tab = await buildSalesOrdersDashboardTab(yearCtx);

  // População do período = mesmo where da listagem Comercial (OP-02).
  let periodOrders = await loadDashboardOrders(
    filters,
    filters.year,
    filters.month
  );
  const linkedNfeContextMap = await loadSalesOrderLinkedNfeContextMap(
    periodOrders.map((order) => ({
      id: order.id,
      totalNetValue: order.totalNetValue,
      issueDate: order.issueDate,
      expectedDeliveryDate: order.expectedDeliveryDate,
      nomusRawResponse: order.nomusRawResponse,
    })),
    now
  );

  if (filters.logisticStatus) {
    const enriched = enrichOrdersWithLogisticStatus(
      periodOrders,
      now,
      linkedNfeContextMap
    );
    const filtered = filterOrdersByLogisticStatus(enriched, filters.logisticStatus);
    const allowed = new Set(filtered.map((row) => row.id));
    periodOrders = periodOrders.filter((order) => allowed.has(order.id));
  }

  const periodTotals = buildSalesOrderListTotalsFromPrismaOrders(periodOrders);
  const periodAgg = {
    count: periodTotals.totalOrders,
    net: periodTotals.totalNetAmount,
    items: periodTotals.totalItems,
  };

  // Séries anuais: mesmos filtros Comercial, sem mês (comparativo / YTD / projeção).
  const yearOrdersCurrent = await loadDashboardOrders(filters, filters.year, null);
  const yearOrdersPrevious = await loadDashboardOrders(
    filters,
    filters.year - 1,
    null
  );
  let yearScopedCurrent = yearOrdersCurrent;
  let yearScopedPrevious = yearOrdersPrevious;
  if (filters.logisticStatus) {
    const enrichYear = async (
      rows: typeof yearOrdersCurrent
    ) => {
      const map = await loadSalesOrderLinkedNfeContextMap(
        rows.map((order) => ({
          id: order.id,
          totalNetValue: order.totalNetValue,
          issueDate: order.issueDate,
          expectedDeliveryDate: order.expectedDeliveryDate,
          nomusRawResponse: order.nomusRawResponse,
        })),
        now
      );
      const enriched = enrichOrdersWithLogisticStatus(rows, now, map);
      return filterOrdersByLogisticStatus(enriched, filters.logisticStatus);
    };
    yearScopedCurrent = await enrichYear(yearOrdersCurrent);
    yearScopedPrevious = await enrichYear(yearOrdersPrevious);
  }

  const currentMonthly = buildMonthlyAmountMapFromOrders(
    yearScopedCurrent,
    filters.year
  );
  const previousMonthly = buildMonthlyAmountMapFromOrders(
    yearScopedPrevious,
    filters.year - 1
  );

  // Carteira / faturado / atrasado: mesma população dos cards "emitidos" (período filtrado).
  const periodLiteRows = buildFinancePeriodPortfolioLiteRows(
    periodOrders,
    linkedNfeContextMap,
    now
  );
  const portfolio = mapOfficialFinancePortfolioFromManagementRows(periodLiteRows);
  const topCustomers = buildTopCustomersFromPeriodOrders(periodOrders, 10);

  const marginByOrder = await calculateSalesOrderMarginsForOrders(
    prisma,
    periodOrders.map((order) => ({
      id: order.id,
      issueDate: order.issueDate,
      nomusRawResponse: order.nomusRawResponse,
    }))
  );
  const marginPortfolio = aggregateSalesOrderMarginSummaries(
    [...marginByOrder.values()].map((row) => row.marginSummary)
  );

  const extended = buildExtendedMetricsFromOrders({
    orders: periodOrders,
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
    ...buildSummaryFromOperational({
      filters,
      yearCtx,
      periodAgg,
      portfolio,
      currentMonthly,
      previousMonthly,
      now,
    }),
    marginPortfolio,
  };

  const warnings: string[] = [];
  if (excluded.cancelled > 0) {
    warnings.push(`${excluded.cancelled} pedido(s) cancelado(s) excluído(s) dos indicadores.`);
  }
  if (excluded.error > 0) {
    warnings.push(
      `${excluded.error} pedido(s) com status ERROR permanecem na população (paridade Comercial).`
    );
  }
  if (summary.overdueOpenOrdersCount > 0 && summary.openPortfolioCount === 0) {
    warnings.push("Há pedidos atrasados na carteira filtrada.");
  }
  if (!summary.monthTargetConfigured) {
    warnings.push("Meta comercial não configurada no sistema — card exibe estado sem valor.");
  }

  const chartSeries = buildChartSeriesConfig("salesOrders", yearCtx);

  return {
    generatedAt: now.toISOString(),
    filters,
    summary,
    monthlyComparison,
    realizedProjected: buildRealizedProjectedFromMonthlyMaps(
      currentMonthly,
      previousMonthly,
      yearCtx,
      summary.monthProjectedAmount
    ),
    topCustomers,
    topSellers: mapOfficialSellerBreakdownToFinanceTopSellers(
      buildOfficialSellerBreakdownFromManagementRows(periodLiteRows)
    ),
    statusBreakdown: buildStatusBreakdownFromOrders(periodOrders),
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
    chartSeries,
    tab,
    dataQuality: {
      warnings,
      source: FINANCE_SALES_ORDERS_DATA_SOURCE,
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
