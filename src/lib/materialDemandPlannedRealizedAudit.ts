import {
  MATERIAL_USAGE_AUDIT_DIFF_NEGATIVE,
  MATERIAL_USAGE_AUDIT_DIFF_POSITIVE,
  MATERIAL_USAGE_AUDIT_DIFF_ZERO,
  MATERIAL_USAGE_AUDIT_FISCAL_NOTE,
} from "./materialDemandPlannedRealizedAuditCopy.js";
import {
  PLANNED_REALIZED_FISCAL_VS_PRODUCTION_NOTE,
  PLANNED_REALIZED_MISSING_BOM_WARNING,
  PLANNED_REALIZED_MISSING_COST_WARNING,
  PLANNED_REALIZED_PARTIAL_INVOICE_FALLBACK_WARNING,
  computeMaterialUsageMetrics,
} from "./materialDemandPlannedRealized.js";
import type {
  MaterialUsageAuditPayload,
  MaterialUsageContribution,
  MaterialUsageNfeSummary,
  MaterialUsagePlannedRealizedRow,
} from "./materialDemandPlannedRealizedTypes.js";

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

function safeFinite(n: number): number {
  return Number.isFinite(n) ? n : 0;
}

function valuePerUnitForContribution(c: MaterialUsageContribution): number | null {
  if (c.valuePerUnit != null && Number.isFinite(c.valuePerUnit)) return c.valuePerUnit;
  if (c.unitCost != null && Number.isFinite(c.unitCost)) {
    return c.unitCost * c.materialQtyPerUnit;
  }
  return null;
}

function primaryInvoiceNumber(nfes: MaterialUsageNfeSummary[]): string | null {
  return nfes[0]?.numero ?? null;
}

function primaryInvoiceDate(nfes: MaterialUsageNfeSummary[]): string | null {
  return nfes[0]?.dataProcessamento ?? null;
}

export function explainMaterialUsageCostDifference(costDifference: number): string {
  if (costDifference < 0) return MATERIAL_USAGE_AUDIT_DIFF_NEGATIVE;
  if (costDifference > 0) return MATERIAL_USAGE_AUDIT_DIFF_POSITIVE;
  return MATERIAL_USAGE_AUDIT_DIFF_ZERO;
}

export function buildMaterialUsageAuditPayload(
  materialId: string,
  contributions: MaterialUsageContribution[],
  nfeByOrderId: Map<string, MaterialUsageNfeSummary[]>,
  summaryRow?: MaterialUsagePlannedRealizedRow | null
): MaterialUsageAuditPayload | null {
  const filtered = contributions.filter((c) => c.materialId === materialId);
  if (filtered.length === 0) return null;

  const sample = filtered[0]!;

  type ProductAgg = {
    productId: string;
    productCode: string | null;
    productDescription: string;
    productSoldUnit: string | null;
    plannedProductQuantity: number;
    realizedProductQuantity: number;
    materialFactor: number;
    plannedMaterialQuantity: number;
    realizedMaterialQuantity: number;
    plannedCost: number;
    realizedCost: number;
    plannedOrderIds: Set<string>;
    realizedOrderIds: Set<string>;
  };

  const productsMap = new Map<string, ProductAgg>();
  const plannedOrders: MaterialUsageAuditPayload["plannedOrders"] = [];
  const realizedOrders: MaterialUsageAuditPayload["realizedOrders"] = [];

  let missingCosts = 0;
  let partialInvoiceFallbacks = 0;
  let invoiceLinkWarnings = 0;

  for (const c of filtered) {
    const plannedMaterialQty = round6(c.materialQtyPerUnit * c.plannedOrderQty);
    const realizedMaterialQty = round6(c.materialQtyPerUnit * c.realizedOrderQty);
    const vpu = valuePerUnitForContribution(c);
    const plannedCost = vpu != null ? round6(vpu * c.plannedOrderQty) : 0;
    const realizedCost = vpu != null ? round6(vpu * c.realizedOrderQty) : 0;

    const prod =
      productsMap.get(c.productId) ??
      {
        productId: c.productId,
        productCode: c.productSku,
        productDescription: c.productName ?? "Produto",
        productSoldUnit: c.productSoldUnit,
        plannedProductQuantity: 0,
        realizedProductQuantity: 0,
        materialFactor: c.materialQtyPerUnit,
        plannedMaterialQuantity: 0,
        realizedMaterialQuantity: 0,
        plannedCost: 0,
        realizedCost: 0,
        plannedOrderIds: new Set<string>(),
        realizedOrderIds: new Set<string>(),
      };
    prod.plannedProductQuantity += c.plannedOrderQty;
    prod.realizedProductQuantity += c.realizedOrderQty;
    prod.plannedMaterialQuantity += plannedMaterialQty;
    prod.realizedMaterialQuantity += realizedMaterialQty;
    prod.plannedCost += plannedCost;
    prod.realizedCost += realizedCost;
    prod.plannedOrderIds.add(c.orderId);
    if (c.realizedOrderQty > 0) prod.realizedOrderIds.add(c.orderId);
    productsMap.set(c.productId, prod);

    const nfes = nfeByOrderId.get(c.orderId) ?? [];
    const invoiceNumber = primaryInvoiceNumber(nfes);

    plannedOrders.push({
      salesOrderId: c.orderId,
      salesOrderNumber: c.orderCode,
      customerName: c.customerName?.trim() || "—",
      issueDate: c.issueDate,
      productCode: c.productSku,
      productDescription: c.productName ?? "Produto",
      productSoldUnit: c.productSoldUnit,
      productQuantity: round6(c.plannedOrderQty),
      materialFactor: round6(c.materialQtyPerUnit),
      plannedMaterialQuantity: plannedMaterialQty,
      plannedCost,
      status: c.orderStatus,
      invoiceNumber,
      hasInvoicing: c.hasInvoicing,
    });

    if (c.realizedOrderQty > 0) {
      if (c.hasInvoicing && nfes.length === 0) invoiceLinkWarnings += 1;
      realizedOrders.push({
        salesOrderId: c.orderId,
        salesOrderNumber: c.orderCode,
        invoiceNumber,
        customerName: c.customerName?.trim() || "—",
        invoiceDate: primaryInvoiceDate(nfes),
        productCode: c.productSku,
        productDescription: c.productName ?? "Produto",
        productSoldUnit: c.productSoldUnit,
        invoicedProductQuantity: round6(c.realizedOrderQty),
        materialFactor: round6(c.materialQtyPerUnit),
        realizedMaterialQuantity: realizedMaterialQty,
        realizedCost,
        usedPartialInvoiceFallback: c.usedPartialInvoiceFallback,
      });
    }

    if (c.missingCost) missingCosts += 1;
    if (c.usedPartialInvoiceFallback) partialInvoiceFallbacks += 1;
  }

  const products = [...productsMap.values()]
    .map((p) => ({
      productId: p.productId,
      productCode: p.productCode,
      productDescription: p.productDescription,
      productSoldUnit: p.productSoldUnit,
      plannedProductQuantity: round6(p.plannedProductQuantity),
      realizedProductQuantity: round6(p.realizedProductQuantity),
      materialFactor: round6(p.materialFactor),
      plannedMaterialQuantity: round6(p.plannedMaterialQuantity),
      realizedMaterialQuantity: round6(p.realizedMaterialQuantity),
      balanceMaterialQuantity: round6(p.plannedMaterialQuantity - p.realizedMaterialQuantity),
      plannedCost: round6(p.plannedCost),
      realizedCost: round6(p.realizedCost),
      costDifference: round6(p.realizedCost - p.plannedCost),
      plannedOrdersCount: p.plannedOrderIds.size,
      realizedOrdersCount: p.realizedOrderIds.size,
    }))
    .sort((a, b) => Math.abs(b.balanceMaterialQuantity) - Math.abs(a.balanceMaterialQuantity));

  const productVarianceRanking = products.map((p) => ({
    productId: p.productId,
    productCode: p.productCode,
    productDescription: p.productDescription,
    balanceMaterialQuantity: p.balanceMaterialQuantity,
    costDifference: p.costDifference,
  }));

  plannedOrders.sort(
    (a, b) =>
      b.plannedMaterialQuantity - a.plannedMaterialQuantity ||
      b.issueDate.localeCompare(a.issueDate)
  );
  realizedOrders.sort(
    (a, b) =>
      b.realizedMaterialQuantity - a.realizedMaterialQuantity ||
      (b.invoiceDate ?? "").localeCompare(a.invoiceDate ?? "")
  );

  const plannedOrderIds = new Set(filtered.map((c) => c.orderId));
  const realizedOrderIds = new Set(
    filtered.filter((c) => c.realizedOrderQty > 0).map((c) => c.orderId)
  );
  const pendingOrderIds = [...plannedOrderIds].filter((id) => !realizedOrderIds.has(id));

  const metricsFromRow = summaryRow
    ? {
        plannedQuantity: safeFinite(summaryRow.plannedQuantity),
        realizedQuantity: safeFinite(summaryRow.realizedQuantity),
        balanceQuantity: safeFinite(summaryRow.remainingQuantity),
        accuracyPercent: summaryRow.accuracyPercent,
        unitCost: summaryRow.unitCost,
        plannedCost: safeFinite(summaryRow.plannedCost),
        realizedCost: safeFinite(summaryRow.realizedCost),
        costDifference: safeFinite(summaryRow.costVariance),
        plannedOrdersCount: summaryRow.plannedOrdersCount,
        realizedOrdersCount: summaryRow.realizedOrdersCount,
      }
    : null;

  let plannedQuantity = 0;
  let realizedQuantity = 0;
  let plannedCost = 0;
  let realizedCost = 0;
  if (!metricsFromRow) {
    for (const c of filtered) {
      plannedQuantity += c.materialQtyPerUnit * c.plannedOrderQty;
      realizedQuantity += c.materialQtyPerUnit * c.realizedOrderQty;
      const vpu = valuePerUnitForContribution(c);
      if (vpu != null) {
        plannedCost += vpu * c.plannedOrderQty;
        realizedCost += vpu * c.realizedOrderQty;
      }
    }
  }

  const summaryMetrics = metricsFromRow ?? {
    plannedQuantity: round6(plannedQuantity),
    realizedQuantity: round6(realizedQuantity),
    balanceQuantity: round6(plannedQuantity - realizedQuantity),
    accuracyPercent: computeMaterialUsageMetrics(plannedQuantity, realizedQuantity).accuracyPercent,
    unitCost:
      sample.unitCost ??
      (plannedQuantity > 0 ? round6(plannedCost / plannedQuantity) : null),
    plannedCost: round6(plannedCost),
    realizedCost: round6(realizedCost),
    costDifference: round6(realizedCost - plannedCost),
    plannedOrdersCount: plannedOrderIds.size,
    realizedOrdersCount: realizedOrderIds.size,
  };

  const costDifference = summaryMetrics.costDifference;
  const warnings = new Set<string>([
    MATERIAL_USAGE_AUDIT_FISCAL_NOTE,
    PLANNED_REALIZED_FISCAL_VS_PRODUCTION_NOTE,
  ]);
  if (partialInvoiceFallbacks > 0) warnings.add(PLANNED_REALIZED_PARTIAL_INVOICE_FALLBACK_WARNING);
  if (missingCosts > 0) warnings.add(PLANNED_REALIZED_MISSING_COST_WARNING);
  if (summaryRow?.dataQuality) {
    for (const w of summaryRow.dataQuality) warnings.add(w);
  }
  if (invoiceLinkWarnings > 0) {
    warnings.add("Pedido faturado sem NF vinculada claramente no registro do pedido.");
  }

  return {
    material: {
      id: materialId,
      code: sample.materialCode,
      description: sample.materialDescription,
      unit: sample.unitLabel,
    },
    summary: {
      ...summaryMetrics,
      pendingOrdersCount: pendingOrderIds.length,
      costDifferenceExplanation: explainMaterialUsageCostDifference(costDifference),
    },
    products,
    plannedOrders,
    realizedOrders,
    productVarianceRanking,
    dataQuality: {
      warnings: [...warnings],
      missingBomItems: 0,
      missingCosts,
      unitConversionWarnings: 0,
      partialInvoiceFallbacks,
      invoiceLinkWarnings,
    },
  };
}

/** @deprecated Use buildMaterialUsageAuditPayload */
export function buildMaterialPlannedRealizedDetails(
  materialId: string,
  contributions: MaterialUsageContribution[],
  nfeByOrderId: Map<string, MaterialUsageNfeSummary[]>
): import("./materialDemandPlannedRealizedTypes.js").MaterialPlannedRealizedDetailResponse | null {
  const audit = buildMaterialUsageAuditPayload(materialId, contributions, nfeByOrderId);
  if (!audit) return null;
  return {
    materialId: audit.material.id,
    materialCode: audit.material.code,
    materialName: audit.material.description,
    unitLabel: audit.material.unit,
    products: audit.products.map((p) => ({
      productId: p.productId,
      productSku: p.productCode,
      productName: p.productDescription,
      plannedQuantity: p.plannedMaterialQuantity,
      realizedQuantity: p.realizedMaterialQuantity,
    })),
    plannedOrders: audit.plannedOrders.map((o) => ({
      salesOrderId: o.salesOrderId,
      orderCode: o.salesOrderNumber,
      orderStatus: o.status,
      issueDate: o.issueDate,
      hasInvoicing: o.hasInvoicing,
      plannedQuantity: o.plannedMaterialQuantity,
      realizedQuantity: 0,
      nfes: o.invoiceNumber
        ? [{ dataProcessamento: o.issueDate, numero: o.invoiceNumber, serie: null }]
        : (nfeByOrderId.get(o.salesOrderId) ?? []),
    })),
    realizedOrders: audit.realizedOrders.map((o) => ({
      salesOrderId: o.salesOrderId,
      orderCode: o.salesOrderNumber,
      orderStatus: "INVOICED",
      issueDate: o.invoiceDate ?? o.salesOrderNumber,
      hasInvoicing: true,
      plannedQuantity: 0,
      realizedQuantity: o.realizedMaterialQuantity,
      nfes: o.invoiceNumber
        ? [{ dataProcessamento: o.invoiceDate ?? "", numero: o.invoiceNumber, serie: null }]
        : [],
    })),
  };
}

export { PLANNED_REALIZED_MISSING_BOM_WARNING };
