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
  aggregateSalesOrderMarginSummaries,
} from "./salesOrderMarginDisplay.js";
import {
  EMPTY_SALES_ORDER_LIST_MARGIN_SUMMARY,
  type SalesOrderListMarginSummary,
} from "./salesOrderListMarginSummary.js";
import { aggregateSalesOrderListCostBreakdown } from "./salesOrderListCostBreakdown.js";
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
  marginAmount: number | null;
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

function mapEngineItemToMarginItemResult(
  item: SalesMarginItemResult,
  productionCost?: import("./salesOrderMarginTypes.js").SalesOrderMarginProductionCostMeta | null
): SalesOrderMarginItemResult {
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
    productionCost: productionCost ?? null,
    notes: [...item.notes],
  };
}

function mapEngineItemToItemMarginPayload(
  item: SalesMarginItemResult,
  productionCost?: import("./salesOrderMarginTypes.js").SalesOrderMarginProductionCostMeta | null
): SalesOrderItemMarginPayload {
  const base = mapEngineItemToMarginItemResult(item, productionCost);
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
    productionCost: base.productionCost ?? null,
    notes: base.notes,
  };
}

function deriveCostSourceSummaryFromItems(
  items: SalesOrderMarginItemResult[]
): Pick<
  SalesOrderMarginSummaryPayload,
  "costSourceSummary" | "hasFrozenCost" | "hasEstimatedCost" | "hasMixedCost"
> {
  const frozenSources = new Set<SalesOrderCostSource>([
    "HISTORICAL_SNAPSHOT",
    "VERSIONED_PRODUCTION_COST",
  ]);
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

  let costSourceSummary = "Custo oficial — tabela de produção vigente";
  if (hasFrozenCost && hasEstimatedCost) costSourceSummary = "Custo misto";
  else if (hasFrozenCost) costSourceSummary = "Custo de produção IndusCost (tabela vigente)";
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
  const marginValue =
    order.marginAmount != null && Number.isFinite(order.marginAmount)
      ? order.marginAmount
      : null;
  const marginPercent =
    marginValue != null && netRevenue > 0
      ? roundPricingPercent((marginValue / netRevenue) * 100)
      : null;
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
  },
  originalMarginByOrder?: Map<string, SalesOrderMarginOrderResult>
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
    const originalItems = originalMarginByOrder?.get(order.orderId)?.itemResults ?? [];
    const productionCostByItemId = new Map(
      originalItems
        .filter((row) => row.salesOrderItemId)
        .map((row) => [row.salesOrderItemId!, row.productionCost ?? null] as const)
    );
    const commercialRefByItemId = new Map(
      [...(originalMarginByOrder?.get(order.orderId)?.itemMargins.entries() ?? [])].map(
        ([id, payload]) => [id, payload.commercialReference ?? null] as const
      )
    );

    const itemResults = order.items.map((item) => {
      const productionCost = item.salesOrderItemId
        ? productionCostByItemId.get(item.salesOrderItemId) ?? null
        : null;
      const mapped = mapEngineItemToMarginItemResult(item, productionCost);
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
      const productionCost = productionCostByItemId.get(item.salesOrderItemId) ?? null;
      const payload = mapEngineItemToItemMarginPayload(item, productionCost);
      if (taxMode === "deductFromGross") {
        payload.netRevenue = item.netSalesAmount;
        payload.marginValue = item.marginAmount;
        payload.marginPercent = item.marginPercent;
      }
      payload.commercialReference =
        commercialRefByItemId.get(item.salesOrderItemId) ?? payload.commercialReference ?? null;
      if (payload.commercialReference && taxMode === "deductFromGross") {
        payload.commercialReference = {
          ...payload.commercialReference,
          realizedMarginAmount: payload.marginValue,
          realizedMarginPercent: payload.marginPercent,
        };
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
    }, marginContext.byOrderId),
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
      issueDate: true,
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
  const { buildSalesOrderCommercialMarginReadModels } = await import(
    "./salesOrderCommercialMarginReadService.server.js"
  );
  const commercialByOrder = await buildSalesOrderCommercialMarginReadModels(
    db,
    dbOrders.map((order) => ({
      id: order.id,
      issueDate: order.issueDate,
      items: order.items,
    }))
  );

  return orders.map((order) => {
    const margin = marginByOrder.get(order.id);
    const commercial = commercialByOrder.get(order.id);
    if (!margin && !commercial) return order;
    const summary = margin?.marginSummary;
    const commercialSummary = commercial?.commercialMargin;
    const itemsByItemId = new Map<string, SalesOrderMarginItemResult>();
    for (const item of margin?.itemResults ?? []) {
      if (item.salesOrderItemId) itemsByItemId.set(item.salesOrderItemId, item);
    }
    const commercialItemById = new Map(
      (commercial?.items ?? []).map((item) => [item.itemId, item])
    );
    return {
      ...order,
      totalMarginValue:
        commercialSummary?.commercialMarginTotalValue ?? summary?.marginValue ?? null,
      totalMarginPerc:
        commercialSummary?.commercialMarginTotalPercent ?? summary?.marginPercent ?? null,
      marginRevenueCovered:
        commercialSummary?.commercialSoldTotalValue ??
        summary?.marginRevenueCovered ??
        null,
      totalSalesRevenueInScope:
        commercialSummary?.totalActiveSoldValue ??
        summary?.totalSalesRevenueInScope ??
        null,
      costCoverageStatus: commercialSummary
        ? commercialSummary.isComplete
          ? "FULL"
          : commercialSummary.itemsCalculated > 0
            ? "PARTIAL"
            : "NONE"
        : summary?.costCoverageStatus,
      items: order.items.map((item) => {
        const commercialItem = item.id ? commercialItemById.get(item.id) : undefined;
        if (commercialItem?.commercialMarginValue != null) {
          return {
            ...item,
            marginValue: commercialItem.commercialMarginValue,
            marginPerc: commercialItem.commercialMarginPercent,
          };
        }
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
  issueDate?: Date | string | null;
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
    issueDate: order.issueDate,
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
  let scoped = resolveOfficialScopedMarginMetrics(rules);

  // Overlay margem comercial canônica (não substitui gerencial secundária).
  try {
    const { buildSalesOrderCommercialMarginReadModels } = await import(
      "./salesOrderCommercialMarginReadService.server.js"
    );
    const { toCommercialMarginItemPayload, aggregateCommercialMarginPayloads } = await import(
      "./salesOrderCommercialMarginReadModel.js"
    );
    const commercialByOrder = await buildSalesOrderCommercialMarginReadModels(
      db,
      forMargin.map((order) => ({
        id: order.id,
        issueDate:
          order.issueDate instanceof Date
            ? order.issueDate
            : order.issueDate
              ? new Date(order.issueDate)
              : null,
        items: order.items ?? itemsByOrderId.get(order.id) ?? [],
      }))
    );
    const commercialPayloads: import("./salesOrderCommercialMargin.js").SalesOrderCommercialMarginSummaryPayload[] =
      [];
    for (const order of forMargin) {
      const result = marginByOrder.get(order.id);
      const commercial = commercialByOrder.get(order.id);
      if (!result?.marginSummary || !commercial) continue;
      const itemById = new Map(commercial.items.map((item) => [item.itemId, item]));
      result.marginSummary = {
        ...result.marginSummary,
        commercialMargin: commercial.commercialMargin,
      };
      for (const [itemId, payload] of result.itemMargins) {
        const itemDto = itemById.get(itemId);
        result.itemMargins.set(itemId, {
          ...payload,
          commercialMargin: itemDto ? toCommercialMarginItemPayload(itemDto) : null,
        });
      }
      commercialPayloads.push(commercial.commercialMargin);
    }
    const commercialAggregate =
      commercialPayloads.length > 0
        ? aggregateCommercialMarginPayloads(commercialPayloads)
        : null;
    if (commercialAggregate) {
      scoped = {
        ...scoped,
        marginAmount:
          commercialAggregate.commercialMarginTotalValue ?? scoped.marginAmount,
        marginPercent:
          commercialAggregate.commercialMarginTotalPercent ?? scoped.marginPercent,
        marginRevenueCovered: commercialAggregate.commercialSoldTotalValue,
        marginCoveragePercent:
          commercialAggregate.commercialMarginCoveragePercent,
        costCoverageStatus: commercialAggregate.isComplete
          ? "FULL"
          : commercialAggregate.itemsCalculated > 0
            ? "PARTIAL"
            : "NONE",
      };
    }
  } catch (err) {
    console.warn(
      "[loadOfficialCommercial360MarginBundle] falha na margem comercial canônica.",
      err
    );
  }

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
      scopeNote:
        "Margem comercial agregada (% ponderada por valor líquido coberto).",
      orderMargins: [...marginByOrder.entries()].map(([orderId, result]) => ({
        orderId,
        marginValue:
          result.marginSummary.commercialMargin?.commercialMarginTotalValue ??
          result.marginSummary.marginValue,
        marginPercent:
          result.marginSummary.commercialMargin?.commercialMarginTotalPercent ??
          result.marginSummary.marginPercent,
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
      cost: "versioned-production-cost-table",
      tax: "official-tax-rule-engine",
      projection: input.salesBundle.metricsSource,
    },
  };
}

/** Margem geral ponderada de todos os pedidos filtrados na listagem (não paginados). */
export async function buildOfficialSalesOrderListMarginSummary(
  db: PrismaClient,
  orders: SalesOrderForMargin[],
  options?: {
    year?: number;
    /**
     * População do gráfico mensal — deve ser anual canônica (sem filtros da tela).
     * Default = `orders` (retrocompat); a listagem passa a população year-only.
     */
    ordersForMonthlySeries?: SalesOrderForMargin[];
  }
): Promise<SalesOrderListMarginSummary> {
  const year =
    options?.year != null && Number.isFinite(options.year)
      ? options.year
      : new Date().getFullYear();
  const monthlyOrders = options?.ordersForMonthlySeries ?? orders;

  if (orders.length === 0 && monthlyOrders.length === 0) {
    return { ...EMPTY_SALES_ORDER_LIST_MARGIN_SUMMARY };
  }

  const { summarizeSalesOrderCommercialMargins } = await import(
    "./salesOrderCommercialMargin.js"
  );
  const { aggregateCommercialMarginPayloads, buildMonthlyCommercialMarginRows } = await import(
    "./salesOrderCommercialMarginReadModel.js"
  );
  let commercialAggregate = summarizeSalesOrderCommercialMargins([]);
  let monthlyCommercialMargin = buildMonthlyCommercialMarginRows([], year);

  // Card: regras + comercial na população filtrada (pode ser vazia).
  let rules: Awaited<ReturnType<typeof buildOfficialSalesMarginRulesForOrders>>["rules"] | null =
    null;
  let marginByOrder: Awaited<
    ReturnType<typeof buildOfficialSalesMarginRulesForOrders>
  >["marginByOrder"] = new Map();

  if (orders.length > 0) {
    const built = await buildOfficialSalesMarginRulesForOrders(db, orders);
    rules = built.rules;
    marginByOrder = built.marginByOrder;
  }

  try {
    const { buildSalesOrderCommercialMarginReadModels } = await import(
      "./salesOrderCommercialMarginReadService.server.js"
    );
    const { loadSalesOrderItemsForMargin } = await import(
      "./salesOrderMarginService.server.js"
    );

    const loadCommercialFor = async (batch: SalesOrderForMargin[]) => {
      if (batch.length === 0) return new Map();
      // Recarrega itens apenas dos pedidos que vieram sem eles.
      const idsMissingItems = batch
        .filter((order) => !order.items?.length)
        .map((order) => order.id);
      const loadedItems =
        idsMissingItems.length > 0
          ? await loadSalesOrderItemsForMargin(db, idsMissingItems)
          : null;
      return buildSalesOrderCommercialMarginReadModels(
        db,
        batch.map((order) => ({
          id: order.id,
          issueDate:
            order.issueDate instanceof Date
              ? order.issueDate
              : order.issueDate
                ? new Date(order.issueDate)
                : null,
          items: order.items?.length
            ? order.items
            : (loadedItems?.get(order.id) ?? []),
        }))
      );
    };

    if (orders.length > 0) {
      const commercialByOrder = await loadCommercialFor(orders);
      const commercialPayloads = [];
      for (const order of orders) {
        const result = marginByOrder.get(order.id);
        const commercial = commercialByOrder.get(order.id);
        if (!result?.marginSummary || !commercial) continue;
        result.marginSummary = {
          ...result.marginSummary,
          commercialMargin: commercial.commercialMargin,
        };
        commercialPayloads.push(commercial.commercialMargin);
      }
      if (commercialPayloads.length > 0) {
        commercialAggregate = aggregateCommercialMarginPayloads(commercialPayloads);
      }
    }

    const monthlySameAsCard =
      monthlyOrders === orders ||
      (monthlyOrders.length === orders.length &&
        monthlyOrders.every((o, i) => o.id === orders[i]?.id));

    if (monthlySameAsCard && orders.length > 0) {
      const monthlyInputs = orders.map((order) => {
        const commercial = marginByOrder.get(order.id)?.marginSummary?.commercialMargin;
        return {
          issueDate:
            order.issueDate instanceof Date
              ? order.issueDate
              : order.issueDate
                ? new Date(order.issueDate)
                : null,
          commercialMargin: commercial ?? null,
        };
      });
      monthlyCommercialMargin = buildMonthlyCommercialMarginRows(monthlyInputs, year);
    } else if (monthlyOrders.length > 0) {
      const commercialByMonthly = await loadCommercialFor(monthlyOrders);
      const monthlyInputs = monthlyOrders.map((order) => ({
        issueDate:
          order.issueDate instanceof Date
            ? order.issueDate
            : order.issueDate
              ? new Date(order.issueDate)
              : null,
        commercialMargin:
          commercialByMonthly.get(order.id)?.commercialMargin ?? null,
      }));
      monthlyCommercialMargin = buildMonthlyCommercialMarginRows(monthlyInputs, year);
    }
  } catch (err) {
    console.warn(
      "[buildOfficialSalesOrderListMarginSummary] falha na margem comercial; usando gerencial.",
      err
    );
  }

  if (orders.length === 0 || !rules) {
    return {
      ...EMPTY_SALES_ORDER_LIST_MARGIN_SUMMARY,
      monthlyCommercialMargin,
    };
  }

  const scoped = resolveOfficialScopedMarginMetrics(rules);
  const perOrderSummaries = [...marginByOrder.values()].map((row) => row.marginSummary);
  const consolidated =
    aggregateSalesOrderMarginSummaries(perOrderSummaries) ??
    EMPTY_SALES_ORDER_LIST_MARGIN_SUMMARY.tooltipSummary;

  const commercialAvailable =
    commercialAggregate.itemsCalculated > 0 &&
    commercialAggregate.commercialMarginTotalPercent != null;

  const tooltipSummary: SalesOrderMarginSummaryPayload = {
    ...consolidated,
    taxMode: rules.context.taxMode,
    grossSalesAmount: scoped.grossSalesAmount,
    taxAmount: scoped.taxAmount,
    netSalesAmountAfterTax: scoped.netSalesAmount,
    taxRuleName: rules.context.taxContext?.defaultTaxLabel ?? scoped.taxSourceLabel,
    taxRulePercent: scoped.taxPercentApplied ?? rules.context.taxContext?.defaultTaxPercent ?? null,
    fiscalConfigComplete:
      rules.context.taxMode === "none" ||
      Boolean(rules.context.taxContext && scoped.taxSourceLabel),
    totalSalesRevenueInScope: scoped.totalSalesRevenueInScope,
    marginRevenueCovered: scoped.marginRevenueCovered,
    marginRevenueUncovered: scoped.marginRevenueUncovered,
    marginCoveragePercent: scoped.marginCoveragePercent,
    itemsTotal: scoped.itemsTotal,
    itemsWithCost: scoped.itemsWithCost,
    itemsWithoutCost: scoped.itemsWithoutCost,
    costCoverageStatus: scoped.costCoverageStatus,
    commercialMargin: commercialAggregate,
  };

  const ordersWithoutFullMargin = perOrderSummaries.filter((row) => {
    const commercial = row.commercialMargin;
    if (commercial) return !commercial.isComplete;
    return row.status !== "OK" || row.hasMissingCost || row.hasMissingProduct;
  }).length;

  const available = commercialAvailable || scoped.costCoverageStatus !== "NONE";
  const marginCoverage =
    commercialAggregate.itemsActive === 0
      ? scoped.costCoverageStatus
      : commercialAggregate.isComplete
        ? ("FULL" as const)
        : commercialAggregate.itemsCalculated > 0
          ? ("PARTIAL" as const)
          : ("NONE" as const);
  const costBreakdown = aggregateSalesOrderListCostBreakdown({
    marginByOrder: marginByOrder.values(),
    totalIndustrialCost: scoped.totalCost,
    taxAmount: scoped.taxAmount,
  });

  return {
    totalOrdersCount: orders.length,
    totalMarginValue: commercialAvailable
      ? (commercialAggregate.commercialMarginTotalValue ?? 0)
      : scoped.marginAmount,
    totalMarginPercentage: commercialAvailable
      ? commercialAggregate.commercialMarginTotalPercent
      : available
        ? scoped.marginPercent
        : null,
    totalManagerialNetRevenue: scoped.netSalesAmount,
    grossSalesAmount: scoped.grossSalesAmount,
    taxAmount: scoped.taxAmount,
    totalCost: scoped.totalCost,
    costBreakdown,
    marginCoverage,
    itemsWithoutCost: commercialAggregate.itemsUnavailable || scoped.itemsWithoutCost,
    ordersWithoutFullMargin,
    taxMode: rules.context.taxMode,
    taxRuleName: tooltipSummary.taxRuleName ?? scoped.taxSourceLabel,
    taxRate: tooltipSummary.taxRulePercent ?? scoped.taxPercentApplied,
    available,
    monthlyCommercialMargin,
    tooltipSummary,
  };
}
