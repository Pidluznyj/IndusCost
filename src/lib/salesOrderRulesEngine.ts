/**
 * Motor oficial de regras de Pedidos de Venda — fonte única server-side para métricas SO.
 *
 * Consolida regras já existentes em:
 * - salesOrdersListSummary.ts (tela Pedidos de Venda)
 * - salesOrderManagement.ts + salesOrderManagementFulfillment.ts (Gestão)
 * - salesOrderMetricsEngine.ts (métricas enriquecidas / NF)
 * - salesOrderLogisticStatus.ts (status logístico BI)
 * - salesOrderDashboardRules.ts (executivo: meta, projeção, ticket)
 * - salesOrderPeriodFilter.ts (issueDate)
 * - financeCivilDate.ts (datas civis)
 *
 * Não recalcula margem — apenas repassa marginSummary do motor oficial de margem.
 * Não altera telas/endpoints existentes.
 */

import { decimalToNumber } from "./executiveDashboardHelpers.js";
import {
  countWorkdaysElapsedInYear,
  countWorkdaysInMonth,
} from "./executiveDashboardWorkdays.js";
import { startOfCivilDate, toCivilDateKey } from "./financeCivilDate.js";
import {
  buildManagementRowsFromOrders,
  type SalesOrderManagementFilters,
} from "./salesOrderManagement.js";
import { buildFulfillmentKpis } from "./salesOrderManagementFulfillment.js";
import type { SalesOrderManagementRow } from "./salesOrderManagementTypes.js";
import {
  computeGrowthTarget,
  computeMonthProjection,
  computeTicketAverage,
  computeYtdDailyAverageByWorkday,
  isCancelledSalesOrderStatus,
} from "./salesOrderDashboardRules.js";
import { buildSalesOrderBiLogisticStatus } from "./salesOrderLogisticStatus.js";
import type { SalesOrderLinkedNfeContext } from "./salesOrderLinkedNfe.js";
import { resolveSalesOrderIssueDateRange } from "./salesOrderPeriodFilter.js";
import {
  buildSalesOrderListSummary,
  isValidSalesOrderListStatus,
  summarizeSalesOrderListRows,
  type SalesOrderListFilters,
} from "./salesOrdersListSummary.js";
import type {
  NormalizedSalesOrderRecord,
  SalesOrderGridRow,
  SalesOrderMetricDefinition,
  SalesOrderMetrics,
  SalesOrderMonthlyTimelinePoint,
  SalesOrderRulesAuditResult,
  SalesOrderRulesBuildInput,
  SalesOrderRulesContext,
  SalesOrderRulesDateRole,
  SalesOrderRulesFilters,
  SalesOrderRulesMetricKey,
  SalesOrderRulesOrderInput,
  SalesOrderRulesResult,
  SalesOrderRulesScope,
} from "./salesOrderRulesEngine.types.js";

export const SALES_ORDER_RULES_ENGINE_VERSION = "1.0.0";

export const SALES_ORDER_RULES_ENGINE_NOTE =
  "Pedidos de Venda: valor vendido = SalesOrder.totalNetValue (header); data-base = issueDate; faturado = NF vinculada; status logístico = buildSalesOrderBiLogisticStatus; margem orquestrada, não recalculada." as const;

export type {
  NormalizedSalesOrderRecord,
  SalesOrderGridRow,
  SalesOrderMetricDefinition,
  SalesOrderMetrics,
  SalesOrderMonthlyTimelinePoint,
  SalesOrderRulesAuditResult,
  SalesOrderRulesBuildInput,
  SalesOrderRulesContext,
  SalesOrderRulesDateRole,
  SalesOrderRulesFilters,
  SalesOrderRulesMetricKey,
  SalesOrderRulesOrderInput,
  SalesOrderRulesResult,
  SalesOrderRulesScope,
} from "./salesOrderRulesEngine.types.js";

const MONTH_LABELS = [
  "Jan",
  "Fev",
  "Mar",
  "Abr",
  "Mai",
  "Jun",
  "Jul",
  "Ago",
  "Set",
  "Out",
  "Nov",
  "Dez",
] as const;

const METRIC_DEFINITIONS: SalesOrderMetricDefinition[] = [
  {
    key: "soldAmount",
    label: "Valor vendido",
    description:
      "Soma de SalesOrder.totalNetValue (valor líquido no header) dos pedidos no universo filtrado. Não soma linhas de item.",
    valueField: "totalNetValue",
    dateField: "issueDate",
    includes: ["Pedidos no filtro de emissão"],
    excludes: ["Linhas de item duplicadas", "Valor de NF-e fiscal global"],
    dateBasisNote: "Sempre issueDate — nunca data de NF ou entrega para valor vendido.",
  },
  {
    key: "netAmount",
    label: "Valor líquido",
    description: "Alias de soldAmount — totalNetValue agregado no header do pedido.",
    valueField: "totalNetValue",
    dateField: "issueDate",
    includes: ["Header totalNetValue"],
    excludes: [],
  },
  {
    key: "invoicedAmount",
    label: "Valor faturado vinculado",
    description:
      "Soma de invoicedValue por pedido — NF-e vinculada via SalesOrderNfeLink / motor linked NFe. Evita duplicidade contando uma vez por pedido.",
    valueField: "invoicedValue",
    dateField: "nfe.dataProcessamento",
    includes: ["NF vinculada ao pedido"],
    excludes: ["NF fiscal global sem vínculo", "Duplicidade por múltiplas NF no mesmo pedido (soma controlada pelo motor linked)"],
  },
  {
    key: "soldInvoicedGap",
    label: "Gap vendido × faturado",
    description: "totalSoldValue − totalInvoicedValue usando motores oficiais de pedido e vínculo NF.",
    valueField: "derived",
    dateField: "mixed",
    includes: ["soldAmount", "invoicedAmount"],
    excludes: [],
  },
  {
    key: "totalOrders",
    label: "Total de pedidos",
    description:
      "Contagem de pedidos únicos (SalesOrder.id) no universo filtrado. Inclui cancelados se o filtro de status permitir.",
    valueField: "count",
    dateField: "issueDate",
    includes: ["Pedidos únicos"],
    excludes: ["Linhas de item", "Duplicidade por NF"],
  },
  {
    key: "averageTicket",
    label: "Ticket médio",
    description: "Valor vendido ÷ total de pedidos únicos (computeTicketAverage).",
    valueField: "derived",
    dateField: "issueDate",
    includes: ["Pedidos no filtro"],
    excludes: ["Média por item"],
  },
  {
    key: "totalItems",
    label: "Itens",
    description: "Soma de SalesOrder.totalItems (header) — quantidade de itens declarada no pedido, não linhas expandidas.",
    valueField: "totalItems",
    dateField: "issueDate",
    includes: ["Header totalItems"],
    excludes: ["Soma de quantity por linha (domínio produtos vendidos)"],
  },
  {
    key: "deliveredOnTimeCount",
    label: "Entregue no prazo",
    description:
      "Status logístico BI: NF processada com dataProcessamento ≤ expectedDeliveryDate.",
    valueField: "count",
    dateField: "nfe.dataProcessamento",
    includes: ["cardId deliveredOnTime"],
    excludes: [],
    dateBasisNote: "Motor único: buildSalesOrderBiLogisticStatus.",
  },
  {
    key: "ordersYtd",
    label: "Pedidos YTD",
    description:
      "Pedidos emitidos (issueDate) no acumulado do ano, excluindo CANCELLED — regra Relatório Executivo.",
    valueField: "count",
    dateField: "issueDate",
    includes: ["Pedidos não cancelados YTD"],
    excludes: ["CANCELLED", "ERROR"],
  },
  {
    key: "monthTarget",
    label: "Meta mês",
    description: "Mesmo mês ano anterior × 1,30 (computeGrowthTarget).",
    valueField: "derived",
    dateField: "issueDate",
    includes: ["Comparativo ano anterior"],
    excludes: [],
  },
];

function safeMoney(value: unknown): number {
  const n = decimalToNumber(value);
  if (n == null || !Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

export function normalizeSalesOrderListFilters(
  input: Partial<SalesOrderListFilters> = {}
): SalesOrderListFilters {
  return {
    status: input.status,
    customerId: input.customerId,
    responsible: input.responsible,
    startDate: input.startDate ?? null,
    endDate: input.endDate ?? null,
    year: input.year ?? null,
    month: input.month ?? null,
    q: input.q ?? null,
  };
}

export function normalizeSalesOrderManagementFilters(
  input: Partial<SalesOrderManagementFilters> = {},
  referenceDate: Date = new Date()
): SalesOrderManagementFilters {
  const year = input.allYears ? undefined : (input.year ?? referenceDate.getFullYear());
  return {
    year: input.allYears ? undefined : year,
    allYears: input.allYears,
    month: input.month,
    customerId: input.customerId,
    responsible: input.responsible,
    companyIssuer: input.companyIssuer,
    operationalStatus: input.operationalStatus ?? "",
    deadlineStatus: input.deadlineStatus,
    billingStatus: input.billingStatus,
    hasInvoice: input.hasInvoice ?? null,
    hasProductionOrder: input.hasProductionOrder ?? null,
    productionLate: input.productionLate ?? null,
    completionStatus: input.completionStatus,
    withRisk: input.withRisk ?? null,
    overdueOnly: input.overdueOnly ?? null,
    invoiceAfterDeadline: input.invoiceAfterDeadline ?? null,
    partialOrCut: input.partialOrCut ?? null,
    noProductionOrder: input.noProductionOrder ?? null,
    managementStatus: input.managementStatus ?? "",
    logisticStatus: input.logisticStatus ?? "",
    startDate: input.startDate ?? null,
    endDate: input.endDate ?? null,
    status: input.status,
    q: input.q,
    sortBy: input.sortBy,
    sortDir: input.sortDir,
    marginStatus: input.marginStatus ?? "",
    deliveryYear: input.deliveryYear,
    deliveryMonth: input.deliveryMonth,
    deliveryStartDate: input.deliveryStartDate,
    deliveryEndDate: input.deliveryEndDate,
    nfeYear: input.nfeYear,
    nfeMonth: input.nfeMonth,
    nfeStartDate: input.nfeStartDate,
    nfeEndDate: input.nfeEndDate,
    invoiceCoverage: input.invoiceCoverage,
    needsDataReview: input.needsDataReview ?? null,
    invoiceNumber: input.invoiceNumber,
    hasCut: input.hasCut ?? null,
    slaStatus: input.slaStatus,
    prazoFilter: input.prazoFilter,
    fulfillmentFilter: input.fulfillmentFilter,
  };
}

export function buildSalesOrderRulesContext(
  input: SalesOrderRulesBuildInput = {}
): SalesOrderRulesContext {
  const referenceDate = input.referenceDate ?? new Date();
  const today = startOfCivilDate(referenceDate);
  const year = input.year ?? referenceDate.getFullYear();
  const month = input.month ?? referenceDate.getMonth() + 1;
  const ytdStart = new Date(year, 0, 1, 0, 0, 0, 0);
  const isCurrentYear = year === referenceDate.getFullYear();
  const ytdEnd = isCurrentYear
    ? today
    : new Date(year, 11, 31, 23, 59, 59, 999);
  const monthStart = new Date(year, month - 1, 1, 0, 0, 0, 0);
  const monthEnd = new Date(year, month, 0, 23, 59, 59, 999);

  return {
    referenceDate,
    today,
    year,
    month,
    scope: input.scope ?? "unified",
    filters: {
      list: normalizeSalesOrderListFilters(input.listFilters),
      management: normalizeSalesOrderManagementFilters(input.managementFilters, referenceDate),
    },
    ytdStart,
    ytdEnd,
    monthStart,
    monthEnd,
    excludeCancelledExecutive: true,
  };
}

export function filterSalesOrderListRows(
  orders: SalesOrderRulesOrderInput[],
  filters: SalesOrderListFilters
): SalesOrderRulesOrderInput[] {
  const status = filters.status?.trim() ?? "";
  const customerId = filters.customerId?.trim() ?? "";
  const responsible = filters.responsible?.trim() ?? "";
  const periodRange = resolveSalesOrderIssueDateRange(filters.year ?? null, filters.month ?? null);

  return orders.filter((order) => {
    if (status && isValidSalesOrderListStatus(status) && order.status !== status) return false;
    if (customerId && order.customerId !== customerId) return false;
    if (responsible && (order.responsible ?? "").trim() !== responsible) return false;
    if (filters.startDate && order.issueDate.getTime() < filters.startDate.getTime()) return false;
    if (filters.endDate && order.issueDate.getTime() > filters.endDate.getTime()) return false;
    if (periodRange) {
      const t = order.issueDate.getTime();
      if (t < periodRange.gte.getTime() || t >= periodRange.lt.getTime()) return false;
    }
    return true;
  });
}

function toManagementOrderInput(order: SalesOrderRulesOrderInput) {
  return {
    id: order.id,
    orderCode: order.orderCode,
    status: order.status,
    issueDate: order.issueDate,
    expectedDeliveryDate: order.expectedDeliveryDate ?? null,
    totalNetValue: order.totalNetValue,
    responsible: order.responsible ?? null,
    nomusRawResponse: order.nomusRawResponse ?? null,
    companyIssuer: order.companyIssuer ?? null,
    Customer: order.Customer,
    items: order.items.map((item) => ({
      id: item.id,
      externalProductId: item.externalProductId,
      skuSnapshot: item.skuSnapshot,
      productNameSnapshot: item.productNameSnapshot,
      quantity: item.quantity,
    })),
  };
}

export function normalizeSalesOrderRecord(
  order: SalesOrderRulesOrderInput,
  row: SalesOrderManagementRow | null,
  linkedNfeContext?: SalesOrderLinkedNfeContext | null,
  referenceDate: Date = new Date()
): NormalizedSalesOrderRecord {
  const logistic =
    row ??
    (() => {
      const status = buildSalesOrderBiLogisticStatus({
        expectedDeliveryDate: order.expectedDeliveryDate,
        nomusRawResponse: order.nomusRawResponse,
        linkedNfeContext: linkedNfeContext ?? null,
        totalNetValue: order.totalNetValue,
        referenceDate,
      });
      return {
        logisticStatusCardId: status.cardId,
        hasInvoice: linkedNfeContext?.hasNfe ?? false,
        invoicedValue: linkedNfeContext?.nfeTotalValue ?? 0,
        hasLinkedProductionOrder: false,
        marginSummary: order.marginSummary ?? null,
      } as Pick<
        SalesOrderManagementRow,
        "logisticStatusCardId" | "hasInvoice" | "invoicedValue" | "hasLinkedProductionOrder" | "marginSummary"
      >;
    })();

  return {
    id: order.id,
    orderCode: order.orderCode,
    status: order.status,
    issueDate: order.issueDate,
    issueDateCivilKey: toCivilDateKey(order.issueDate) ?? "",
    expectedDeliveryDate: order.expectedDeliveryDate ?? null,
    expectedDeliveryDateCivilKey: order.expectedDeliveryDate
      ? toCivilDateKey(order.expectedDeliveryDate)
      : null,
    totalNetValue: safeMoney(order.totalNetValue),
    totalGrossValue: safeMoney(order.totalGrossValue ?? order.totalNetValue),
    totalItems: Math.max(0, Math.trunc(order.totalItems ?? 0)),
    isCancelled: isCancelledSalesOrderStatus(order.status),
    hasNfe: row?.hasInvoice ?? logistic.hasInvoice ?? false,
    hasLinkedProductionOrder: row?.hasLinkedProductionOrder ?? false,
    logisticStatusCardId: row?.logisticStatusCardId ?? logistic.logisticStatusCardId ?? null,
    invoicedValue: row?.invoicedValue ?? logistic.invoicedValue ?? 0,
    marginSummary: row?.marginSummary ?? order.marginSummary ?? null,
  };
}

export function classifySalesOrderLogisticStatus(
  order: SalesOrderRulesOrderInput,
  linkedNfeContext: SalesOrderLinkedNfeContext | null | undefined,
  context: Pick<SalesOrderRulesContext, "referenceDate">
) {
  return buildSalesOrderBiLogisticStatus({
    expectedDeliveryDate: order.expectedDeliveryDate,
    nomusRawResponse: order.nomusRawResponse,
    linkedNfeContext: linkedNfeContext ?? null,
    totalNetValue: order.totalNetValue,
    referenceDate: context.referenceDate,
  });
}

export function classifySalesOrderInvoiceStatus(
  order: SalesOrderRulesOrderInput,
  linkedNfeContext: SalesOrderLinkedNfeContext | null | undefined
): "with_nfe" | "without_nfe" | "partial" {
  const ctx = linkedNfeContext;
  if (!ctx?.hasNfe) return "without_nfe";
  if (ctx.isPartiallyInvoiced) return "partial";
  return "with_nfe";
}

export function getSalesOrderDate(
  order: SalesOrderRulesOrderInput,
  dateRole: SalesOrderRulesDateRole
): Date | null {
  switch (dateRole) {
    case "issueDate":
      return startOfCivilDate(order.issueDate);
    case "expectedDeliveryDate":
      return order.expectedDeliveryDate ? startOfCivilDate(order.expectedDeliveryDate) : null;
    case "nfeProcessingDate":
    case "operationalDueDate":
      return order.expectedDeliveryDate ? startOfCivilDate(order.expectedDeliveryDate) : null;
    default:
      return null;
  }
}

function isExecutiveEligible(order: SalesOrderRulesOrderInput): boolean {
  return !isCancelledSalesOrderStatus(order.status);
}

function aggregateExecutivePeriod(
  orders: SalesOrderRulesOrderInput[],
  start: Date,
  end: Date
): { count: number; soldAmount: number } {
  let count = 0;
  let soldAmount = 0;
  for (const order of orders) {
    if (!isExecutiveEligible(order)) continue;
    const t = order.issueDate.getTime();
    if (t < start.getTime() || t > end.getTime()) continue;
    count += 1;
    soldAmount += safeMoney(order.totalNetValue);
  }
  return { count, soldAmount: roundMoney(soldAmount) };
}

export function buildSalesOrderMonthlyTimeline(
  orders: SalesOrderRulesOrderInput[],
  year: number
): SalesOrderMonthlyTimelinePoint[] {
  const points: SalesOrderMonthlyTimelinePoint[] = [];
  for (let m = 1; m <= 12; m += 1) {
    const range = resolveSalesOrderIssueDateRange(year, m)!;
    const end = new Date(range.lt.getTime() - 1);
    const agg = aggregateExecutivePeriod(orders, range.gte, end);
    points.push({
      year,
      month: m,
      monthLabel: MONTH_LABELS[m - 1]!,
      orderCount: agg.count,
      soldAmount: agg.soldAmount,
    });
  }
  return points;
}

export function buildSalesOrderGridRows(
  managementRows: SalesOrderManagementRow[],
  ordersById: Map<string, SalesOrderRulesOrderInput>
): SalesOrderGridRow[] {
  return managementRows.map((row) => {
    const order = ordersById.get(row.id);
    return {
      id: row.id,
      orderCode: row.orderCode,
      customerName: row.customerName ?? null,
      sellerName: row.sellerName ?? row.responsible,
      companyName: row.companyName ?? null,
      issueDate: row.issueDate ?? (order ? toCivilDateKey(order.issueDate) : null),
      expectedDeliveryDate: row.expectedDeliveryDate,
      totalNetValue: roundMoney(row.totalNetValue),
      invoicedValue: roundMoney(row.invoicedValue),
      soldInvoicedGap: roundMoney(row.totalNetValue - row.invoicedValue),
      hasNfe: row.hasInvoice,
      hasLinkedProductionOrder: row.hasLinkedProductionOrder,
      logisticStatusCardId: row.logisticStatusCardId,
      logisticStatusLabel: row.logisticStatusLabel,
      completionStatus: row.completionStatus,
      hasCut: row.hasCut,
      needsDataReview: row.needsDataReview,
      marginSummary: row.marginSummary ?? order?.marginSummary ?? null,
    };
  });
}

export function explainSalesOrderMetric(
  metricName: SalesOrderRulesMetricKey | string
): SalesOrderMetricDefinition | null {
  return METRIC_DEFINITIONS.find((def) => def.key === metricName) ?? null;
}

export function listSalesOrderMetricDefinitions(): SalesOrderMetricDefinition[] {
  return [...METRIC_DEFINITIONS];
}

export function buildSalesOrderMetrics(input: {
  orders: SalesOrderRulesOrderInput[];
  context: SalesOrderRulesContext;
  listSummary: ReturnType<typeof summarizeSalesOrderListRows>;
  fulfillmentKpis: ReturnType<typeof buildFulfillmentKpis>;
  managementRows: SalesOrderManagementRow[];
}): SalesOrderMetrics {
  const { orders, context, listSummary, fulfillmentKpis, managementRows } = input;
  const { year, month, referenceDate } = context;

  const monthAgg = aggregateExecutivePeriod(orders, context.monthStart, context.monthEnd);
  const ytdAgg = aggregateExecutivePeriod(orders, context.ytdStart, context.ytdEnd);

  const prevYear = year - 1;
  const prevMonthStart = new Date(prevYear, month - 1, 1);
  const prevMonthEnd = new Date(prevYear, month, 0, 23, 59, 59, 999);
  const prevMonthAgg = aggregateExecutivePeriod(orders, prevMonthStart, prevMonthEnd);

  const prevYtdStart = new Date(prevYear, 0, 1);
  const prevYtdEnd =
    year === referenceDate.getFullYear()
      ? new Date(prevYear, referenceDate.getMonth(), referenceDate.getDate(), 23, 59, 59, 999)
      : new Date(prevYear, 11, 31, 23, 59, 59, 999);
  const prevYtdAgg = aggregateExecutivePeriod(orders, prevYtdStart, prevYtdEnd);

  let withOp = 0;
  let withoutOp = 0;
  let grossAmount = 0;
  for (const row of managementRows) {
    if (row.hasLinkedProductionOrder) withOp += 1;
    else withoutOp += 1;
  }
  for (const order of filterSalesOrderListRows(orders, context.filters.list)) {
    grossAmount += safeMoney(order.totalGrossValue ?? order.totalNetValue);
  }

  const workdaysElapsed = countWorkdaysElapsedInYear(referenceDate);
  const dailyAvg = computeYtdDailyAverageByWorkday(ytdAgg.soldAmount, workdaysElapsed);
  const monthProjection = computeMonthProjection(
    dailyAvg,
    countWorkdaysInMonth(year, month - 1)
  );
  const monthTarget = computeGrowthTarget(prevMonthAgg.soldAmount);
  const ytdTarget = computeGrowthTarget(prevYtdAgg.soldAmount);

  return {
    totalOrders: listSummary.totalOrders,
    filteredOrders: listSummary.totalOrders,
    uniqueOrders: listSummary.totalOrders,
    soldAmount: roundMoney(listSummary.totalNetAmount),
    netAmount: roundMoney(listSummary.totalNetAmount),
    grossAmount: roundMoney(grossAmount),
    totalItems: listSummary.totalItems,
    averageTicket: listSummary.averageTicket,
    invoicedAmount: roundMoney(fulfillmentKpis.totalInvoicedValue),
    soldInvoicedGap: roundMoney(fulfillmentKpis.soldInvoicedGap),
    withNfeCount: fulfillmentKpis.ordersWithNfe,
    withoutNfeCount: fulfillmentKpis.ordersWithoutNfe,
    withProductionOrderCount: withOp,
    withoutProductionOrderCount: withoutOp,
    deliveredOnTimeCount: fulfillmentKpis.deliveredOnTime,
    deliveredLateCount: fulfillmentKpis.deliveredLate,
    pendingOnTimeCount: fulfillmentKpis.pendingOnTime,
    pendingLateCount: fulfillmentKpis.pendingLate,
    partialCount: fulfillmentKpis.partialCount,
    withCutCount: fulfillmentKpis.withCutCount,
    reviewDataCount: fulfillmentKpis.needsReviewCount,
    averageSlaDays: fulfillmentKpis.averageSlaDays,
    onTimePercent: fulfillmentKpis.onTimePercent,
    ordersMonth: monthAgg.count,
    ordersYtd: ytdAgg.count,
    soldAmountMonth: monthAgg.soldAmount,
    soldAmountYtd: ytdAgg.soldAmount,
    soldAmountPreviousYearMonth: prevMonthAgg.soldAmount,
    soldAmountPreviousYearYtd: prevYtdAgg.soldAmount,
    monthProjection,
    monthTarget,
    ytdTarget,
  };
}

export function auditSalesOrderRules(result: SalesOrderRulesResult): SalesOrderRulesAuditResult {
  const warnings: string[] = [];
  const values = Object.values(result.metrics);
  const isFinite = values.every((v) => v == null || Number.isFinite(v));

  if (!isFinite) warnings.push("Métricas com NaN ou Infinity detectadas.");

  const listParityOk =
    Math.abs(result.metrics.soldAmount - result.listSummary.totalNetAmount) < 0.01 &&
    result.metrics.totalOrders === result.listSummary.totalOrders;

  const managementSoldSum = result.gridRows.reduce((sum, row) => sum + row.totalNetValue, 0);
  const managementParityOk =
    result.gridRows.length === 0 ||
    (Math.abs(result.fulfillmentKpis.totalSoldValue - managementSoldSum) < 0.01 &&
      Math.abs(result.fulfillmentKpis.totalInvoicedValue - result.metrics.invoicedAmount) < 0.01);

  if (!listParityOk) {
    warnings.push("Divergência entre metrics.soldAmount e listSummary.totalNetAmount.");
  }

  return {
    isFinite,
    warnings,
    metricsDocumented: result.metricDefinitions.length,
    managementRowsCount: result.gridRows.length,
    listParityOk,
    managementParityOk,
  };
}

/** Ponto de entrada principal — agrega lista, gestão, executivo e grid. */
export function buildSalesOrderRulesResult(
  orders: SalesOrderRulesOrderInput[],
  input: SalesOrderRulesBuildInput = {}
): SalesOrderRulesResult {
  const context = buildSalesOrderRulesContext(input);
  const linkedMap = input.linkedNfeContextMap;

  const listFiltered = filterSalesOrderListRows(orders, context.filters.list);
  const listSummary = summarizeSalesOrderListRows(
    listFiltered.map((o) => ({
      totalNetValue: o.totalNetValue,
      totalItems: o.totalItems,
    }))
  );

  const management = buildManagementRowsFromOrders(
    orders.map(toManagementOrderInput),
    context.filters.management,
    context.referenceDate,
    linkedMap
  );

  const metrics = buildSalesOrderMetrics({
    orders,
    context,
    listSummary,
    fulfillmentKpis: management.fulfillmentKpis,
    managementRows: management.rows,
  });

  const ordersById = new Map(orders.map((o) => [o.id, o]));
  const gridRows = buildSalesOrderGridRows(management.rows, ordersById);
  const monthlyTimeline = buildSalesOrderMonthlyTimeline(orders, context.year);

  const result: SalesOrderRulesResult = {
    engineVersion: SALES_ORDER_RULES_ENGINE_VERSION,
    generatedAt: context.referenceDate.toISOString(),
    referenceDate: context.today.toISOString(),
    context,
    metrics,
    listSummary,
    fulfillmentKpis: management.fulfillmentKpis,
    managementSummary: management.summary,
    managementBundle: {
      rows: management.rows,
      cards: management.cards,
      cardAmounts: management.cardAmounts,
      dashboardCards: management.dashboardCards,
      fulfillmentCharts: management.fulfillmentCharts,
    },
    monthlyTimeline,
    gridRows,
    metricDefinitions: listSalesOrderMetricDefinitions(),
    audit: {
      isFinite: true,
      warnings: [],
      metricsDocumented: 0,
      managementRowsCount: 0,
      listParityOk: true,
      managementParityOk: true,
    },
  };

  result.audit = auditSalesOrderRules(result);
  return result;
}

export function getSalesOrderValue(
  order: SalesOrderRulesOrderInput,
  row: SalesOrderManagementRow | null,
  metric: SalesOrderRulesMetricKey,
  context: SalesOrderRulesContext,
  linkedNfeContext?: SalesOrderLinkedNfeContext | null
): number {
  const normalized = normalizeSalesOrderRecord(order, row, linkedNfeContext, context.referenceDate);

  switch (metric) {
    case "soldAmount":
    case "netAmount":
      return normalized.totalNetValue;
    case "grossAmount":
      return normalized.totalGrossValue;
    case "invoicedAmount":
      return normalized.invoicedValue;
    case "soldInvoicedGap":
      return roundMoney(normalized.totalNetValue - normalized.invoicedValue);
    case "totalItems":
      return normalized.totalItems;
    case "totalOrders":
    case "filteredOrders":
    case "uniqueOrders":
      return 1;
    default:
      return 0;
  }
}

export {
  buildSalesOrderBiLogisticStatus,
  classifySalesOrderInvoiceStatus as classifySalesOrderInvoiceStatusFromLink,
};
