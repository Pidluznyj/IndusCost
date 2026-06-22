import { decimalToNumber } from "./executiveDashboardHelpers.js";
import { salesOrderHasInvoicing } from "./customerCommercialSalesOrderView.js";
import {
  aggregateMaterialUsageContributions,
  buildMaterialUsagePlannedRealizedSummary,
  createMaterialUsagePlannedRealizedDataQuality,
  extractProcessedNfeSummaries,
  PLANNED_REALIZED_FISCAL_VS_PRODUCTION_NOTE,
  PLANNED_REALIZED_MISSING_BOM_WARNING,
  PLANNED_REALIZED_MISSING_COST_WARNING,
  PLANNED_REALIZED_PARTIAL_INVOICE_FALLBACK_WARNING,
  PLANNED_REALIZED_REALIZED_BASIS_NOTE,
  salesOrderMatchesInvoicingScope,
} from "./materialDemandPlannedRealized.js";
import type { MaterialDemandFilters, MaterialDemandInvoicingScope } from "./materialDemandFilters.js";
import type { MaterialUsageContribution } from "./materialDemandPlannedRealizedTypes.js";
import { buildRawMaterialIntelligenceDetailLines } from "./materialDemandIntelligenceDrilldown.js";
import {
  classifyRawMaterialDemandItem,
  calculateRawMaterialDemandForItem,
  DEFAULT_RAW_MATERIAL_ESTIMATION_CONFIG,
  resolveInvoicedNetAmount,
  resolveInvoicedQuantity,
  resolveOpenNetAmount,
  resolveOpenQuantity,
  resolveSoldNetAmount,
  resolveSoldQuantity,
  safeFiniteNumber,
  safeNonNegativeNumber,
  type RawMaterialBomLine,
  type RawMaterialDemandOrderItemInput,
  type RawMaterialDemandStatus,
  type RawMaterialEstimationConfidence,
} from "./salesOrderRawMaterialEstimation.js";
import {
  extractNomusRawItems,
  extractNomusRawNfes,
  matchRawItemToDbItem,
  parseNomusBrOrIsoDate,
  resolveItemFulfilledQuantity,
  resolveItemInvoicedQuantity,
} from "./salesOrderNomusRaw.js";
import { normalizeSalesOrderItemNomusStatus } from "./salesOrderLifecycleStatus.js";
import type {
  MaterialDemandCalculationMode,
  MaterialDemandIntelligenceFilters,
  ProductBomExplosionRow,
  RawMaterialIntelligenceBlock,
  RawMaterialIntelligenceMaterialRow,
  RawMaterialIntelligenceOrderRow,
  RawMaterialIntelligenceReviewItem,
  RawMaterialIntelligenceUnservedBalanceRow,
  SalesOrderIntelligenceSourceOrder,
  SalesOrderRawMaterialIntelligencePayload,
} from "./salesOrderRawMaterialIntelligenceTypes.js";

export type {
  MaterialDemandCalculationMode,
  MaterialDemandIntelligenceFilters,
  ProductBomExplosionRow,
  RawMaterialIntelligenceBlock,
  SalesOrderIntelligenceSourceOrder,
  SalesOrderRawMaterialIntelligencePayload,
} from "./salesOrderRawMaterialIntelligenceTypes.js";

export const RAW_MATERIAL_INTELLIGENCE_RULES_VERSION = "2026-06-17";
export const RAW_MATERIAL_INTELLIGENCE_SOURCE =
  "SalesOrder + SalesOrderItem + nomusRawResponse.nfes + ProductBOM";

const PRODUCTION_STATUS_WARNING =
  "Não existe status real de produção no Nomus integrado a esta estimativa; o cálculo usa pedido, NF, saldo e janela de faturamento.";

export function parseMaterialDemandCalculationMode(raw: unknown): MaterialDemandCalculationMode {
  return raw === "conservative" ? "conservative" : "recommended";
}

export function parseMaterialDemandEstimationStatus(raw: unknown): RawMaterialDemandStatus | "ALL" {
  if (typeof raw !== "string" || !raw.trim()) return "ALL";
  const value = raw.trim() as RawMaterialDemandStatus;
  const allowed: Array<RawMaterialDemandStatus | "ALL"> = [
    "ALL",
    "FULLY_INVOICED",
    "OPEN_WITHIN_CYCLE",
    "OPEN_OVERDUE_WITHOUT_INVOICE",
    "PARTIALLY_INVOICED_LIVE_BALANCE",
    "PARTIALLY_INVOICED_STALE_BALANCE",
    "CRITICAL_UNSERVED_BALANCE_30D",
    "MISSING_BOM",
    "CANCELLED_OR_CLOSED",
    "REVIEW_DATA",
  ];
  return allowed.includes(value) ? value : "ALL";
}

export function buildMaterialDemandIntelligenceFilters(
  filters: MaterialDemandFilters,
  query: Record<string, unknown> = {}
): MaterialDemandIntelligenceFilters {
  const periodStart =
    (typeof query.periodStart === "string" && query.periodStart) ||
    filters.startDate ||
    null;
  const periodEnd =
    (typeof query.periodEnd === "string" && query.periodEnd) ||
    filters.endDate ||
    null;
  const sellerRaw =
    typeof query.seller === "string" && query.seller.trim()
      ? query.seller.trim()
      : typeof query.responsible === "string" && query.responsible.trim()
        ? query.responsible.trim()
        : null;

  return {
    periodStart,
    periodEnd,
    calculationMode: parseMaterialDemandCalculationMode(query.calculationMode),
    estimationStatus: parseMaterialDemandEstimationStatus(
      query.estimationStatus ?? query.status
    ),
    customerId: filters.customerId,
    productId: filters.productId,
    materialId: filters.materialId,
    seller: sellerRaw ?? filters.seller,
    search: filters.search,
  };
}

function round6(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 1_000_000) / 1_000_000;
}

function safeToIsoString(value: Date | null | undefined): string | null {
  if (!value || Number.isNaN(value.getTime())) return null;
  return value.toISOString();
}

function resolveLastInvoiceDate(nomusRawResponse: unknown): Date | null {
  const nfes = extractProcessedNfeSummaries(nomusRawResponse);
  let latest: Date | null = null;
  for (const nfe of nfes) {
    const parsed = parseNomusBrOrIsoDate(nfe.dataProcessamento);
    if (!parsed) continue;
    if (!latest || parsed.getTime() > latest.getTime()) latest = parsed;
  }
  return latest;
}

function resolveOrderInvoicedNetAmount(
  order: SalesOrderIntelligenceSourceOrder,
  itemNetAmount: number,
  soldQty: number,
  invoicedQty: number
): number {
  if (invoicedQty <= 0) return 0;
  if (soldQty > 0 && itemNetAmount > 0) {
    return safeNonNegativeNumber(itemNetAmount * Math.min(1, invoicedQty / soldQty));
  }
  const nfes = extractNomusRawNfes(order.nomusRawResponse);
  const totalInvoiced = nfes.reduce((sum, nfe) => sum + safeNonNegativeNumber(nfe.valor), 0);
  const orderNet = safeNonNegativeNumber(order.totalNetValue);
  if (orderNet > 0 && totalInvoiced > 0 && itemNetAmount > 0) {
    return safeNonNegativeNumber(itemNetAmount * Math.min(1, totalInvoiced / orderNet));
  }
  return 0;
}

function resolveAgingBucket(daysAfterLiveWindow: number): string {
  if (daysAfterLiveWindow <= 0) return "live";
  if (daysAfterLiveWindow <= DEFAULT_RAW_MATERIAL_ESTIMATION_CONFIG.staleBalanceDays) {
    return "stale";
  }
  if (daysAfterLiveWindow <= DEFAULT_RAW_MATERIAL_ESTIMATION_CONFIG.veryCriticalDays) {
    return "critical_30_60";
  }
  if (daysAfterLiveWindow <= DEFAULT_RAW_MATERIAL_ESTIMATION_CONFIG.probableLossDays) {
    return "critical_60_90";
  }
  return "probable_loss_90plus";
}

function resolveReviewSuggestedAction(status: RawMaterialDemandStatus): string {
  switch (status) {
    case "MISSING_BOM":
      return "Cadastrar ou revisar estrutura (BOM) do produto.";
    case "OPEN_OVERDUE_WITHOUT_INVOICE":
      return "Validar faturamento ou cancelamento do saldo em aberto.";
    case "PARTIALLY_INVOICED_STALE_BALANCE":
    case "CRITICAL_UNSERVED_BALANCE_30D":
      return "Revisar saldo parcial antigo antes de comprar matéria-prima.";
    case "REVIEW_DATA":
      return "Conferir dados do pedido e NF no Nomus.";
    default:
      return "Revisar item antes de incluir na compra recomendada.";
  }
}

function worstConfidence(
  current: RawMaterialEstimationConfidence,
  next: RawMaterialEstimationConfidence
): RawMaterialEstimationConfidence {
  const rank = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;
  return rank[next] > rank[current] ? next : current;
}

function mapToEstimationItemInput(params: {
  order: SalesOrderIntelligenceSourceOrder;
  item: SalesOrderIntelligenceSourceOrder["items"][number];
  itemIndex: number;
  totalItems: number;
  hasInvoicing: boolean;
  invoicedQuantity: number | null;
  lastInvoiceDate: Date | null;
  isItemCancelled: boolean;
}): RawMaterialDemandOrderItemInput {
  const soldQty = safeNonNegativeNumber(params.item.quantity);
  const itemNet = safeNonNegativeNumber(params.item.totalNetValue);
  const invoicedQty = params.invoicedQuantity ?? 0;
  const invoicedNet = resolveOrderInvoicedNetAmount(
    params.order,
    itemNet,
    soldQty,
    invoicedQty
  );

  return {
    itemId: params.item.id,
    orderId: params.order.id,
    orderNumber: params.order.orderCode,
    orderStatus: params.order.status,
    issueDate: params.order.issueDate,
    expectedDeliveryDate: params.order.expectedDeliveryDate,
    isCancelled: params.order.status === "CANCELLED" || params.order.status === "ERROR",
    isItemCancelled: params.isItemCancelled,
    productId: params.item.productId,
    productCode: params.item.skuSnapshot?.trim() || null,
    productName: params.item.productNameSnapshot?.trim() || null,
    quantity: soldQty,
    invoicedQuantity: params.invoicedQuantity,
    netAmount: itemNet,
    invoicedNetAmount: invoicedNet,
    hasInvoicing: params.hasInvoicing,
    lastInvoiceDate: params.lastInvoiceDate,
  };
}

function bomRowsToEstimationLines(rows: ProductBomExplosionRow[]): RawMaterialBomLine[] {
  return rows.map((row) => ({
    materialCode: row.materialCode ?? row.materialId,
    materialName: row.materialName,
    unit: row.unitLabel || row.unit || "—",
    quantityPerUnit: safeNonNegativeNumber(row.quantityPerUnit),
  }));
}

function matchesSellerFilter(order: SalesOrderIntelligenceSourceOrder, seller: string | null): boolean {
  if (!seller) return true;
  const responsible = order.responsible?.trim() || "";
  return responsible.toLowerCase() === seller.toLowerCase();
}

export function buildSalesOrderRawMaterialIntelligencePayload(input: {
  orders: SalesOrderIntelligenceSourceOrder[];
  productExplosions: Map<string, ProductBomExplosionRow[]>;
  filters: MaterialDemandFilters;
  intelligenceFilters: MaterialDemandIntelligenceFilters;
  invoicingScope?: MaterialDemandInvoicingScope;
  referenceDate?: Date;
  quantityByUnit?: Array<{ unitKey: string; unitLabel: string; totalQuantity: number }>;
  activeUnitKey?: string | null;
}): SalesOrderRawMaterialIntelligencePayload {
  const referenceDate = input.referenceDate ?? new Date();
  const config = DEFAULT_RAW_MATERIAL_ESTIMATION_CONFIG;
  const invoicingScope = input.invoicingScope ?? input.filters.invoicingScope ?? "all";
  const period = {
    start: input.intelligenceFilters.periodStart,
    end: input.intelligenceFilters.periodEnd,
  };

  const demandLines: ReturnType<typeof calculateRawMaterialDemandForItem> = [];
  const contributions: MaterialUsageContribution[] = [];
  const intelligenceOrders: RawMaterialIntelligenceOrderRow[] = [];
  const unservedBalances: RawMaterialIntelligenceUnservedBalanceRow[] = [];
  const reviewItems: RawMaterialIntelligenceReviewItem[] = [];
  const nfeByOrderId: Record<string, ReturnType<typeof extractProcessedNfeSummaries>> = {};

  let partialInvoiceFallbacks = 0;
  let missingBomItems = 0;
  let missingCosts = 0;
  let excludedFullyInvoicedCount = 0;
  let stalePartialBalanceCount = 0;
  const consideredOrderIds = new Set<string>();
  const consideredItemIds = new Set<string>();

  for (const order of input.orders) {
    if (!matchesSellerFilter(order, input.intelligenceFilters.seller)) continue;
    if (input.intelligenceFilters.customerId && order.customerName == null) {
      // customer filter handled at query level; keep defensive
    }

    const hasInvoicing = salesOrderHasInvoicing(order.nomusRawResponse);
    if (!salesOrderMatchesInvoicingScope(hasInvoicing, order.status, invoicingScope)) {
      continue;
    }

    const nfes = extractProcessedNfeSummaries(order.nomusRawResponse);
    if (nfes.length > 0) nfeByOrderId[order.id] = nfes;
    const lastInvoiceDate = resolveLastInvoiceDate(order.nomusRawResponse);
    const rawItems = extractNomusRawItems(order.nomusRawResponse);

    for (let itemIndex = 0; itemIndex < order.items.length; itemIndex++) {
      const item = order.items[itemIndex]!;
      try {
        if (input.intelligenceFilters.productId && item.productId !== input.intelligenceFilters.productId) {
          continue;
        }

        const soldQty = safeNonNegativeNumber(item.quantity);
        if (!(soldQty > 0)) continue;

        const raw = matchRawItemToDbItem(rawItems, item, {
          itemIndex,
          totalDbItems: order.items.length,
        });
        const normalizedStatus = normalizeSalesOrderItemNomusStatus(raw?.status ?? null);
        const fulfilledQuantity = resolveItemFulfilledQuantity(soldQty, raw, normalizedStatus);
        const invoicedQuantity = resolveItemInvoicedQuantity(
          soldQty,
          fulfilledQuantity,
          raw,
          hasInvoicing
        );
        const isItemCancelled = normalizedStatus === "cancelled";

        const hasPerItemInvoicedQty = raw?.quantidadeFaturada != null;
        const invoicedQtyForEstimation =
          hasPerItemInvoicedQty && raw?.quantidadeFaturada != null
            ? Math.min(soldQty, Math.max(0, raw.quantidadeFaturada))
            : hasInvoicing
              ? null
              : 0;

        const estimationItem = mapToEstimationItemInput({
          order,
          item,
          itemIndex,
          totalItems: order.items.length,
          hasInvoicing,
          invoicedQuantity: invoicedQtyForEstimation,
          lastInvoiceDate,
          isItemCancelled,
        });

        const explosion = input.productExplosions.get(item.productId) ?? [];
        const hasValidBom = explosion.length > 0;
        if (!hasValidBom) missingBomItems += 1;

        const classification = classifyRawMaterialDemandItem(
          {
            item: estimationItem,
            referenceDate,
            hasValidBom,
            period,
          },
          config
        );

        if (
          input.intelligenceFilters.estimationStatus !== "ALL" &&
          classification.status !== input.intelligenceFilters.estimationStatus
        ) {
          continue;
        }

        if (classification.status === "FULLY_INVOICED") {
          excludedFullyInvoicedCount += 1;
        }
        if (
          classification.status === "PARTIALLY_INVOICED_STALE_BALANCE" ||
          classification.status === "CRITICAL_UNSERVED_BALANCE_30D"
        ) {
          stalePartialBalanceCount += 1;
        }

        const openResolution = resolveOpenQuantity(estimationItem);
        if (openResolution.usedValueFallback) partialInvoiceFallbacks += 1;

        const soldQuantity = resolveSoldQuantity(estimationItem);
        const invoicedQtyResolved = resolveInvoicedQuantity(estimationItem).quantity;
        const openQuantity = resolveOpenQuantity(estimationItem).quantity;
        const soldNetAmount = resolveSoldNetAmount(estimationItem);
        const invoicedNetAmount = resolveInvoicedNetAmount(estimationItem);
        const openNetAmount = resolveOpenNetAmount(estimationItem);

        consideredOrderIds.add(order.id);
        consideredItemIds.add(item.id);

        intelligenceOrders.push({
          orderId: order.id,
          orderNumber: order.orderCode,
          customerName: order.customerName,
          sellerName: order.responsible,
          productCode: estimationItem.productCode,
          productName: estimationItem.productName,
          soldQuantity,
          invoicedQuantity: invoicedQtyResolved,
          openQuantity,
          soldNetAmount,
          invoicedNetAmount,
          openNetAmount,
          issueDate: safeToIsoString(order.issueDate) ?? "",
          expectedDeliveryDate: safeToIsoString(order.expectedDeliveryDate),
          lastInvoiceDate: classification.lastInvoiceDate?.toISOString() ?? null,
          estimatedWindowStart: classification.liveWindowStart?.toISOString() ?? null,
          estimatedWindowEnd: classification.liveWindowEnd?.toISOString() ?? null,
          daysAfterLiveWindow: classification.daysAfterLiveWindow,
          estimationStatus: classification.status,
          estimationStatusLabel: classification.statusLabel,
          factorUsed: classification.overlapFactor,
          recommendedIncluded: classification.includeInRecommended,
          conservativeIncluded: classification.includeInConservative,
          reviewRequired: classification.reviewRequired,
          warnings: classification.warnings,
        });

        if (classification.includeInUnservedRevenue) {
          unservedBalances.push({
            orderId: order.id,
            orderNumber: order.orderCode,
            customerName: order.customerName,
            sellerName: order.responsible,
            productCode: estimationItem.productCode,
            productName: estimationItem.productName,
            openQuantity,
            openNetAmount,
            issueDate: safeToIsoString(order.issueDate) ?? "",
            expectedDeliveryDate: safeToIsoString(order.expectedDeliveryDate),
            lastInvoiceDate: classification.lastInvoiceDate?.toISOString() ?? null,
            daysAfterLiveWindow: classification.daysAfterLiveWindow,
            agingBucket: resolveAgingBucket(classification.daysAfterLiveWindow),
            statusLabel: classification.statusLabel,
          });
        }

        if (classification.reviewRequired || classification.status === "MISSING_BOM") {
          const reason =
            classification.status === "MISSING_BOM"
              ? "Sem BOM"
              : classification.warnings[0] ?? classification.statusLabel;
          reviewItems.push({
            reason,
            orderId: order.id,
            orderNumber: order.orderCode,
            productCode: estimationItem.productCode,
            productName: estimationItem.productName,
            impact: openNetAmount > 0 ? `R$ ${round6(openNetAmount)} em saldo aberto` : "Sem valor estimado",
            suggestedAction: resolveReviewSuggestedAction(classification.status),
          });
        }

        const itemDemandLines = calculateRawMaterialDemandForItem(
          estimationItem,
          bomRowsToEstimationLines(explosion),
          config,
          period,
          referenceDate
        );
        demandLines.push(...itemDemandLines);

        const productSku = item.skuSnapshot?.trim() || null;
        const productName = item.productNameSnapshot?.trim() || "Produto";

        for (const bom of explosion) {
          if (input.filters.materialId && bom.materialId !== input.filters.materialId) continue;
          const textHaystack =
            `${bom.materialId} ${bom.materialCode ?? ""} ${bom.materialName} ${bom.unit ?? ""}`.toLowerCase();
          if (input.filters.search && !textHaystack.includes(input.filters.search)) continue;
          if (input.filters.unitKey && bom.unitKey !== input.filters.unitKey) continue;

          const qtyPerUnit = safeNonNegativeNumber(bom.quantityPerUnit);
          const realizedOrderQty = invoicedQtyResolved;
          const plannedOrderQty =
            input.intelligenceFilters.calculationMode === "conservative"
              ? openQuantity + invoicedQtyResolved
              : openQuantity * (classification.includeInRecommended ? 1 : 0) + invoicedQtyResolved;
          const missingCost = bom.unitCost == null && bom.valuePerUnit == null;
          if (missingCost) missingCosts += 1;

          contributions.push({
            materialId: bom.materialId,
            materialCode: bom.materialCode,
            materialDescription: bom.materialName,
            unit: bom.unit,
            unitKey: bom.unitKey,
            unitLabel: bom.unitLabel,
            orderId: order.id,
            orderCode: order.orderCode,
            orderStatus: order.status,
            issueDate: safeToIsoString(order.issueDate) ?? "",
            expectedDeliveryDate: safeToIsoString(order.expectedDeliveryDate),
            customerName: order.customerName,
            productId: item.productId,
            productSku,
            productName,
            productSoldUnit: item.unit?.trim() || null,
            materialQtyPerUnit: qtyPerUnit,
            valuePerUnit: bom.valuePerUnit,
            unitCost: bom.unitCost,
            plannedOrderQty: plannedOrderQty,
            realizedOrderQty,
            hasInvoicing,
            usedPartialInvoiceFallback: openResolution.usedValueFallback,
            missingCost,
            incompleteData: classification.confidence === "LOW",
          });
        }
      } catch (itemError) {
        reviewItems.push({
          reason: "Erro ao processar item",
          orderId: order.id,
          orderNumber: order.orderCode,
          productCode: item.skuSnapshot?.trim() || null,
          productName: item.productNameSnapshot?.trim() || null,
          impact: "Item excluído do cálculo automático",
          suggestedAction: "Revisar dados do pedido e tentar novamente.",
        });
        console.warn("Raw material intelligence item error:", itemError);
      }
    }
  }

  const materialAgg = new Map<string, RawMaterialIntelligenceMaterialRow>();
  let recommendedDemandQuantity = 0;
  let conservativeDemandQuantity = 0;
  let uncertaintyDemandQuantity = 0;
  let recommendedDemandValue = 0;
  let conservativeDemandValue = 0;
  let uncertaintyDemandValue = 0;
  let overallConfidence: RawMaterialEstimationConfidence = "HIGH";

  for (const line of demandLines) {
    recommendedDemandQuantity += safeNonNegativeNumber(line.recommendedDemand);
    conservativeDemandQuantity += safeNonNegativeNumber(line.conservativeDemand);
    uncertaintyDemandQuantity += safeNonNegativeNumber(line.uncertaintyDemand);
    overallConfidence = worstConfidence(overallConfidence, line.classification.confidence);

    const explosionMatch = [...input.productExplosions.values()]
      .flat()
      .find((row) => (row.materialCode ?? row.materialId) === line.materialCode);
    const unitCost = explosionMatch?.unitCost ?? null;
    const valuePerUnit = explosionMatch?.valuePerUnit ?? null;
    const unitValue =
      valuePerUnit ??
      (unitCost != null ? unitCost * safeNonNegativeNumber(explosionMatch?.quantityPerUnit) : 0);

    recommendedDemandValue += safeNonNegativeNumber(line.recommendedDemand) * safeNonNegativeNumber(unitValue);
    conservativeDemandValue += safeNonNegativeNumber(line.conservativeDemand) * safeNonNegativeNumber(unitValue);
    uncertaintyDemandValue += safeNonNegativeNumber(line.uncertaintyDemand) * safeNonNegativeNumber(unitValue);

    const materialId = explosionMatch?.materialId ?? line.materialCode;
    const existing =
      materialAgg.get(materialId) ??
      ({
        materialId,
        materialCode: explosionMatch?.materialCode ?? line.materialCode,
        materialName: line.materialName,
        unit: explosionMatch?.unit ?? line.unit,
        unitKey: explosionMatch?.unitKey ?? line.unit.toLowerCase(),
        unitLabel: explosionMatch?.unitLabel ?? line.unit,
        recommendedQuantity: 0,
        conservativeQuantity: 0,
        uncertaintyQuantity: 0,
        reviewQuantity: 0,
        recommendedValue: 0,
        conservativeValue: 0,
        relatedProductsCount: 0,
        relatedOrdersCount: 0,
        confidence: "HIGH" as RawMaterialEstimationConfidence,
        statusSummary: "",
      } satisfies RawMaterialIntelligenceMaterialRow);

    existing.recommendedQuantity += safeNonNegativeNumber(line.recommendedDemand);
    existing.conservativeQuantity += safeNonNegativeNumber(line.conservativeDemand);
    existing.uncertaintyQuantity += safeNonNegativeNumber(line.uncertaintyDemand);
    existing.reviewQuantity += safeNonNegativeNumber(line.reviewDemand);
    existing.recommendedValue += safeNonNegativeNumber(line.recommendedDemand) * safeNonNegativeNumber(unitValue);
    existing.conservativeValue += safeNonNegativeNumber(line.conservativeDemand) * safeNonNegativeNumber(unitValue);
    existing.confidence = worstConfidence(existing.confidence, line.classification.confidence);
    materialAgg.set(materialId, existing);
  }

  const materials = [...materialAgg.values()]
    .map((row) => {
      const relatedOrders = new Set(
        demandLines
          .filter((line) => line.materialCode === (row.materialCode ?? row.materialId))
          .map((line) => line.sourceOrderId)
      );
      const relatedProducts = new Set(
        demandLines
          .filter((line) => line.materialCode === (row.materialCode ?? row.materialId))
          .map((line) => line.productCode)
          .filter(Boolean)
      );
      return {
        ...row,
        recommendedQuantity: round6(row.recommendedQuantity),
        conservativeQuantity: round6(row.conservativeQuantity),
        uncertaintyQuantity: round6(row.uncertaintyQuantity),
        reviewQuantity: round6(row.reviewQuantity),
        recommendedValue: round6(row.recommendedValue),
        conservativeValue: round6(row.conservativeValue),
        relatedOrdersCount: relatedOrders.size,
        relatedProductsCount: relatedProducts.size,
        statusSummary:
          row.uncertaintyQuantity > 0
            ? "Inclui saldo com incerteza"
            : row.recommendedQuantity > 0
              ? "Saldo vivo"
              : "Sem demanda recomendada",
      };
    })
    .sort((a, b) => b.conservativeValue - a.conservativeValue || b.conservativeQuantity - a.conservativeQuantity);

  const unservedRevenuePotential = round6(
    unservedBalances.reduce((sum, row) => sum + safeNonNegativeNumber(row.openNetAmount), 0)
  );
  const criticalUnservedBalanceAmount = round6(
    unservedBalances
      .filter((row) => row.agingBucket === "critical_30_60" || row.agingBucket.startsWith("critical"))
      .reduce((sum, row) => sum + safeNonNegativeNumber(row.openNetAmount), 0)
  );

  const intelligenceSummary = {
    recommendedDemandQuantity: round6(recommendedDemandQuantity),
    conservativeDemandQuantity: round6(conservativeDemandQuantity),
    uncertaintyDemandQuantity: round6(uncertaintyDemandQuantity),
    recommendedDemandValue: round6(recommendedDemandValue),
    conservativeDemandValue: round6(conservativeDemandValue),
    uncertaintyDemandValue: round6(uncertaintyDemandValue),
    reviewItemsCount: reviewItems.length,
    missingBomCount: missingBomItems,
    criticalUnservedBalanceAmount,
    unservedRevenuePotential,
    confidence: overallConfidence,
    consideredOrdersCount: consideredOrderIds.size,
    consideredItemsCount: consideredItemIds.size,
    excludedFullyInvoicedCount,
    stalePartialBalanceCount,
  };

  const quantityByUnit = input.quantityByUnit ?? [];
  const hasMixedUnits = quantityByUnit.length > 1;
  const activeUnitKey = input.activeUnitKey ?? (quantityByUnit.length === 1 ? quantityByUnit[0]?.unitKey ?? null : null);
  const activeUnitBucket = activeUnitKey ? quantityByUnit.find((u) => u.unitKey === activeUnitKey) : null;
  const quantityTotalsComparable = activeUnitKey != null || !hasMixedUnits;

  const legacyRows = aggregateMaterialUsageContributions(contributions);
  const legacySummary = buildMaterialUsagePlannedRealizedSummary(legacyRows, {
    activeUnitKey,
    quantityTotalsComparable,
    activeUnitLabel: activeUnitBucket?.unitLabel ?? null,
    plannedOrdersCount: consideredOrderIds.size,
    realizedOrdersCount: intelligenceOrders.filter((row) => row.invoicedQuantity > 0).length,
  });

  const warnings = [
    PLANNED_REALIZED_REALIZED_BASIS_NOTE,
    PLANNED_REALIZED_FISCAL_VS_PRODUCTION_NOTE,
    PRODUCTION_STATUS_WARNING,
    "Estimativa recomendada considera saldo vivo (janela fiscal de 14 dias); saldos envelhecidos não entram automaticamente.",
  ];
  if (partialInvoiceFallbacks > 0) warnings.push(PLANNED_REALIZED_PARTIAL_INVOICE_FALLBACK_WARNING);
  if (missingBomItems > 0) warnings.push(PLANNED_REALIZED_MISSING_BOM_WARNING);
  if (missingCosts > 0) warnings.push(PLANNED_REALIZED_MISSING_COST_WARNING);

  const dataQuality = createMaterialUsagePlannedRealizedDataQuality({
    warnings,
    partialInvoiceFallbacks,
    missingBomItems,
    missingCosts,
  });

  const filtersApplied: Record<string, unknown> = {
    ...input.filters,
    periodStart: input.intelligenceFilters.periodStart,
    periodEnd: input.intelligenceFilters.periodEnd,
    calculationMode: input.intelligenceFilters.calculationMode,
    estimationStatus: input.intelligenceFilters.estimationStatus,
    seller: input.intelligenceFilters.seller,
  };

  const materialIdByCode = new Map<string, string>();
  for (const c of contributions) {
    if (c.materialCode) materialIdByCode.set(c.materialCode, c.materialId);
    materialIdByCode.set(c.materialId, c.materialId);
  }
  for (const row of materials) {
    if (row.materialCode) materialIdByCode.set(row.materialCode, row.materialId);
    materialIdByCode.set(row.materialId, row.materialId);
  }

  const detailLines = buildRawMaterialIntelligenceDetailLines({
    demandLines,
    orders: intelligenceOrders,
    contributions,
    unservedBalances,
    materialIdByCode,
  });

  const intelligence: RawMaterialIntelligenceBlock = {
    summary: intelligenceSummary,
    materials,
    orders: intelligenceOrders,
    unservedBalances,
    reviewItems,
    detailLines,
    orderNfesByOrderId: nfeByOrderId,
    audit: {
      source: RAW_MATERIAL_INTELLIGENCE_SOURCE,
      rulesVersion: RAW_MATERIAL_INTELLIGENCE_RULES_VERSION,
      billingCycleDays: config.billingCycleDays,
      partialBillingLiveDays: config.partialBillingLiveDays,
      staleBalanceDays: config.staleBalanceDays,
      filtersApplied,
      lastSyncInfo: null,
      warnings,
    },
  };

  return {
    filtersApplied,
    summary: legacySummary,
    rows: legacyRows,
    dataQuality,
    contributions,
    nfeByOrderId,
    intelligence,
  };
}

export function mapPrismaSalesOrderToIntelligenceSource(order: {
  id: string;
  orderCode: string;
  status: string;
  issueDate: Date;
  expectedDeliveryDate: Date | null;
  totalNetValue: unknown;
  responsible: string | null;
  nomusRawResponse: unknown;
  Customer?: { companyName?: string | null; tradeName?: string | null } | null;
  items: Array<{
    id: string;
    productId: string;
    externalProductId?: number | null;
    skuSnapshot?: string | null;
    productNameSnapshot?: string | null;
    quantity: unknown;
    totalNetValue: unknown;
    unit?: string | null;
  }>;
}): SalesOrderIntelligenceSourceOrder {
  return {
    id: order.id,
    orderCode: order.orderCode,
    status: order.status,
    issueDate: order.issueDate,
    expectedDeliveryDate: order.expectedDeliveryDate,
    totalNetValue: safeNonNegativeNumber(decimalToNumber(order.totalNetValue)),
    responsible: order.responsible,
    nomusRawResponse: order.nomusRawResponse,
    customerName:
      order.Customer?.tradeName?.trim() ||
      order.Customer?.companyName?.trim() ||
      null,
    items: order.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      externalProductId: item.externalProductId ?? null,
      skuSnapshot: item.skuSnapshot ?? null,
      productNameSnapshot: item.productNameSnapshot ?? null,
      quantity: safeNonNegativeNumber(decimalToNumber(item.quantity)),
      totalNetValue: safeNonNegativeNumber(decimalToNumber(item.totalNetValue)),
      unit: item.unit ?? null,
    })),
  };
}
