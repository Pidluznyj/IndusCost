/**
 * Motor oficial de regras de Margem de Venda — fonte única server-side.
 *
 * Orquestra (não duplica):
 * - salesOrderMarginMath.ts — margem por item/pedido sobre receita vendida (PV/Gestão)
 * - salesOrderResultMath.ts + averageSalesTaxEngine.ts — receita líquida gerencial com imposto
 * - salesOrderMarginStatus.ts — status e elegibilidade de consolidação
 * - salesOrderMarginDisplay.ts — agregação ponderada multi-pedido
 * - financeCivilDate.ts — datas civis
 *
 * Modo invoiceBased: preparado no contrato; implementação completa depende do motor NF (futuro).
 * Não altera telas/endpoints existentes.
 */

import {
  computeNetSalesAmount,
  computeSalesTaxAmount,
  resolveItemSalesTaxPercent,
} from "./averageSalesTaxEngine.js";
import { startOfCivilDate, toCivilDateKey } from "./financeCivilDate.js";
import { resolveSalesOrderIssueDateRange } from "./salesOrderPeriodFilter.js";
import { roundPricingMoney, roundPricingPercent } from "./pricingCalculations.js";
import { aggregateSalesOrderMarginSummaries } from "./salesOrderMarginDisplay.js";
import {
  calculateSalesOrderItemMargin,
  calculateSalesOrderMarginSummary,
  naiveAverageMarginPercent,
} from "./salesOrderMarginMath.js";
import {
  computeSalesOrderResultItem,
  naiveAverageResultMarginPercent,
} from "./salesOrderResultMath.js";
import {
  isSalesOrderMarginConsolidationEligible,
  refineSalesOrderMarginSummaryStatus,
  resolveSalesOrderMarginStatusMeta,
} from "./salesOrderMarginStatus.js";
import type {
  SalesOrderMarginItemInput,
  SalesOrderMarginSummaryPayload,
} from "./salesOrderMarginTypes.js";
import type {
  SalesMarginAggregateResult,
  SalesMarginGridRow,
  SalesMarginItemResult,
  SalesMarginMetricDefinition,
  SalesMarginMonthlyTimelinePoint,
  SalesMarginOrderResult,
  SalesMarginRulesAuditResult,
  SalesMarginRulesBuildInput,
  SalesMarginRulesContext,
  SalesMarginRulesFilters,
  SalesMarginRulesItemInput,
  SalesMarginRulesMetricKey,
  SalesMarginRulesOrderInput,
  SalesMarginRulesResult,
  SalesMarginSourceMode,
  SalesMarginTaxMode,
} from "./salesMarginRulesEngine.types.js";

export const SALES_MARGIN_RULES_ENGINE_VERSION = "1.0.0";

export const SALES_MARGIN_RULES_ENGINE_NOTE =
  "Margem de Venda: receita = netTotalValue/netUnitPrice×qty; imposto = TaxRule (averageSalesTaxEngine); custo = unitCost×qty; margem gerencial = receita líquida − custo; % agregada ponderada por receita." as const;

export type {
  SalesMarginAggregateResult,
  SalesMarginGridRow,
  SalesMarginItemResult,
  SalesMarginMetricDefinition,
  SalesMarginMonthlyTimelinePoint,
  SalesMarginOrderResult,
  SalesMarginRulesAuditResult,
  SalesMarginRulesBuildInput,
  SalesMarginRulesContext,
  SalesMarginRulesFilters,
  SalesMarginRulesItemInput,
  SalesMarginRulesMetricKey,
  SalesMarginRulesOrderInput,
  SalesMarginRulesResult,
  SalesMarginSourceMode,
  SalesMarginTaxMode,
} from "./salesMarginRulesEngine.types.js";

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

const METRIC_DEFINITIONS: SalesMarginMetricDefinition[] = [
  {
    key: "grossSalesAmount",
    label: "Receita bruta vendida",
    description:
      "Valor vendido do item: netTotalValue ou quantidade × netUnitPrice (SalesOrderItem).",
    formula: "netTotalValue ?? quantity × netUnitPrice",
    includes: ["Itens não cancelados no filtro"],
    excludes: ["NF fiscal global sem modo invoiceBased"],
    source: ["salesOrderMarginMath.resolveNetRevenue"],
  },
  {
    key: "taxAmount",
    label: "Imposto estimado",
    description:
      "Imposto médio sobre venda via TaxRule/ProductPricing — nunca percentual hardcoded.",
    formula: "grossSalesAmount × taxPercent / 100",
    includes: ["taxMode deductFromGross"],
    excludes: ["taxMode none"],
    source: ["averageSalesTaxEngine.computeSalesTaxAmount"],
  },
  {
    key: "netSalesAmount",
    label: "Receita líquida gerencial",
    description: "Receita bruta vendida menos imposto estimado.",
    formula: "grossSalesAmount − taxAmount",
    includes: ["Base oficial da aba Resultado"],
    excludes: [],
    source: ["averageSalesTaxEngine.computeNetSalesAmount"],
  },
  {
    key: "totalCost",
    label: "Custo total",
    description: "Custo unitário oficial do produto × quantidade vendida.",
    formula: "unitCost × quantity",
    includes: ["Itens com custo resolvido"],
    excludes: ["Itens SEM_CUSTO"],
    source: ["salesOrderMarginMath.resolveCostFields"],
  },
  {
    key: "marginAmount",
    label: "Margem R$",
    description: "Receita líquida gerencial menos custo total.",
    formula: "netSalesAmount − totalCost",
    includes: ["Itens elegíveis à consolidação"],
    excludes: ["Cancelados", "Sem produto", "Sem custo"],
    source: ["salesOrderResultMath.computeSalesOrderResultItem"],
  },
  {
    key: "marginPercent",
    label: "% Margem",
    description: "Margem R$ dividida pela receita líquida gerencial do escopo.",
    formula: "marginAmount / netSalesAmount × 100",
    includes: ["Ponderada na agregação — nunca média simples de %"],
    excludes: ["netSalesAmount = 0"],
    source: ["salesOrderResultMath.aggregateSalesOrderResultTotals"],
  },
  {
    key: "markup",
    label: "Markup",
    description: "Receita líquida gerencial dividida pelo custo total.",
    formula: "netSalesAmount / totalCost",
    includes: ["Quando custo > 0"],
    excludes: [],
    source: ["salesOrderMarginMath.calculateSalesOrderItemMargin"],
  },
];

function toMarginItemInput(item: SalesMarginRulesItemInput): SalesOrderMarginItemInput {
  return {
    salesOrderItemId: item.salesOrderItemId,
    productId: item.productId,
    externalProductId: item.externalProductId,
    productSku: item.productSku,
    productCode: item.productCode,
    productName: item.productName,
    quantity: item.quantity,
    netUnitPrice: item.netUnitPrice,
    netTotalValue: item.netTotalValue,
    itemStatus: item.itemStatus,
    isCanceled: item.isCanceled,
    unitCost: item.unitCost,
    costSource: item.costSource,
    costConfidence: item.costConfidence,
  };
}

export function normalizeSalesMarginFilters(
  input: Partial<SalesMarginRulesFilters> = {}
): SalesMarginRulesFilters {
  return {
    year: input.year ?? null,
    month: input.month ?? null,
    startDate: input.startDate ?? null,
    endDate: input.endDate ?? null,
    customerId: input.customerId?.trim() || null,
    productId: input.productId?.trim() || null,
    sellerId: input.sellerId?.trim() || null,
    companyId: input.companyId?.trim() || null,
    orderId: input.orderId?.trim() || null,
    includeCanceled: input.includeCanceled ?? false,
  };
}

export function buildSalesMarginRulesContext(
  input: SalesMarginRulesBuildInput = {}
): SalesMarginRulesContext {
  const referenceDate = input.referenceDate ?? new Date();
  const today = startOfCivilDate(referenceDate);
  return {
    referenceDate,
    today,
    year: input.year ?? referenceDate.getFullYear(),
    month: input.month ?? referenceDate.getMonth() + 1,
    sourceMode: input.sourceMode ?? "orderBased",
    taxMode: input.taxMode ?? "deductFromGross",
    filters: normalizeSalesMarginFilters(input.filters),
    taxContext: input.taxContext,
  };
}

export function resolveSalesMarginTaxPercent(
  item: SalesMarginRulesItemInput,
  context: SalesMarginRulesContext
): number {
  if (context.taxMode === "none") return 0;
  if (item.taxPercent != null && Number.isFinite(item.taxPercent)) return item.taxPercent;
  if (!context.taxContext) return 0;
  return resolveItemSalesTaxPercent({
    productId: item.productId ?? null,
    productTaxIndex: context.taxContext.productTaxIndex,
    defaultTaxPercent: context.taxContext.defaultTaxPercent,
  });
}

export function resolveSalesMarginRevenue(
  item: SalesMarginRulesItemInput
): Pick<SalesMarginItemResult, "grossSalesAmount"> {
  const base = calculateSalesOrderItemMargin(toMarginItemInput(item));
  return { grossSalesAmount: base.netRevenue };
}

export function resolveSalesMarginProductCost(item: SalesMarginRulesItemInput): {
  unitCost: number | null;
  totalCost: number | null;
  costSource: SalesMarginItemResult["costSource"];
  costConfidence: SalesMarginItemResult["costConfidence"];
} {
  const base = calculateSalesOrderItemMargin(toMarginItemInput(item));
  return {
    unitCost: base.unitCost,
    totalCost: base.totalCost,
    costSource: base.costSource,
    costConfidence: base.costConfidence,
  };
}

export function calculateSalesMarginItem(
  item: SalesMarginRulesItemInput,
  context: SalesMarginRulesContext
): SalesMarginItemResult {
  if (context.sourceMode === "invoiceBased") {
    throw new Error(
      "sourceMode invoiceBased ainda não implementado — use orderBased ou integre motor NF-e."
    );
  }

  const base = calculateSalesOrderItemMargin(toMarginItemInput(item));
  const meta = resolveSalesOrderMarginStatusMeta(base.status);
  const taxPercent = resolveSalesMarginTaxPercent(item, context);
  const grossSalesAmount = base.netRevenue;
  const taxAmount =
    context.taxMode === "deductFromGross"
      ? computeSalesTaxAmount(grossSalesAmount, taxPercent)
      : 0;
  const netSalesAmount = computeNetSalesAmount(grossSalesAmount, taxAmount);

  const gerencialEligible =
    isSalesOrderMarginConsolidationEligible(base.status) || base.status === "MARGEM_NEGATIVA";

  let marginAmount: number | null = null;
  let marginPercent: number | null = null;

  if (gerencialEligible && base.totalCost != null) {
    const computed = computeSalesOrderResultItem({
      salesOrderItemId: item.salesOrderItemId ?? "",
      orderId: item.orderId ?? "",
      issueMonth: item.issueDate ? item.issueDate.getMonth() + 1 : 1,
      productId: item.productId ?? null,
      quantity: base.quantity,
      marginStatus: base.status,
      salesAmount: grossSalesAmount,
      costAmount: base.totalCost,
      taxPercent,
    });
    marginAmount = computed.marginAmount;
    marginPercent = computed.marginPercent;
  }

  return {
    salesOrderItemId: item.salesOrderItemId,
    orderId: item.orderId,
    customerId: item.customerId ?? null,
    sellerId: item.sellerId ?? null,
    productId: base.productId,
    productSku: base.productSku,
    productName: base.productName,
    quantity: base.quantity,
    grossSalesAmount,
    taxAmount,
    taxPercentApplied: taxPercent,
    netSalesAmount,
    unitCost: base.unitCost,
    totalCost: base.totalCost,
    marginAmount,
    marginPercent,
    soldMarginAmount: base.marginValue,
    soldMarginPercent: base.marginPercent,
    markup: base.markup,
    status: base.status,
    statusLabel: meta.statusLabel,
    costSource: base.costSource,
    costConfidence: base.costConfidence,
    notes: [...base.notes],
  };
}

export function calculateSalesMarginOrder(
  order: SalesMarginRulesOrderInput,
  context: SalesMarginRulesContext
): SalesMarginOrderResult {
  const enrichedItems: SalesMarginRulesItemInput[] = order.items.map((item) => ({
    ...item,
    orderId: order.id,
    customerId: item.customerId ?? order.customerId,
    sellerId: item.sellerId ?? order.sellerId,
    issueDate: item.issueDate ?? order.issueDate ?? null,
  }));

  const items = enrichedItems.map((item) => calculateSalesMarginItem(item, context));
  const baseItems = enrichedItems.map((raw) =>
    calculateSalesOrderItemMargin(toMarginItemInput(raw))
  );

  const summary = calculateSalesOrderMarginSummary(baseItems);
  const status = refineSalesOrderMarginSummaryStatus(summary, baseItems);

  let grossSalesAmount = 0;
  let taxAmount = 0;
  let netSalesAmount = 0;
  let totalCost = 0;
  let marginAmount = 0;

  for (const item of items) {
    if (!isSalesOrderMarginConsolidationEligible(item.status) && item.status !== "MARGEM_NEGATIVA") {
      continue;
    }
    grossSalesAmount += item.grossSalesAmount;
    taxAmount += item.taxAmount;
    netSalesAmount += item.netSalesAmount;
    totalCost += item.totalCost ?? 0;
    marginAmount += item.marginAmount ?? 0;
  }

  grossSalesAmount = roundPricingMoney(grossSalesAmount);
  taxAmount = roundPricingMoney(taxAmount);
  netSalesAmount = roundPricingMoney(netSalesAmount);
  totalCost = roundPricingMoney(totalCost);
  marginAmount = roundPricingMoney(marginAmount);

  const marginPercent =
    netSalesAmount > 0 ? roundPricingPercent((marginAmount / netSalesAmount) * 100) : null;
  const markup = totalCost > 0 ? roundPricingMoney(netSalesAmount / totalCost) : null;

  return {
    orderId: order.id,
    orderCode: order.orderCode,
    customerId: order.customerId ?? null,
    sellerId: order.sellerId ?? null,
    issueDateCivilKey: order.issueDate ? toCivilDateKey(order.issueDate) : null,
    items,
    grossSalesAmount,
    taxAmount,
    netSalesAmount,
    totalCost,
    marginAmount,
    marginPercent,
    markup,
    itemsCount: summary.itemsCount,
    validItemsCount: summary.validItemsCount,
    ignoredItemsCount: summary.ignoredItemsCount,
    hasMissingCost: summary.hasMissingCost,
    hasMissingProduct: summary.hasMissingProduct,
    hasNegativeMargin: summary.hasNegativeMargin,
    hasInvalidRevenue: summary.hasInvalidRevenue,
    status,
  };
}

function emptyAggregate(): SalesMarginAggregateResult {
  return {
    grossSalesAmount: 0,
    taxAmount: 0,
    netSalesAmount: 0,
    totalCost: 0,
    marginAmount: 0,
    marginPercent: null,
    markup: null,
    ordersCount: 0,
    itemsCount: 0,
    validItemsCount: 0,
    missingCostCount: 0,
    missingProductCount: 0,
    negativeMarginCount: 0,
    taxPercentApplied: null,
    taxSourceLabel: null,
  };
}

export function aggregateSalesMargins(
  orderResults: SalesMarginOrderResult[],
  context: SalesMarginRulesContext
): SalesMarginAggregateResult {
  if (orderResults.length === 0) return emptyAggregate();

  const marginPayloads: SalesOrderMarginSummaryPayload[] = orderResults.map((order) => ({
    netRevenue: order.netSalesAmount,
    totalCost: order.totalCost,
    marginValue: order.marginAmount,
    marginPercent: order.marginPercent,
    markup: order.markup,
    itemsCount: order.itemsCount,
    validItemsCount: order.validItemsCount,
    ignoredItemsCount: order.ignoredItemsCount,
    hasMissingCost: order.hasMissingCost,
    hasMissingProduct: order.hasMissingProduct,
    hasNegativeMargin: order.hasNegativeMargin,
    hasInvalidRevenue: order.hasInvalidRevenue,
    status: order.status,
    statusLabel: "",
    statusSeverity: "neutral",
  }));

  const consolidated = aggregateSalesOrderMarginSummaries(marginPayloads);

  let grossSalesAmount = 0;
  let taxAmount = 0;
  let missingCostCount = 0;
  let missingProductCount = 0;
  let negativeMarginCount = 0;
  let itemsCount = 0;
  let validItemsCount = 0;

  for (const order of orderResults) {
    grossSalesAmount += order.grossSalesAmount;
    taxAmount += order.taxAmount;
    itemsCount += order.itemsCount;
    validItemsCount += order.validItemsCount;
    for (const item of order.items) {
      if (item.status === "SEM_CUSTO") missingCostCount += 1;
      if (item.status === "SEM_PRODUTO_VINCULADO") missingProductCount += 1;
      if (item.status === "MARGEM_NEGATIVA" || (item.marginAmount ?? 0) < 0) {
        negativeMarginCount += 1;
      }
    }
  }

  const taxPercentApplied =
    grossSalesAmount > 0
      ? roundPricingPercent((taxAmount / grossSalesAmount) * 100)
      : context.taxContext?.defaultTaxPercent ?? null;

  return {
    grossSalesAmount: roundPricingMoney(grossSalesAmount),
    taxAmount: roundPricingMoney(taxAmount),
    netSalesAmount: consolidated?.netRevenue ?? 0,
    totalCost: consolidated?.totalCost ?? 0,
    marginAmount: consolidated?.marginValue ?? 0,
    marginPercent:
      consolidated?.marginPercent != null
        ? roundPricingPercent(consolidated.marginPercent)
        : null,
    markup: consolidated?.markup ?? null,
    ordersCount: orderResults.length,
    itemsCount,
    validItemsCount,
    missingCostCount,
    missingProductCount,
    negativeMarginCount,
    taxPercentApplied,
    taxSourceLabel: context.taxContext?.defaultTaxLabel ?? null,
  };
}

function aggregateByKey(
  orderResults: SalesMarginOrderResult[],
  context: SalesMarginRulesContext,
  keyFn: (order: SalesMarginOrderResult) => string | null
): Map<string, SalesMarginAggregateResult> {
  const groups = new Map<string, SalesMarginOrderResult[]>();
  for (const order of orderResults) {
    const key = keyFn(order);
    if (!key) continue;
    const list = groups.get(key) ?? [];
    list.push(order);
    groups.set(key, list);
  }
  const result = new Map<string, SalesMarginAggregateResult>();
  for (const [key, orders] of groups) {
    result.set(key, aggregateSalesMargins(orders, context));
  }
  return result;
}

export function buildSalesMarginMonthlyTimeline(
  orderResults: SalesMarginOrderResult[],
  year: number
): SalesMarginMonthlyTimelinePoint[] {
  const points: SalesMarginMonthlyTimelinePoint[] = [];
  for (let m = 1; m <= 12; m += 1) {
    points.push({
      year,
      month: m,
      monthLabel: MONTH_LABELS[m - 1]!,
      grossSalesAmount: 0,
      taxAmount: 0,
      netSalesAmount: 0,
      totalCost: 0,
      marginAmount: 0,
      marginPercent: null,
      ordersCount: 0,
    });
  }

  const ordersByMonth = new Map<number, Set<string>>();

  for (const order of orderResults) {
    if (!order.issueDateCivilKey) continue;
    const month = Number(order.issueDateCivilKey.slice(5, 7));
    if (month < 1 || month > 12 || !order.issueDateCivilKey.startsWith(String(year))) continue;
    const point = points[month - 1]!;
    point.grossSalesAmount += order.grossSalesAmount;
    point.taxAmount += order.taxAmount;
    point.netSalesAmount += order.netSalesAmount;
    point.totalCost += order.totalCost;
    point.marginAmount += order.marginAmount;
    const monthOrders = ordersByMonth.get(month) ?? new Set<string>();
    monthOrders.add(order.orderId);
    ordersByMonth.set(month, monthOrders);
  }

  return points.map((point, index) => {
    const month = index + 1;
    point.grossSalesAmount = roundPricingMoney(point.grossSalesAmount);
    point.taxAmount = roundPricingMoney(point.taxAmount);
    point.netSalesAmount = roundPricingMoney(point.netSalesAmount);
    point.totalCost = roundPricingMoney(point.totalCost);
    point.marginAmount = roundPricingMoney(point.marginAmount);
    point.marginPercent =
      point.netSalesAmount > 0
        ? roundPricingPercent((point.marginAmount / point.netSalesAmount) * 100)
        : null;
    point.ordersCount = ordersByMonth.get(month)?.size ?? 0;
    return point;
  });
}

export function buildSalesMarginGridRows(
  orderResults: SalesMarginOrderResult[]
): SalesMarginGridRow[] {
  return orderResults.map((order) => ({
    orderId: order.orderId,
    orderCode: order.orderCode ?? null,
    customerId: order.customerId,
    sellerId: order.sellerId,
    issueDate: order.issueDateCivilKey,
    grossSalesAmount: order.grossSalesAmount,
    netSalesAmount: order.netSalesAmount,
    totalCost: order.totalCost,
    marginAmount: order.marginAmount,
    marginPercent: order.marginPercent,
    status: order.status,
    hasMissingCost: order.hasMissingCost,
    hasMissingProduct: order.hasMissingProduct,
    hasNegativeMargin: order.hasNegativeMargin,
  }));
}

export function classifySalesMarginStatus(
  result: Pick<SalesMarginItemResult, "status" | "marginAmount">
): SalesMarginItemResult["status"] {
  return result.status;
}

export function explainSalesMarginMetric(
  metricName: SalesMarginRulesMetricKey | string
): SalesMarginMetricDefinition | null {
  return METRIC_DEFINITIONS.find((def) => def.key === metricName) ?? null;
}

export function listSalesMarginMetricDefinitions(): SalesMarginMetricDefinition[] {
  return [...METRIC_DEFINITIONS];
}

export function auditSalesMarginRules(result: SalesMarginRulesResult): SalesMarginRulesAuditResult {
  const warnings: string[] = [];
  const values = [
    result.metrics.grossSalesAmount,
    result.metrics.taxAmount,
    result.metrics.netSalesAmount,
    result.metrics.totalCost,
    result.metrics.marginAmount,
    result.metrics.marginPercent,
  ];
  const isFinite = values.every((v) => v == null || Number.isFinite(v));
  if (!isFinite) warnings.push("Métricas com NaN ou Infinity detectadas.");

  const marginMathParityOk = result.orderResults.every((order) => {
    const baseSummary = calculateSalesOrderMarginSummary(
      order.items.map((item) =>
        calculateSalesOrderItemMargin(
          toMarginItemInput({
            quantity: item.quantity,
            netTotalValue: item.grossSalesAmount,
            unitCost: item.unitCost,
            productId: item.productId,
            costSource: item.costSource,
            costConfidence: item.costConfidence,
          })
        )
      )
    );
    return Math.abs(baseSummary.marginValue - order.items.reduce((s, i) => s + (i.soldMarginAmount ?? 0), 0)) < 0.02;
  });

  return {
    isFinite,
    warnings,
    metricsDocumented: result.metricDefinitions.length,
    orderResultsCount: result.orderResults.length,
    marginMathParityOk,
    resultMathParityOk: result.metrics.marginPercent != null || result.metrics.netSalesAmount === 0,
  };
}

function orderMatchesFilters(
  order: SalesMarginRulesOrderInput,
  filters: SalesMarginRulesFilters
): boolean {
  if (filters.orderId && order.id !== filters.orderId) return false;
  if (filters.customerId && order.customerId !== filters.customerId) return false;
  if (filters.sellerId && order.sellerId !== filters.sellerId) return false;
  if (filters.companyId && order.companyId !== filters.companyId) return false;
  if (!filters.includeCanceled && order.status === "CANCELLED") return false;

  const hasPeriodFilter =
    filters.year != null ||
    filters.month != null ||
    filters.startDate != null ||
    filters.endDate != null;

  if (!order.issueDate) {
    return !hasPeriodFilter;
  }

  if (filters.startDate && order.issueDate.getTime() < filters.startDate.getTime()) return false;
  if (filters.endDate && order.issueDate.getTime() > filters.endDate.getTime()) return false;

  const periodRange = resolveSalesOrderIssueDateRange(filters.year, filters.month);
  if (periodRange) {
    const t = order.issueDate.getTime();
    if (t < periodRange.gte.getTime() || t >= periodRange.lt.getTime()) return false;
  }

  return true;
}

/** Ponto de entrada principal — agrega pedidos, dimensões e timeline. */
export function buildSalesMarginRulesResult(
  orders: SalesMarginRulesOrderInput[],
  input: SalesMarginRulesBuildInput = {}
): SalesMarginRulesResult {
  const context = buildSalesMarginRulesContext(input);
  const filtered = orders.filter((order) => orderMatchesFilters(order, context.filters));

  const orderResults = filtered.map((order) => {
    const items = context.filters.productId
      ? order.items.filter((item) => item.productId === context.filters.productId)
      : order.items;
    return calculateSalesMarginOrder({ ...order, items }, context);
  });

  const metrics = aggregateSalesMargins(orderResults, context);
  const monthlyTimeline = buildSalesMarginMonthlyTimeline(orderResults, context.year);
  const gridRows = buildSalesMarginGridRows(orderResults);
  const byCustomer = aggregateByKey(orderResults, context, (o) => o.customerId);
  const bySeller = aggregateByKey(orderResults, context, (o) => o.sellerId);
  const byProduct = new Map<string, SalesMarginAggregateResult>();
  for (const order of orderResults) {
    for (const item of order.items) {
      if (!item.productId) continue;
      const key = item.productId;
      const existing = byProduct.get(key) ?? emptyAggregate();
      if (isSalesOrderMarginConsolidationEligible(item.status) || item.status === "MARGEM_NEGATIVA") {
        existing.grossSalesAmount = roundPricingMoney(existing.grossSalesAmount + item.grossSalesAmount);
        existing.taxAmount = roundPricingMoney(existing.taxAmount + item.taxAmount);
        existing.netSalesAmount = roundPricingMoney(existing.netSalesAmount + item.netSalesAmount);
        existing.totalCost = roundPricingMoney(existing.totalCost + (item.totalCost ?? 0));
        existing.marginAmount = roundPricingMoney(existing.marginAmount + (item.marginAmount ?? 0));
        existing.itemsCount += 1;
        existing.validItemsCount += 1;
      }
      byProduct.set(key, existing);
    }
  }
  for (const [key, agg] of byProduct) {
    agg.marginPercent =
      agg.netSalesAmount > 0
        ? roundPricingPercent((agg.marginAmount / agg.netSalesAmount) * 100)
        : null;
    agg.markup = agg.totalCost > 0 ? roundPricingMoney(agg.netSalesAmount / agg.totalCost) : null;
    byProduct.set(key, agg);
  }

  const result: SalesMarginRulesResult = {
    engineVersion: SALES_MARGIN_RULES_ENGINE_VERSION,
    generatedAt: context.referenceDate.toISOString(),
    referenceDate: context.today.toISOString(),
    context,
    metrics,
    orderResults,
    monthlyTimeline,
    byCustomer,
    bySeller,
    byProduct,
    gridRows,
    metricDefinitions: listSalesMarginMetricDefinitions(),
    audit: {
      isFinite: true,
      warnings: [],
      metricsDocumented: 0,
      orderResultsCount: 0,
      marginMathParityOk: true,
      resultMathParityOk: true,
    },
  };

  result.audit = auditSalesMarginRules(result);
  return result;
}

export {
  calculateSalesOrderItemMargin,
  computeSalesOrderResultItem,
  naiveAverageMarginPercent,
  naiveAverageResultMarginPercent,
};
