/**
 * Adapter fino — transforma o motor oficial de Margem de Venda para DTOs existentes.
 * Sem regra de negócio: resolução de custo (margin service) + mapeamento de payload.
 */
import type { PrismaClient } from "@prisma/client";
import { roundPricingMoney, roundPricingPercent } from "./pricingCalculations.js";
import { computeSalesOrderMarginCoverageFromItems } from "./salesOrderMarginCoverage.js";
import {
  buildSalesMarginRulesResult,
  SALES_MARGIN_RULES_ENGINE_VERSION,
  type SalesMarginItemResult,
  type SalesMarginOrderResult,
  type SalesMarginRulesBuildInput,
  type SalesMarginRulesOrderInput,
  type SalesMarginRulesResult,
  type SalesMarginTaxMode,
} from "./salesMarginRulesEngine.js";
import {
  refineSalesOrderMarginSummaryStatus,
  resolveSalesOrderMarginStatusMeta,
  resolveSalesOrderMarginSummaryStatusMeta,
} from "./salesOrderMarginStatus.js";
import {
  buildSalesOrderMarginContext,
  type SalesOrderForMargin,
  type SalesOrderMarginOrderResult,
} from "./salesOrderMarginService.server.js";
import type {
  SalesOrderCostSource,
  SalesOrderItemMarginPayload,
  SalesOrderMarginItemResult,
  SalesOrderMarginSummaryPayload,
} from "./salesOrderMarginTypes.js";
import {
  type SalesOrderResultComputedItem,
} from "./salesOrderResultMath.js";
import type {
  SalesOrderResultDashboardPayload,
  SalesOrderResultFilters,
  SalesOrderResultMonthlyRow,
  SalesOrderResultTotals,
} from "./salesOrderResultTypes.js";
import type { OfficialSalesOrderResultSalesBundle } from "./salesOrderRulesAdapter.js";
import type { CustomerIntelligenceOrderInput } from "./customerIntelligenceTypes.js";
import {
  loadSalesMarginNomusConfig,
  salesMarginNomusConfigToCostPolicy,
} from "./salesMarginNomusConfig.js";
import { resolveOfficialSalesMarginTaxContext } from "./salesMarginNomusTaxContext.server.js";

export const OFFICIAL_SM_RULES_SOURCE = "official-sales-margin-rules-engine" as const;

export type OfficialSalesMarginRulesBuildInput = SalesMarginRulesBuildInput & {
  taxMode?: SalesMarginTaxMode;
};

function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

/** Margem % agregada ponderada por receita — nunca média simples de %. */
export function computeWeightedMarginPercent(
  marginAmount: number,
  netRevenue: number
): number | null {
  if (!Number.isFinite(marginAmount) || !Number.isFinite(netRevenue) || netRevenue <= 0) {
    return null;
  }
  return roundPricingPercent((marginAmount / netRevenue) * 100);
}

export type OfficialScopedMarginMetrics = {
  grossSalesAmount: number;
  taxAmount: number;
  netSalesAmount: number;
  totalCost: number;
  marginAmount: number;
  marginPercent: number | null;
  missingCostCount: number;
  missingProductCount: number;
  negativeMarginCount: number;
  metricsSource: typeof OFFICIAL_SM_RULES_SOURCE;
  rulesEngineVersion: string;
  scopeNote: string;
  totalSalesRevenueInScope: number;
  marginRevenueCovered: number;
  marginRevenueUncovered: number;
  marginCoveragePercent: number | null;
  itemsTotal: number;
  itemsWithCost: number;
  itemsWithoutCost: number;
  costCoverageStatus: import("./salesOrderMarginTypes.js").SalesOrderMarginCostCoverageStatus;
};

export function resolveOfficialScopedMarginMetrics(
  rules: SalesMarginRulesResult
): OfficialScopedMarginMetrics {
  const m = rules.metrics;
  const coverageHint =
    m.costCoverageStatus === "PARTIAL"
      ? ` Margem parcial: calculada sobre ${m.marginRevenueCovered.toFixed(2)} de ${m.totalSalesRevenueInScope.toFixed(2)} vendidos (${m.marginCoveragePercent ?? 0}% da receita).`
      : m.costCoverageStatus === "NONE"
        ? " Nenhuma linha com custo — margem indisponível."
        : "";
  return {
    grossSalesAmount: m.grossSalesAmount,
    taxAmount: m.taxAmount,
    netSalesAmount: m.netSalesAmount,
    totalCost: m.totalCost,
    marginAmount: m.marginAmount,
    marginPercent: m.marginPercent,
    missingCostCount: m.missingCostCount,
    missingProductCount: m.missingProductCount,
    negativeMarginCount: m.negativeMarginCount,
    metricsSource: OFFICIAL_SM_RULES_SOURCE,
    rulesEngineVersion: rules.engineVersion,
    scopeNote:
      (rules.context.taxMode === "deductFromGross"
        ? "Margem gerencial agregada (receita líquida − custo; % ponderada por receita líquida)."
        : "Margem de pedidos agregada (% ponderada por receita vendida).") + coverageHint,
    totalSalesRevenueInScope: m.totalSalesRevenueInScope,
    marginRevenueCovered: m.marginRevenueCovered,
    marginRevenueUncovered: m.marginRevenueUncovered,
    marginCoveragePercent: m.marginCoveragePercent,
    itemsTotal: m.itemsCount,
    itemsWithCost: m.itemsWithCost,
    itemsWithoutCost: m.itemsWithoutCost,
    costCoverageStatus: m.costCoverageStatus,
  };
}

function mapEngineItemToMarginItemResult(item: SalesMarginItemResult): SalesOrderMarginItemResult {
  const meta = resolveSalesOrderMarginStatusMeta(item.status);
  const useSold = item.soldMarginAmount != null;
  return {
    salesOrderItemId: item.salesOrderItemId,
    productId: item.productId,
    productSku: item.productSku,
    productName: item.productName,
    quantity: item.quantity,
    netUnitRevenue:
      item.quantity > 0 ? roundMoney(item.grossSalesAmount / item.quantity) : null,
    netRevenue: item.grossSalesAmount,
    unitCost: item.unitCost,
    totalCost: item.totalCost,
    marginValue: useSold ? item.soldMarginAmount : item.marginAmount,
    marginPercent: useSold ? item.soldMarginPercent : item.marginPercent,
    markup: item.markup,
    status: item.status,
    statusLabel: meta.statusLabel,
    statusSeverity: meta.statusSeverity,
    costSource: item.costSource,
    costConfidence: item.costConfidence,
    notes: [...item.notes],
  };
}

function mapEngineItemToItemMarginPayload(item: SalesMarginItemResult): SalesOrderItemMarginPayload {
  const base = mapEngineItemToMarginItemResult(item);
  return {
    netRevenue: base.netRevenue,
    unitCost: base.unitCost,
    totalCost: base.totalCost,
    marginValue: base.marginValue,
    marginPercent: base.marginPercent,
    markup: base.markup,
    status: base.status,
    statusLabel: base.statusLabel,
    statusSeverity: base.statusSeverity,
    costSource: base.costSource,
    costConfidence: base.costConfidence,
    productResolutionSource: "LOCAL_PRODUCT_ID",
    notes: base.notes,
  };
}

function deriveCostSourceSummaryFromItems(
  items: SalesOrderMarginItemResult[]
): Pick<
  SalesOrderMarginSummaryPayload,
  "costSourceSummary" | "hasFrozenCost" | "hasEstimatedCost" | "hasMixedCost"
> {
  const frozenSources = new Set<SalesOrderCostSource>(["HISTORICAL_SNAPSHOT"]);
  const estimatedSources = new Set<SalesOrderCostSource>([
    "LIVE_PRODUCT_COST",
    "RECALCULATED_CURRENT_COST",
    "OFFICIAL_FINAL_COST",
    "CURRENT_ENGINEERING_COST",
    "CURRENT_COST",
    "MANUAL_COST",
  ]);

  let hasFrozenCost = false;
  let hasEstimatedCost = false;

  for (const item of items) {
    if (frozenSources.has(item.costSource)) hasFrozenCost = true;
    if (estimatedSources.has(item.costSource)) hasEstimatedCost = true;
  }

  let costSourceSummary = "Custo oficial resolvido";
  if (hasFrozenCost && hasEstimatedCost) costSourceSummary = "Custo misto";
  else if (hasFrozenCost) costSourceSummary = "Custo histórico congelado";
  else if (hasEstimatedCost) costSourceSummary = "Custo estimado atual";

  return {
    costSourceSummary,
    hasFrozenCost,
    hasEstimatedCost,
    hasMixedCost: hasFrozenCost && hasEstimatedCost,
  };
}

export function mapEngineOrderResultToMarginSummary(
  order: SalesMarginOrderResult,
  taxMode: SalesMarginTaxMode,
  fiscalMeta?: {
    taxRuleId?: string | null;
    taxRuleName?: string | null;
    taxRulePercent?: number | null;
    fiscalConfigComplete?: boolean;
  }
): SalesOrderMarginSummaryPayload {
  const netRevenue = taxMode === "deductFromGross" ? order.netSalesAmount : order.grossSalesAmount;
  const marginValue = order.marginAmount;
  const marginPercent =
    netRevenue > 0 ? roundPricingPercent((marginValue / netRevenue) * 100) : null;
  const status = refineSalesOrderMarginSummaryStatus(
    {
      itemsCount: order.itemsCount,
      validItemsCount: order.validItemsCount,
      ignoredItemsCount: order.ignoredItemsCount,
      netRevenue,
      totalCost: order.totalCost,
      marginValue,
      marginPercent,
      markup: order.markup,
      hasMissingCost: order.hasMissingCost,
      hasMissingProduct: order.hasMissingProduct,
      hasNegativeMargin: order.hasNegativeMargin,
      hasInvalidRevenue: order.hasInvalidRevenue,
    },
    order.items.map((item) => mapEngineItemToMarginItemResult(item))
  );
  const meta = resolveSalesOrderMarginSummaryStatusMeta(status);
  const mappedItems = order.items.map((item) => mapEngineItemToMarginItemResult(item));
  const coverage = computeSalesOrderMarginCoverageFromItems(mappedItems);
  const costMeta = deriveCostSourceSummaryFromItems(mappedItems);
  return {
    netRevenue,
    totalCost: order.totalCost,
    marginValue,
    marginPercent,
    markup: order.markup,
    itemsCount: order.itemsCount,
    validItemsCount: order.validItemsCount,
    ignoredItemsCount: order.ignoredItemsCount,
    hasMissingCost: order.hasMissingCost,
    hasMissingProduct: order.hasMissingProduct,
    hasNegativeMargin: order.hasNegativeMargin,
    hasInvalidRevenue: order.hasInvalidRevenue,
    status,
    statusLabel: meta.statusLabel,
    statusSeverity: meta.statusSeverity,
    taxMode,
    grossSalesAmount: order.grossSalesAmount,
    taxAmount: order.taxAmount,
    netSalesAmountAfterTax: order.netSalesAmount,
    taxRuleId: fiscalMeta?.taxRuleId ?? null,
    taxRuleName: fiscalMeta?.taxRuleName ?? null,
    taxRulePercent: fiscalMeta?.taxRulePercent ?? null,
    fiscalConfigComplete:
      fiscalMeta?.fiscalConfigComplete ??
      (taxMode === "none" || (order.taxAmount > 0 && (fiscalMeta?.taxRulePercent ?? 0) > 0)),
    ...costMeta,
    ...coverage,
  };
}

export function mapMarginContextToRulesOrders(
  orders: SalesOrderForMargin[],
  marginByOrder: Map<string, SalesOrderMarginOrderResult>,
  extra?: Partial<
    Pick<SalesMarginRulesOrderInput, "customerId" | "sellerId" | "companyId" | "issueDate" | "status" | "orderCode">
  >
): SalesMarginRulesOrderInput[] {
  return orders.map((order) => {
    const marginResult = marginByOrder.get(order.id);
    const orderExtra = order as SalesOrderForMargin & {
      customerId?: string | null;
      sellerId?: string | null;
      companyId?: string | null;
      issueDate?: Date | null;
      orderCode?: string;
      status?: string;
      responsible?: string | null;
    };
    return {
      id: order.id,
      orderCode: orderExtra.orderCode ?? extra?.orderCode,
      customerId: orderExtra.customerId ?? extra?.customerId,
      sellerId: orderExtra.sellerId ?? orderExtra.responsible ?? extra?.sellerId,
      companyId: orderExtra.companyId ?? extra?.companyId,
      issueDate: orderExtra.issueDate ?? extra?.issueDate,
      status: orderExtra.status ?? extra?.status,
      items: (marginResult?.itemResults ?? []).map((item) => ({
        salesOrderItemId: item.salesOrderItemId,
        orderId: order.id,
        productId: item.productId,
        productSku: item.productSku,
        productName: item.productName,
        quantity: item.quantity,
        netTotalValue: item.netRevenue,
        unitCost: item.unitCost,
        costSource: item.costSource,
        costConfidence: item.costConfidence,
        itemStatus: item.status,
        isCanceled: item.status === "ITEM_CANCELADO",
      })),
    };
  });
}

function mapRulesResultToMarginByOrder(
  rules: SalesMarginRulesResult,
  taxMode: SalesMarginTaxMode,
  extraFiscalMeta?: {
    taxRuleId?: string | null;
    taxRuleName?: string | null;
    taxRulePercent?: number | null;
    fiscalConfigComplete?: boolean;
  }
): Map<string, SalesOrderMarginOrderResult> {
  const taxCtx = rules.context.taxContext;
  const fiscalMeta = {
    taxRuleId: extraFiscalMeta?.taxRuleId ?? null,
    taxRuleName: extraFiscalMeta?.taxRuleName ?? taxCtx?.defaultTaxLabel ?? null,
    taxRulePercent: extraFiscalMeta?.taxRulePercent ?? taxCtx?.defaultTaxPercent ?? null,
    fiscalConfigComplete:
      extraFiscalMeta?.fiscalConfigComplete ??
      (taxMode === "none" ||
        !taxCtx?.defaultTaxLabel?.toLowerCase().includes("incompleta")),
  };
  const byOrderId = new Map<string, SalesOrderMarginOrderResult>();
  for (const order of rules.orderResults) {
    const itemResults = order.items.map((item) => {
      const mapped = mapEngineItemToMarginItemResult(item);
      if (taxMode === "deductFromGross") {
        mapped.netRevenue = item.netSalesAmount;
        mapped.marginValue = item.marginAmount;
        mapped.marginPercent = item.marginPercent;
      }
      return mapped;
    });
    const itemMargins = new Map<string, SalesOrderItemMarginPayload>();
    for (const item of order.items) {
      if (!item.salesOrderItemId) continue;
      const payload = mapEngineItemToItemMarginPayload(item);
      if (taxMode === "deductFromGross") {
        payload.netRevenue = item.netSalesAmount;
        payload.marginValue = item.marginAmount;
        payload.marginPercent = item.marginPercent;
      }
      itemMargins.set(item.salesOrderItemId, payload);
    }
    byOrderId.set(order.orderId, {
      marginSummary: mapEngineOrderResultToMarginSummary(order, taxMode, fiscalMeta),
      itemMargins,
      itemResults,
    });
  }
  return byOrderId;
}

/** Executa o motor oficial de Margem de Venda sobre pedidos com custo já resolvido. */
export function buildOfficialSalesMarginRulesResult(
  orders: SalesMarginRulesOrderInput[],
  input: OfficialSalesMarginRulesBuildInput = {}
): SalesMarginRulesResult & {
  metricsSource: typeof OFFICIAL_SM_RULES_SOURCE;
  rulesEngineVersion: string;
} {
  const result = buildSalesMarginRulesResult(orders, input);
  return {
    ...result,
    metricsSource: OFFICIAL_SM_RULES_SOURCE,
    rulesEngineVersion: SALES_MARGIN_RULES_ENGINE_VERSION,
  };
}

/** Carrega custos + config Nomus, executa motor oficial e retorna rules + margem por pedido. */
async function buildOfficialSalesMarginRulesForOrders(
  db: PrismaClient,
  orders: SalesOrderForMargin[],
  options?: Parameters<typeof buildSalesOrderMarginContext>[2] & {
    buildInput?: OfficialSalesMarginRulesBuildInput;
    costPolicy?: import("./salesOrderMarginTypes.js").SalesOrderMarginCostPolicy;
  }
): Promise<{
  rules: ReturnType<typeof buildOfficialSalesMarginRulesResult>;
  marginByOrder: Map<string, SalesOrderMarginOrderResult>;
  nomusConfig: Awaited<ReturnType<typeof loadSalesMarginNomusConfig>>["config"];
}> {
  const { config: nomusConfig } = await loadSalesMarginNomusConfig(db);
  const costPolicy =
    options?.costPolicy ?? salesMarginNomusConfigToCostPolicy(nomusConfig);

  const marginContext = await buildSalesOrderMarginContext(db, orders, {
    ...options,
    costPolicy,
  });
  const rulesOrders = mapMarginContextToRulesOrders(orders, marginContext.byOrderId);
  const taxMode = options?.buildInput?.taxMode ?? nomusConfig.taxMode;

  let taxContext = options?.buildInput?.taxContext;
  let officialTaxContext: Awaited<ReturnType<typeof resolveOfficialSalesMarginTaxContext>> | undefined;
  if (taxMode === "deductFromGross" && !taxContext) {
    const productIds = orders.flatMap((order) =>
      (order.items ?? [])
        .map((item) => item.productId)
        .filter((id): id is string => Boolean(id))
    );
    officialTaxContext = await resolveOfficialSalesMarginTaxContext(db, productIds, nomusConfig);
    taxContext = officialTaxContext;
  }

  const rules = buildOfficialSalesMarginRulesResult(rulesOrders, {
    ...options?.buildInput,
    taxMode,
    taxContext,
  });

  return {
    rules,
    marginByOrder: mapRulesResultToMarginByOrder(rules, taxMode, {
      taxRuleId: nomusConfig.defaultTaxRuleId,
      taxRuleName: taxContext?.defaultTaxLabel,
      taxRulePercent: taxContext?.defaultTaxPercent,
      fiscalConfigComplete:
        taxMode === "none" ||
        (officialTaxContext?.fiscalConfigComplete ??
          (taxContext != null &&
            !taxContext.defaultTaxLabel?.toLowerCase().includes("incompleta"))),
    }),
    nomusConfig,
  };
}

/** Carrega custos, executa motor oficial e retorna mapa por pedido (paridade com margin service). */
export async function calculateOfficialSalesOrderMarginsForOrders(
  db: PrismaClient,
  orders: SalesOrderForMargin[],
  options?: Parameters<typeof buildOfficialSalesMarginRulesForOrders>[2]
): Promise<Map<string, SalesOrderMarginOrderResult>> {
  if (orders.length === 0) return new Map();
  const { marginByOrder } = await buildOfficialSalesMarginRulesForOrders(db, orders, options);
  return marginByOrder;
}

export function mapRulesResultToResultComputedItems(
  rules: SalesMarginRulesResult
): SalesOrderResultComputedItem[] {
  const items: SalesOrderResultComputedItem[] = [];
  for (const order of rules.orderResults) {
    if (!order.issueDateCivilKey) continue;
    const issueMonth = Number(order.issueDateCivilKey.slice(5, 7));
    for (const item of order.items) {
      if (item.status === "ITEM_CANCELADO") continue;
      if (item.grossSalesAmount <= 0) continue;
      items.push({
        salesAmount: item.grossSalesAmount,
        taxAmount: item.taxAmount,
        netSalesAmount: item.netSalesAmount,
        costAmount: item.totalCost ?? 0,
        marginAmount: item.marginAmount ?? 0,
        marginPercent: item.marginPercent,
        quantity: item.quantity,
        orderId: order.orderId,
        issueMonth,
        marginStatus: item.status,
      });
    }
  }
  return items;
}

export function mapRulesResultToResultTotals(
  rules: SalesMarginRulesResult,
  salesBundle: OfficialSalesOrderResultSalesBundle,
  filters: Pick<SalesOrderResultFilters, "productId">
): SalesOrderResultTotals {
  const m = rules.metrics;
  const taxLabel = rules.context.taxContext?.defaultTaxLabel ?? "Imposto médio";
  const taxPercent = m.taxPercentApplied ?? rules.context.taxContext?.defaultTaxPercent ?? 0;

  const base: SalesOrderResultTotals = {
    salesAmount: m.grossSalesAmount,
    taxAmount: m.taxAmount,
    netSalesAmount: m.netSalesAmount,
    costAmount: m.totalCost,
    marginAmount: m.marginAmount,
    marginPercent: m.marginPercent,
    averageUnitMargin:
      m.validItemsCount > 0 ? roundMoney(m.marginAmount / m.validItemsCount) : null,
    ordersCount: rules.orderResults.length,
    itemsCount: m.itemsCount,
    totalQuantity: m.validItemsCount,
    missingCostCount: m.missingCostCount,
    missingProductCount: m.missingProductCount,
    negativeMarginCount: m.negativeMarginCount,
    taxPercentApplied: taxPercent,
    taxSourceLabel: m.taxSourceLabel ?? taxLabel,
  };

  if (filters.productId) {
    return {
      ...base,
      ordersCount: salesBundle.metrics.filteredOrders,
    };
  }

  return {
    ...base,
    salesAmount: salesBundle.metrics.soldAmount,
    ordersCount: salesBundle.metrics.filteredOrders,
    itemsCount: salesBundle.metrics.totalItems,
  };
}

export function mapRulesResultToMonthlyMargin(
  rules: SalesMarginRulesResult,
  year: number
): SalesOrderResultMonthlyRow[] {
  return rules.monthlyTimeline
    .filter((point) => point.year === year)
    .map((point) => ({
      month: point.month,
      monthLabel: point.monthLabel.toLowerCase(),
      salesAmount: point.grossSalesAmount,
      taxAmount: point.taxAmount,
      netSalesAmount: point.netSalesAmount,
      costAmount: point.totalCost,
      marginAmount: point.marginAmount,
      marginPercent: point.marginPercent,
      ordersCount: point.ordersCount,
    }));
}

/** Enriquece pedidos de inteligência do cliente com margem oficial (substitui campos Nomus). */
export async function enrichCustomerIntelligenceOrdersWithOfficialMargin(
  db: PrismaClient,
  orders: CustomerIntelligenceOrderInput[]
): Promise<CustomerIntelligenceOrderInput[]> {
  if (orders.length === 0) return orders;

  const orderIds = orders.map((order) => order.id);
  const dbOrders = await db.salesOrder.findMany({
    where: { id: { in: orderIds } },
    select: {
      id: true,
      nomusRawResponse: true,
      items: {
        select: {
          id: true,
          salesOrderId: true,
          productId: true,
          externalProductId: true,
          skuSnapshot: true,
          productNameSnapshot: true,
          quantity: true,
          negotiatedPrice: true,
          totalNetValue: true,
          unitCost: true,
        },
      },
    },
  });

  const marginByOrder = await calculateOfficialSalesOrderMarginsForOrders(db, dbOrders);

  return orders.map((order) => {
    const margin = marginByOrder.get(order.id);
    if (!margin) return order;
    const summary = margin.marginSummary;
    const itemsByItemId = new Map<string, SalesOrderMarginItemResult>();
    for (const item of margin.itemResults) {
      if (item.salesOrderItemId) itemsByItemId.set(item.salesOrderItemId, item);
    }
    return {
      ...order,
      totalMarginValue: summary.marginValue,
      totalMarginPerc: summary.marginPercent,
      marginRevenueCovered: summary.marginRevenueCovered,
      totalSalesRevenueInScope: summary.totalSalesRevenueInScope,
      costCoverageStatus: summary.costCoverageStatus,
      items: order.items.map((item) => {
        const official = item.id ? itemsByItemId.get(item.id) : undefined;
        if (!official) return item;
        return {
          ...item,
          marginValue: official.marginValue,
          marginPerc: official.marginPercent,
        };
      }),
    };
  });
}

export type OfficialCommercial360MarginMetrics = OfficialScopedMarginMetrics & {
  orderMargins: Array<{
    orderId: string;
    marginValue: number;
    marginPercent: number | null;
  }>;
};

export type Commercial360SalesOrderForOfficialMargin = {
  id: string;
  status: string;
  nomusRawResponse?: unknown;
  items?: Array<{
    id: string;
    productId?: string | null;
    quantity: unknown;
    totalNetValue?: unknown;
    [key: string]: unknown;
  }>;
};

function mapCommercial360OrdersToMarginInput(
  orders: Commercial360SalesOrderForOfficialMargin[]
): {
  forMargin: SalesOrderForMargin[];
  itemsByOrderId: Map<string, SalesOrderForMargin["items"]>;
} {
  const forMargin: SalesOrderForMargin[] = orders.map((order) => ({
    id: order.id,
    nomusRawResponse: order.nomusRawResponse,
    items: (order.items ?? []).map((item) => ({
      id: item.id,
      productId: item.productId,
      quantity: item.quantity,
      totalNetValue: item.totalNetValue,
    })),
  }));
  const itemsByOrderId = new Map(
    forMargin.map((order) => [order.id, order.items ?? []] as const)
  );
  return { forMargin, itemsByOrderId };
}

/** Enriquece pedidos do Cliente 360 com margem oficial e métricas agregadas (motor único). */
export async function loadOfficialCommercial360MarginBundle<
  T extends Commercial360SalesOrderForOfficialMargin,
>(
  db: PrismaClient,
  orders: T[]
): Promise<{
  salesOrders: Array<
    T & {
      marginSummary?: SalesOrderMarginSummaryPayload;
      items: Array<
        (T["items"] extends Array<infer I> ? I : never) & {
          officialMargin?: SalesOrderItemMarginPayload;
        }
      >;
    }
  >;
  officialMarginMetrics: OfficialCommercial360MarginMetrics;
}> {
  if (orders.length === 0) {
    return {
      salesOrders: [],
      officialMarginMetrics: {
        grossSalesAmount: 0,
        taxAmount: 0,
        netSalesAmount: 0,
        totalCost: 0,
        marginAmount: 0,
        marginPercent: null,
        missingCostCount: 0,
        missingProductCount: 0,
        negativeMarginCount: 0,
        metricsSource: OFFICIAL_SM_RULES_SOURCE,
        rulesEngineVersion: SALES_MARGIN_RULES_ENGINE_VERSION,
        scopeNote: "Margem de pedidos agregada (% ponderada por receita vendida).",
        orderMargins: [],
        totalSalesRevenueInScope: 0,
        marginRevenueCovered: 0,
        marginRevenueUncovered: 0,
        marginCoveragePercent: null,
        itemsTotal: 0,
        itemsWithCost: 0,
        itemsWithoutCost: 0,
        costCoverageStatus: "NONE",
      },
    };
  }

  const { forMargin, itemsByOrderId } = mapCommercial360OrdersToMarginInput(orders);
  const { rules, marginByOrder } = await buildOfficialSalesMarginRulesForOrders(db, forMargin, {
    itemsByOrderId,
  });
  const scoped = resolveOfficialScopedMarginMetrics(rules);

  const salesOrders = orders.map((order) => {
    const result = marginByOrder.get(order.id);
    if (!result) {
      return {
        ...order,
        marginSummary: undefined,
        items: (order.items ?? []).map((item) => ({ ...item })),
      };
    }
    return {
      ...order,
      marginSummary: result.marginSummary,
      items: (order.items ?? []).map((item) => ({
        ...item,
        officialMargin: result.itemMargins.get(item.id),
      })),
    };
  }) as Array<
    T & {
      marginSummary?: SalesOrderMarginSummaryPayload;
      items: Array<
        (T["items"] extends Array<infer I> ? I : never) & {
          officialMargin?: SalesOrderItemMarginPayload;
        }
      >;
    }
  >;

  return {
    salesOrders,
    officialMarginMetrics: {
      ...scoped,
      orderMargins: rules.orderResults.map((order) => ({
        orderId: order.orderId,
        marginValue: order.marginAmount,
        marginPercent: order.marginPercent,
      })),
    },
  };
}

/** Métricas de margem oficial para Cliente 360 (escopo: todos os pedidos do cliente). */
export async function resolveOfficialCommercial360MarginMetrics(
  db: PrismaClient,
  orders: Commercial360SalesOrderForOfficialMargin[]
): Promise<OfficialCommercial360MarginMetrics> {
  const { officialMarginMetrics } = await loadOfficialCommercial360MarginBundle(db, orders);
  return officialMarginMetrics;
}

export function buildOfficialSalesOrderResultMarginPayload(input: {
  rules: SalesMarginRulesResult;
  salesBundle: OfficialSalesOrderResultSalesBundle;
  filters: SalesOrderResultFilters;
}): Pick<
  SalesOrderResultDashboardPayload,
  "totals" | "monthlyMargin" | "warnings" | "source"
> {
  const totals = mapRulesResultToResultTotals(input.rules, input.salesBundle, input.filters);
  const monthlyMargin = mapRulesResultToMonthlyMargin(input.rules, input.filters.year);

  return {
    totals,
    monthlyMargin,
    warnings: {
      missingCostCount: totals.missingCostCount,
      missingProductCount: totals.missingProductCount,
      negativeMarginCount: totals.negativeMarginCount,
    },
    source: {
      sales: input.salesBundle.metricsSource,
      margin: OFFICIAL_SM_RULES_SOURCE,
      cost: "official-product-cost-engine",
      tax: "official-tax-rule-engine",
      projection: input.salesBundle.metricsSource,
    },
  };
}
