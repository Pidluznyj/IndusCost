import { prisma } from "@/src/lib/prisma.js";
import {
  endOfYear,
  startOfYear,
} from "@/src/lib/executiveDashboardWorkdays.js";
import {
  formatExecutiveCompactCurrency,
  formatExecutiveCurrency,
  formatExecutiveInteger,
  formatExecutivePercent,
} from "@/src/lib/executiveDashboardFormatters.js";
import type { ExecutiveDashboardYearContext } from "@/src/lib/executiveDashboardYear.js";
import { SALES_ORDER_STATUS_LABELS } from "@/src/lib/materialDemandFilters.js";
import {
  computeDaysOpen,
  computeFunnelPercent,
  SALES_FUNNEL_STAGE_DESCRIPTIONS,
} from "@/src/lib/salesFunnelDashboardRules.js";
import {
  computeTicketAverage,
  computeDaysOverdue,
  isCancelledSalesOrderStatus,
  isOverdueSalesOrderInSelectedYear,
} from "@/src/lib/salesOrderDashboardRules.js";
import {
  buildOperationalFunnelStages,
  loadSalesOrderEnrichedMetricsForIssueYear,
  type SalesOrderEnrichedMetrics,
  type SalesOperationalFunnelStage,
} from "@/src/lib/salesOrderMetricsEngine.js";
import {
  buildOfficialSalesOrderRulesResult,
  buildOfficialStatusBreakdownFromOrders,
  mapPrismaOrderToSalesOrderRulesInput,
  OFFICIAL_SO_RULES_SOURCE,
  SALES_ORDER_RULES_PRISMA_SELECT,
} from "@/src/lib/salesOrderRulesAdapter.js";
import { loadSalesOrderLinkedNfeContextMap } from "@/src/lib/salesOrderLinkedNfe.js";
import type {
  DashboardMetricCard,
  DashboardStatusBreakdownRow,
  SalesFunnelConversionMonth,
  SalesFunnelCriticalOrderRow,
  SalesFunnelDashboardTab,
  SalesFunnelMonthlyPoint,
  SalesFunnelOpenCustomerRow,
  SalesFunnelOperationalStage,
  SalesFunnelStage,
} from "@/src/lib/executiveDashboardTypes.js";

const MONTH_SHORT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const TOP_CUSTOMERS_LIMIT = 10;
const CRITICAL_ORDERS_LIMIT = 15;
const OPEN_DAYS_THRESHOLD = 30;

function formatOperationalStage(stage: SalesOperationalFunnelStage, soldCount: number): SalesFunnelOperationalStage {
  const percentOfSold = computeFunnelPercent(stage.count, soldCount);
  return {
    id: stage.id,
    label: stage.label,
    description: stage.description,
    count: stage.count,
    value: stage.value,
    percentOfSold,
    formatted: {
      count: formatExecutiveInteger(stage.count),
      value: formatExecutiveCurrency(stage.value),
      compactValue: formatExecutiveCompactCurrency(stage.value),
      percentOfSold: percentOfSold != null ? formatExecutivePercent(percentOfSold, 1) : "—",
    },
  };
}

function buildYearFunnelTotalsFromEngine(metrics: SalesOrderEnrichedMetrics[]) {
  const emittedCount = metrics.length;
  const emittedValue = metrics.reduce((sum, m) => sum + m.totalNetValue, 0);
  const valid = metrics.filter((m) => !isCancelledSalesOrderStatus(m.orderStatus));
  const validCount = valid.length;
  const validValue = valid.reduce((sum, m) => sum + m.totalNetValue, 0);
  const invoiced = valid.filter((m) => m.hasNfe);
  const open = valid.filter(
    (m) =>
      m.isPendingInvoice &&
      m.logisticStatusCardId !== "finishedOrCancelled" &&
      m.logisticStatusCardId !== "reviewData"
  );
  const overdue = valid.filter((m) => m.logisticStatusCardId === "overduePending");
  const cancelled = metrics.filter((m) => isCancelledSalesOrderStatus(m.orderStatus));
  const avgDaysOverdue =
    overdue.length > 0
      ? overdue.reduce((sum, m) => sum + (m.daysLate ?? 0), 0) / overdue.length
      : null;

  return {
    emittedCount,
    emittedValue,
    validCount,
    validValue,
    invoicedCount: invoiced.length,
    invoicedValue: invoiced.reduce((sum, m) => sum + m.totalNetValue, 0),
    openCount: open.length,
    openValue: open.reduce((sum, m) => sum + m.totalNetValue, 0),
    overdueCount: overdue.length,
    overdueValue: overdue.reduce((sum, m) => sum + m.totalNetValue, 0),
    cancelledCount: cancelled.length,
    cancelledValue: cancelled.reduce((sum, m) => sum + m.totalNetValue, 0),
    avgDaysOverdue,
  };
}

function buildMonthlyFunnelFromEngine(
  metrics: SalesOrderEnrichedMetrics[],
  year: number
): Map<number, { issuedCount: number; issuedValue: number; invoicedCount: number; invoicedValue: number }> {
  const map = new Map<number, { issuedCount: number; issuedValue: number; invoicedCount: number; invoicedValue: number }>();
  for (const m of metrics) {
    if (!m.issueDate) continue;
    const issue = new Date(m.issueDate);
    if (issue.getFullYear() !== year) continue;
    if (isCancelledSalesOrderStatus(m.orderStatus)) continue;
    const month = issue.getMonth() + 1;
    const bucket = map.get(month) ?? { issuedCount: 0, issuedValue: 0, invoicedCount: 0, invoicedValue: 0 };
    bucket.issuedCount += 1;
    bucket.issuedValue += m.totalNetValue;
    if (m.hasNfe) {
      bucket.invoicedCount += 1;
      bucket.invoicedValue += m.totalNetValue;
    }
    map.set(month, bucket);
  }
  return map;
}

function buildOpenPortfolioByCustomerFromEngine(
  metrics: SalesOrderEnrichedMetrics[],
  today: Date
): SalesFunnelOpenCustomerRow[] {
  const open = metrics.filter(
    (m) =>
      !isCancelledSalesOrderStatus(m.orderStatus) &&
      m.isPendingInvoice &&
      m.logisticStatusCardId !== "finishedOrCancelled"
  );
  const byCustomer = new Map<
    string,
    { customerName: string; orderCount: number; openValue: number; oldestIssue: Date }
  >();
  for (const m of open) {
    const key = m.customerId ?? m.customerName;
    const issue = m.issueDate ? new Date(m.issueDate) : today;
    const current = byCustomer.get(key) ?? {
      customerName: m.customerName,
      orderCount: 0,
      openValue: 0,
      oldestIssue: issue,
    };
    current.orderCount += 1;
    current.openValue += m.totalNetValue;
    if (issue < current.oldestIssue) current.oldestIssue = issue;
    byCustomer.set(key, current);
  }
  return [...byCustomer.entries()]
    .map(([customerId, row]) => ({
      customerId,
      customerName: row.customerName,
      orderCount: row.orderCount,
      openValue: row.openValue,
      oldestIssueDate: row.oldestIssue.toISOString(),
      daysOpen: computeDaysOpen(row.oldestIssue, today),
    }))
    .sort((a, b) => (b.openValue ?? 0) - (a.openValue ?? 0))
    .slice(0, TOP_CUSTOMERS_LIMIT);
}

function buildCriticalOrdersFromEngine(
  metrics: SalesOrderEnrichedMetrics[],
  selectedYear: number,
  today: Date
): SalesFunnelCriticalOrderRow[] {
  const openSince = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  openSince.setDate(openSince.getDate() - OPEN_DAYS_THRESHOLD);

  const candidates = metrics.filter((m) => {
    if (isCancelledSalesOrderStatus(m.orderStatus)) return false;
    if (!m.isPendingInvoice || m.logisticStatusCardId === "finishedOrCancelled") return false;
    const issue = m.issueDate ? new Date(m.issueDate) : null;
    const isOverdue = m.logisticStatusCardId === "overduePending";
    const isLongOpen = issue != null && issue <= openSince;
    return isOverdue || isLongOpen;
  });

  return candidates
    .sort((a, b) => {
      const aOverdue = a.logisticStatusCardId === "overduePending" ? 0 : 1;
      const bOverdue = b.logisticStatusCardId === "overduePending" ? 0 : 1;
      if (aOverdue !== bOverdue) return aOverdue - bOverdue;
      const da = a.expectedDeliveryDate ? new Date(a.expectedDeliveryDate).getTime() : Infinity;
      const db = b.expectedDeliveryDate ? new Date(b.expectedDeliveryDate).getTime() : Infinity;
      if (da !== db) return da - db;
      const ia = a.issueDate ? new Date(a.issueDate).getTime() : 0;
      const ib = b.issueDate ? new Date(b.issueDate).getTime() : 0;
      return ia - ib;
    })
    .slice(0, CRITICAL_ORDERS_LIMIT)
    .map((m) => {
      const issueDate = m.issueDate ? new Date(m.issueDate) : today;
      const expectedDelivery = m.expectedDeliveryDate ? new Date(m.expectedDeliveryDate) : null;
      const isOverdue = m.logisticStatusCardId === "overduePending";
      const daysOverdue =
        isOverdue && expectedDelivery ? computeDaysOverdue(expectedDelivery, today) : null;
      return {
        orderId: m.salesOrderId,
        orderCode: m.orderCode,
        customerName: m.customerName,
        issueDate: issueDate.toISOString(),
        expectedDeliveryDate: expectedDelivery?.toISOString() ?? null,
        totalNetValue: m.totalNetValue,
        status: m.orderStatus,
        statusLabel: SALES_ORDER_STATUS_LABELS[m.orderStatus] ?? m.orderStatus,
        isInvoiced: m.hasNfe,
        isOverdue,
        daysOverdue,
        daysOpen: computeDaysOpen(issueDate, today),
        priority: isOverdue ? ("overdue" as const) : ("open" as const),
      };
    });
}

function metricCard(
  id: string,
  label: string,
  value: number | null,
  opts?: { hint?: string; asCurrency?: boolean; compact?: boolean; asPercent?: boolean; countLabel?: string }
): DashboardMetricCard {
  const formatted = opts?.asPercent
    ? formatExecutivePercent(value, 1)
    : opts?.asCurrency
      ? formatExecutiveCurrency(value)
      : formatExecutiveInteger(value);
  return {
    id,
    label,
    value,
    formatted,
    compactFormatted: opts?.compact && opts?.asCurrency ? formatExecutiveCompactCurrency(value) : undefined,
    hint: opts?.hint,
  };
}

function formatStage(stage: {
  count: number | null;
  value: number | null;
  percentOfEmitted: number | null;
  percentOfValid: number | null;
}) {
  return {
    count: formatExecutiveInteger(stage.count),
    value: formatExecutiveCurrency(stage.value),
    compactValue: formatExecutiveCompactCurrency(stage.value),
    percentOfEmitted:
      stage.percentOfEmitted != null ? formatExecutivePercent(stage.percentOfEmitted, 1) : "—",
    percentOfValid:
      stage.percentOfValid != null ? formatExecutivePercent(stage.percentOfValid, 1) : "—",
  };
}

function buildStage(
  id: SalesFunnelStage["id"],
  label: string,
  description: string,
  count: number | null,
  value: number | null,
  emittedCount: number,
  validCount: number
): SalesFunnelStage {
  const percentOfEmitted = computeFunnelPercent(count ?? 0, emittedCount);
  const percentOfValid = computeFunnelPercent(count ?? 0, validCount);
  return {
    id,
    label,
    description,
    count: count ?? 0,
    value,
    percentOfEmitted,
    percentOfValid,
    formatted: formatStage({ count, value, percentOfEmitted, percentOfValid }),
  };
}

async function loadFunnelOfficialRules(year: number, referenceDate: Date) {
  const from = startOfYear(new Date(year, 0, 1));
  const to = endOfYear(new Date(year, 0, 1));
  const orders = await prisma.salesOrder.findMany({
    where: { issueDate: { gte: from, lte: to } },
    select: SALES_ORDER_RULES_PRISMA_SELECT,
  });
  const linkedMap = await loadSalesOrderLinkedNfeContextMap(
    orders.map((order) => ({
      id: order.id,
      totalNetValue: order.totalNetValue,
      issueDate: order.issueDate,
      expectedDeliveryDate: order.expectedDeliveryDate,
      nomusRawResponse: order.nomusRawResponse,
    })),
    referenceDate
  );
  const rulesOrders = orders.map(mapPrismaOrderToSalesOrderRulesInput);
  const rules = buildOfficialSalesOrderRulesResult({
    orders: rulesOrders,
    referenceDate,
    year,
    month: referenceDate.getMonth() + 1,
    linkedNfeContextMap: linkedMap,
    managementFilters: { year },
    scope: "management",
  });
  return { rules, rulesOrders };
}

export async function buildSalesFunnelDashboardTab(
  yearCtx: ExecutiveDashboardYearContext
): Promise<SalesFunnelDashboardTab> {
  const year = yearCtx.selectedYear;
  const yearStart = startOfYear(new Date(year, 0, 1));
  const yearEnd = endOfYear(new Date(year, 0, 1));
  const operationalNow = new Date();

  const engineMetrics = await loadSalesOrderEnrichedMetricsForIssueYear(year, operationalNow);
  const { rules: officialRules, rulesOrders: funnelYearOrders } = await loadFunnelOfficialRules(
    year,
    yearCtx.referenceDate
  );
  const fulfillment = officialRules.fulfillmentKpis;
  const aggregate = {
    totalSoldValue: fulfillment.totalSoldValue,
    totalInvoicedValue: fulfillment.totalInvoicedValue,
    soldInvoicedGap: fulfillment.soldInvoicedGap,
    totalOrders: fulfillment.totalOrders,
    withNfeCount: fulfillment.ordersWithNfe,
    withoutNfeCount: fulfillment.ordersWithoutNfe,
    deliveredOnTimeCount: fulfillment.deliveredOnTime,
    deliveredLateCount: fulfillment.deliveredLate,
    pendingOnTimeCount: fulfillment.pendingOnTime,
    pendingLateCount: fulfillment.pendingLate,
    partialCount: fulfillment.partialCount,
    invoiceCoveragePercent: fulfillment.averageInvoicedPercent,
  };
  const totals = buildYearFunnelTotalsFromEngine(engineMetrics);
  const operationalFunnelRaw = buildOperationalFunnelStages(engineMetrics);
  const soldCount = operationalFunnelRaw.find((s) => s.id === "sold")?.count ?? totals.validCount;

  const [monthlyMap, statusBreakdown, openPortfolioByCustomer, criticalOrders] = await Promise.all([
    Promise.resolve(buildMonthlyFunnelFromEngine(engineMetrics, year)),
    Promise.resolve(
      buildOfficialStatusBreakdownFromOrders(funnelYearOrders, SALES_ORDER_STATUS_LABELS)
    ),
    Promise.resolve(buildOpenPortfolioByCustomerFromEngine(engineMetrics, operationalNow)),
    Promise.resolve(buildCriticalOrdersFromEngine(engineMetrics, year, operationalNow)),
  ]);

  const ticketAvg = computeTicketAverage(totals.validValue, totals.validCount);
  const invoicedPercent = computeFunnelPercent(totals.invoicedCount, totals.validCount);
  const openPercent = computeFunnelPercent(totals.openCount, totals.validCount);
  const cancelledPercent = computeFunnelPercent(totals.cancelledCount, totals.emittedCount);
  const billingConversion = computeFunnelPercent(
    totals.invoicedValue ?? 0,
    totals.validValue ?? 0
  );

  const funnelStages: SalesFunnelStage[] = [
    buildStage(
      "emitted",
      "Emitidos",
      SALES_FUNNEL_STAGE_DESCRIPTIONS.emitted,
      totals.emittedCount,
      totals.emittedValue,
      totals.emittedCount,
      totals.validCount
    ),
    buildStage(
      "valid",
      "Válidos",
      SALES_FUNNEL_STAGE_DESCRIPTIONS.valid,
      totals.validCount,
      totals.validValue,
      totals.emittedCount,
      totals.validCount
    ),
    buildStage(
      "openPortfolio",
      "Em carteira",
      SALES_FUNNEL_STAGE_DESCRIPTIONS.openPortfolio,
      totals.openCount,
      totals.openValue,
      totals.emittedCount,
      totals.validCount
    ),
    buildStage(
      "invoiced",
      "Faturados",
      SALES_FUNNEL_STAGE_DESCRIPTIONS.invoiced,
      totals.invoicedCount,
      totals.invoicedValue,
      totals.emittedCount,
      totals.validCount
    ),
    buildStage(
      "overdue",
      "Atrasados",
      SALES_FUNNEL_STAGE_DESCRIPTIONS.overdue,
      totals.overdueCount,
      totals.overdueValue,
      totals.emittedCount,
      totals.validCount
    ),
    buildStage(
      "cancelled",
      "Cancelados",
      SALES_FUNNEL_STAGE_DESCRIPTIONS.cancelled,
      totals.cancelledCount,
      totals.cancelledValue,
      totals.emittedCount,
      totals.validCount
    ),
  ];

  const monthlyEvolution: SalesFunnelMonthlyPoint[] = MONTH_SHORT.map((monthLabel, idx) => {
    const month = idx + 1;
    const data = monthlyMap.get(month);
    const issuedCount = data?.issuedCount ?? 0;
    const invoicedCount = data?.invoicedCount ?? 0;
    return {
      month,
      monthLabel,
      issuedValue: data?.issuedValue ?? 0,
      invoicedValue: data?.invoicedValue ?? 0,
      openPortfolioValue: null,
      overdueValue: null,
      issuedCount,
      invoicedCount,
      conversionPercent: computeFunnelPercent(invoicedCount, issuedCount),
    };
  });

  const conversionByMonth: SalesFunnelConversionMonth[] = monthlyEvolution.map((point) => ({
    month: point.month,
    monthLabel: point.monthLabel,
    issuedCount: point.issuedCount,
    invoicedCount: point.invoicedCount,
    conversionPercent: point.conversionPercent,
  }));

  const summaryCards: DashboardMetricCard[] = [
    metricCard("funnel-emitted-count", "Pedidos emitidos", totals.emittedCount, {
      hint: `${formatExecutiveCurrency(totals.emittedValue)} no ano ${year}`,
    }),
    metricCard("funnel-emitted-value", "Valor emitido", totals.emittedValue, {
      asCurrency: true,
      compact: true,
    }),
    metricCard("funnel-invoiced-count", "Faturados", totals.invoicedCount, {
      hint:
        invoicedPercent != null
          ? `${formatExecutivePercent(invoicedPercent, 1)} dos válidos`
          : undefined,
    }),
    metricCard("funnel-invoiced-value", "Valor faturado", totals.invoicedValue, {
      asCurrency: true,
      compact: true,
    }),
    metricCard("funnel-open-count", "Carteira aberta", totals.openCount, {
      hint:
        openPercent != null ? `${formatExecutivePercent(openPercent, 1)} dos válidos` : undefined,
    }),
    metricCard("funnel-open-value", "Valor em aberto", totals.openValue, {
      asCurrency: true,
      compact: true,
      hint: `${formatExecutiveInteger(totals.overdueCount)} atrasados incluídos na carteira`,
    }),
    metricCard("funnel-overdue-count", "Atrasados", totals.overdueCount, {
      hint: SALES_FUNNEL_STAGE_DESCRIPTIONS.overdue,
    }),
    metricCard("funnel-overdue-value", "Valor atrasado", totals.overdueValue, {
      asCurrency: true,
      compact: true,
      hint:
        totals.avgDaysOverdue != null
          ? `Média ${formatExecutiveInteger(Math.round(totals.avgDaysOverdue))} dias de atraso`
          : undefined,
    }),
    metricCard("funnel-cancelled-count", "Cancelados", totals.cancelledCount, {
      hint:
        cancelledPercent != null
          ? `${formatExecutivePercent(cancelledPercent, 1)} dos emitidos`
          : undefined,
    }),
    metricCard("funnel-cancelled-value", "Valor cancelado", totals.cancelledValue, {
      asCurrency: true,
      compact: true,
    }),
    metricCard("funnel-ticket", "Ticket médio", ticketAvg, { asCurrency: true }),
    metricCard("funnel-conversion", "Conversão p/ faturamento", billingConversion, {
      asPercent: true,
      hint: "Valor faturado ÷ valor emitido válido",
    }),
    metricCard("funnel-backlog", "Backlog comercial", totals.openValue, {
      asCurrency: true,
      compact: true,
      hint: `Carteira aberta (${formatExecutiveInteger(totals.overdueCount)} pedidos atrasados)`,
    }),
  ];

  const operationalFunnelStages = operationalFunnelRaw.map((stage) =>
    formatOperationalStage(stage, soldCount)
  );

  const operationalSummaryCards: DashboardMetricCard[] = [
    metricCard("op-sold-value", "Valor vendido", aggregate.totalSoldValue, {
      asCurrency: true,
      compact: true,
      hint: `${formatExecutiveInteger(aggregate.totalOrders)} pedidos válidos`,
    }),
    metricCard("op-invoiced-value", "Valor faturado (NF)", aggregate.totalInvoicedValue, {
      asCurrency: true,
      compact: true,
      hint: `${formatExecutiveInteger(aggregate.withNfeCount)} com NF`,
    }),
    metricCard("op-gap", "Gap vendido × faturado", aggregate.soldInvoicedGap, {
      asCurrency: true,
      compact: true,
    }),
    metricCard("op-coverage", "% faturado", aggregate.invoiceCoveragePercent, {
      asPercent: true,
    }),
    metricCard("op-on-time", "No prazo", aggregate.deliveredOnTimeCount + aggregate.pendingOnTimeCount),
    metricCard("op-late", "Atrasados", aggregate.deliveredLateCount + aggregate.pendingLateCount),
    metricCard("op-pending", "Pendentes sem NF", aggregate.withoutNfeCount),
    metricCard("op-partial", "Parciais", aggregate.partialCount),
  ];

  return {
    available: true,
    source: `${OFFICIAL_SO_RULES_SOURCE} + salesOrderMetricsEngine (funil operacional)`,
    selectedYear: year,
    summaryCards,
    funnelStages,
    operationalFunnelStages,
    operationalSummaryCards,
    monthlyEvolution,
    statusBreakdown,
    conversionByMonth,
    openPortfolioByCustomer,
    criticalOrders,
    rules: [
      "Data comercial: issueDate do pedido.",
      "Valor vendido: totalNetValue do pedido.",
      "Valor faturado: soma das NF-es vinculadas (sem duplicar pedido).",
      "Status logístico/prazo: motor salesOrderMetricsEngine (Gestão de Pedidos).",
      "Funil operacional: jornada vendido → NF → prazo/atraso/pendente/parcial.",
    ],
    unavailableIndicators: [],
  };
}
