import {
  MATERIAL_USAGE_AUDIT_DIFF_NEGATIVE,
  MATERIAL_USAGE_AUDIT_DIFF_POSITIVE,
  MATERIAL_USAGE_AUDIT_DIFF_ZERO,
  MATERIAL_USAGE_AUDIT_FISCAL_NOTE,
  MATERIAL_USAGE_AUDIT_UNEXPLAINED_WARNING,
} from "./materialDemandPlannedRealizedAuditCopy.js";
import {
  PLANNED_REALIZED_FISCAL_VS_PRODUCTION_NOTE,
  PLANNED_REALIZED_MISSING_COST_WARNING,
  PLANNED_REALIZED_PARTIAL_INVOICE_FALLBACK_WARNING,
  computeMaterialUsageMetrics,
  safeMaterialUsageRatio,
} from "./materialDemandPlannedRealized.js";
import type {
  MaterialUsageAuditDifferenceBridge,
  MaterialUsageAuditPayload,
  MaterialUsageAuditProductStatus,
  MaterialUsageContribution,
  MaterialUsageNfeSummary,
  MaterialUsagePlannedRealizedRow,
} from "./materialDemandPlannedRealizedTypes.js";

const QTY_TOLERANCE = 1e-6;

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

function invoiceNumbers(nfes: MaterialUsageNfeSummary[]): string[] {
  return nfes.map((n) => n.numero).filter((n): n is string => Boolean(n?.trim()));
}

export type MaterialUsageLineClassification =
  | "not_invoiced"
  | "partial"
  | "invoiced"
  | "above_planned";

export function classifyMaterialUsageLine(c: MaterialUsageContribution): MaterialUsageLineClassification {
  const planned = Math.max(0, c.plannedOrderQty);
  const realized = Math.max(0, c.realizedOrderQty);
  if (realized <= QTY_TOLERANCE || !c.hasInvoicing) return "not_invoiced";
  if (realized + QTY_TOLERANCE < planned) return "partial";
  if (realized > planned + QTY_TOLERANCE) return "above_planned";
  return "invoiced";
}

export function computeMaterialUsageDaysOpen(
  issueDateIso: string,
  now: Date = new Date()
): number | null {
  const d = new Date(issueDateIso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((now.getTime() - d.getTime()) / 86_400_000));
}

export function resolveMaterialUsageProductStatus(input: {
  plannedMaterialQuantity: number;
  realizedMaterialQuantity: number;
  pendingMaterialQuantity: number;
  partiallyInvoicedOrdersCount: number;
  notInvoicedOrdersCount: number;
  hasWarning: boolean;
}): MaterialUsageAuditProductStatus {
  if (input.hasWarning) return "warning";
  if (input.plannedMaterialQuantity <= QTY_TOLERANCE && input.realizedMaterialQuantity <= QTY_TOLERANCE) {
    return "ok";
  }
  if (input.realizedMaterialQuantity <= QTY_TOLERANCE && input.plannedMaterialQuantity > QTY_TOLERANCE) {
    return "not_invoiced";
  }
  if (input.partiallyInvoicedOrdersCount > 0 || input.pendingMaterialQuantity > QTY_TOLERANCE) {
    if (input.realizedMaterialQuantity > QTY_TOLERANCE) return "partial";
    return "pending_invoice";
  }
  return "ok";
}

export function explainMaterialUsageCostDifference(costDifference: number): string {
  if (costDifference < 0) return MATERIAL_USAGE_AUDIT_DIFF_NEGATIVE;
  if (costDifference > 0) return MATERIAL_USAGE_AUDIT_DIFF_POSITIVE;
  return MATERIAL_USAGE_AUDIT_DIFF_ZERO;
}

export function computeMaterialUsageDifferenceBridge(input: {
  totalBalanceQuantity: number;
  notInvoicedOrdersQuantity: number;
  partiallyInvoicedOrdersQuantity: number;
  invoiceLinkWarningQuantity: number;
  missingBomQuantity?: number;
  missingCostQuantity?: number;
}): MaterialUsageAuditDifferenceBridge {
  const missingBomQuantity = input.missingBomQuantity ?? 0;
  const missingCostQuantity = input.missingCostQuantity ?? 0;
  const categorized = round6(
    input.notInvoicedOrdersQuantity +
      input.partiallyInvoicedOrdersQuantity +
      missingBomQuantity +
      missingCostQuantity
  );
  const unexplainedQuantity = round6(input.totalBalanceQuantity - categorized);
  const reconciles = Math.abs(unexplainedQuantity) <= QTY_TOLERANCE;
  return {
    totalBalanceQuantity: round6(input.totalBalanceQuantity),
    notInvoicedOrdersQuantity: round6(input.notInvoicedOrdersQuantity),
    partiallyInvoicedOrdersQuantity: round6(input.partiallyInvoicedOrdersQuantity),
    invoiceLinkWarningQuantity: round6(input.invoiceLinkWarningQuantity),
    missingBomQuantity: round6(missingBomQuantity),
    missingCostQuantity: round6(missingCostQuantity),
    unexplainedQuantity,
    reconciles,
  };
}

type OrderProductKey = string;

function orderProductKey(orderId: string, productId: string): OrderProductKey {
  return `${orderId}:${productId}`;
}

export function buildMaterialUsageAuditPayload(
  materialId: string,
  contributions: MaterialUsageContribution[],
  nfeByOrderId: Map<string, MaterialUsageNfeSummary[]>,
  summaryRow?: MaterialUsagePlannedRealizedRow | null,
  now: Date = new Date()
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
    notInvoicedOrderIds: Set<string>;
    partialOrderIds: Set<string>;
    hasWarning: boolean;
  };

  const productsMap = new Map<string, ProductAgg>();
  const notInvoicedOrders: MaterialUsageAuditPayload["notInvoicedOrders"] = [];
  const partiallyInvoicedOrders: MaterialUsageAuditPayload["partiallyInvoicedOrders"] = [];
  const realizedOrders: MaterialUsageAuditPayload["realizedOrders"] = [];
  const plannedOrders: MaterialUsageAuditPayload["plannedOrders"] = [];

  let missingCosts = 0;
  let partialInvoiceFallbacks = 0;
  let invoiceLinkWarnings = 0;
  let bridgeNotInvoicedQty = 0;
  let bridgePartialQty = 0;
  let bridgeInvoiceLinkQty = 0;

  for (const c of filtered) {
    const plannedMaterialQty = round6(c.materialQtyPerUnit * c.plannedOrderQty);
    const realizedMaterialQty = round6(c.materialQtyPerUnit * c.realizedOrderQty);
    const pendingMaterialQty = round6(Math.max(0, plannedMaterialQty - realizedMaterialQty));
    const vpu = valuePerUnitForContribution(c);
    const plannedCost = vpu != null ? round6(vpu * c.plannedOrderQty) : 0;
    const realizedCost = vpu != null ? round6(vpu * c.realizedOrderQty) : 0;
    const pendingCost = round6(Math.max(0, plannedCost - realizedCost));
    const classification = classifyMaterialUsageLine(c);
    const nfes = nfeByOrderId.get(c.orderId) ?? [];
    const invoiceNumber = primaryInvoiceNumber(nfes);

    if (classification === "not_invoiced") bridgeNotInvoicedQty += pendingMaterialQty;
    if (classification === "partial") bridgePartialQty += pendingMaterialQty;
    if (c.hasInvoicing && c.realizedOrderQty > 0 && nfes.length === 0) {
      invoiceLinkWarnings += 1;
      bridgeInvoiceLinkQty += realizedMaterialQty;
    }

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
        notInvoicedOrderIds: new Set<string>(),
        partialOrderIds: new Set<string>(),
        hasWarning: false,
      };
    prod.plannedProductQuantity += c.plannedOrderQty;
    prod.realizedProductQuantity += c.realizedOrderQty;
    prod.plannedMaterialQuantity += plannedMaterialQty;
    prod.realizedMaterialQuantity += realizedMaterialQty;
    prod.plannedCost += plannedCost;
    prod.realizedCost += realizedCost;
    prod.plannedOrderIds.add(c.orderId);
    if (c.realizedOrderQty > 0) prod.realizedOrderIds.add(c.orderId);
    if (classification === "not_invoiced") prod.notInvoicedOrderIds.add(c.orderId);
    if (classification === "partial") prod.partialOrderIds.add(c.orderId);
    if (c.missingCost || c.usedPartialInvoiceFallback || c.incompleteData) {
      prod.hasWarning = true;
    }
    productsMap.set(c.productId, prod);

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

    if (classification === "not_invoiced") {
      notInvoicedOrders.push({
        salesOrderId: c.orderId,
        salesOrderNumber: c.orderCode,
        customerName: c.customerName?.trim() || "—",
        issueDate: c.issueDate,
        expectedDeliveryDate: c.expectedDeliveryDate,
        productCode: c.productSku,
        productDescription: c.productName ?? "Produto",
        orderedQuantity: round6(c.plannedOrderQty),
        materialFactor: round6(c.materialQtyPerUnit),
        plannedMaterialQuantity: plannedMaterialQty,
        plannedCost,
        orderStatus: c.orderStatus,
        daysOpen: computeMaterialUsageDaysOpen(c.issueDate, now),
      });
    }

    if (classification === "partial") {
      partiallyInvoicedOrders.push({
        salesOrderId: c.orderId,
        salesOrderNumber: c.orderCode,
        customerName: c.customerName?.trim() || "—",
        productCode: c.productSku,
        productDescription: c.productName ?? "Produto",
        orderedQuantity: round6(c.plannedOrderQty),
        invoicedQuantity: round6(c.realizedOrderQty),
        pendingQuantity: round6(Math.max(0, c.plannedOrderQty - c.realizedOrderQty)),
        plannedMaterialQuantity: plannedMaterialQty,
        realizedMaterialQuantity: realizedMaterialQty,
        pendingMaterialQuantity: pendingMaterialQty,
        invoices: invoiceNumbers(nfes),
      });
    }

    if (c.realizedOrderQty > 0) {
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
    .map((p) => {
      const pendingMaterialQuantity = round6(p.plannedMaterialQuantity - p.realizedMaterialQuantity);
      const pendingProductQuantity = round6(p.plannedProductQuantity - p.realizedProductQuantity);
      const pendingCost = round6(Math.max(0, p.plannedCost - p.realizedCost));
      const status = resolveMaterialUsageProductStatus({
        plannedMaterialQuantity: p.plannedMaterialQuantity,
        realizedMaterialQuantity: p.realizedMaterialQuantity,
        pendingMaterialQuantity,
        partiallyInvoicedOrdersCount: p.partialOrderIds.size,
        notInvoicedOrdersCount: p.notInvoicedOrderIds.size,
        hasWarning: p.hasWarning,
      });
      return {
        productId: p.productId,
        productCode: p.productCode,
        productDescription: p.productDescription,
        productSoldUnit: p.productSoldUnit,
        plannedProductQuantity: round6(p.plannedProductQuantity),
        realizedProductQuantity: round6(p.realizedProductQuantity),
        pendingProductQuantity,
        materialFactor: round6(p.materialFactor),
        plannedMaterialQuantity: round6(p.plannedMaterialQuantity),
        realizedMaterialQuantity: round6(p.realizedMaterialQuantity),
        pendingMaterialQuantity,
        balanceMaterialQuantity: pendingMaterialQuantity,
        plannedCost: round6(p.plannedCost),
        realizedCost: round6(p.realizedCost),
        pendingCost,
        costDifference: round6(p.realizedCost - p.plannedCost),
        plannedOrdersCount: p.plannedOrderIds.size,
        realizedOrdersCount: p.realizedOrderIds.size,
        notInvoicedOrdersCount: p.notInvoicedOrderIds.size,
        partiallyInvoicedOrdersCount: p.partialOrderIds.size,
        status,
      };
    })
    .sort((a, b) => Math.abs(b.pendingMaterialQuantity) - Math.abs(a.pendingMaterialQuantity));

  const productVarianceRanking = products.map((p) => ({
    productId: p.productId,
    productCode: p.productCode,
    productDescription: p.productDescription,
    balanceMaterialQuantity: p.balanceMaterialQuantity,
    costDifference: p.costDifference,
  }));

  const sortByMaterialQtyDesc = <T extends { plannedMaterialQuantity?: number; realizedMaterialQuantity?: number; pendingMaterialQuantity?: number }>(
    a: T,
    b: T
  ) =>
    (b.plannedMaterialQuantity ?? b.realizedMaterialQuantity ?? b.pendingMaterialQuantity ?? 0) -
    (a.plannedMaterialQuantity ?? a.realizedMaterialQuantity ?? a.pendingMaterialQuantity ?? 0);

  notInvoicedOrders.sort(sortByMaterialQtyDesc);
  partiallyInvoicedOrders.sort(sortByMaterialQtyDesc);
  realizedOrders.sort((a, b) => b.realizedMaterialQuantity - a.realizedMaterialQuantity);
  plannedOrders.sort((a, b) => b.plannedMaterialQuantity - a.plannedMaterialQuantity);

  const plannedOrderIds = new Set(filtered.map((c) => c.orderId));
  const realizedOrderIds = new Set(
    filtered.filter((c) => c.realizedOrderQty > 0).map((c) => c.orderId)
  );
  const partialOrderIds = new Set(
    filtered.filter((c) => classifyMaterialUsageLine(c) === "partial").map((c) => c.orderId)
  );
  const notInvoicedOrderIds = new Set(
    filtered.filter((c) => classifyMaterialUsageLine(c) === "not_invoiced").map((c) => c.orderId)
  );

  const metricsFromRow = summaryRow
    ? {
        plannedQuantity: safeFinite(summaryRow.plannedQuantity),
        realizedQuantity: safeFinite(summaryRow.realizedQuantity),
        pendingQuantity: safeFinite(summaryRow.remainingQuantity),
        balanceQuantity: safeFinite(summaryRow.remainingQuantity),
        partialQuantity: bridgePartialQty,
        accuracyPercent: summaryRow.accuracyPercent,
        unitCost: summaryRow.unitCost,
        plannedCost: safeFinite(summaryRow.plannedCost),
        realizedCost: safeFinite(summaryRow.realizedCost),
        pendingCost: round6(summaryRow.plannedCost - summaryRow.realizedCost),
        costDifference: safeFinite(summaryRow.costVariance),
        plannedOrdersCount: summaryRow.plannedOrdersCount,
        realizedOrdersCount: summaryRow.realizedOrdersCount,
        notInvoicedOrdersCount: summaryRow.notInvoicedOrdersCount,
        partiallyInvoicedOrdersCount: summaryRow.partiallyInvoicedOrdersCount,
        invoicedPercent: summaryRow.invoicedPercent,
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

  const computedPendingQty = round6(plannedQuantity - realizedQuantity);
  const computedInvoicedPercent =
    safeMaterialUsageRatio(realizedOrderIds.size, plannedOrderIds.size) == null
      ? null
      : round6((safeMaterialUsageRatio(realizedOrderIds.size, plannedOrderIds.size) ?? 0) * 100);

  const summaryMetrics = metricsFromRow ?? {
    plannedQuantity: round6(plannedQuantity),
    realizedQuantity: round6(realizedQuantity),
    pendingQuantity: computedPendingQty,
    balanceQuantity: computedPendingQty,
    partialQuantity: bridgePartialQty,
    accuracyPercent: computeMaterialUsageMetrics(plannedQuantity, realizedQuantity).accuracyPercent,
    unitCost:
      sample.unitCost ?? (plannedQuantity > 0 ? round6(plannedCost / plannedQuantity) : null),
    plannedCost: round6(plannedCost),
    realizedCost: round6(realizedCost),
    pendingCost: round6(plannedCost - realizedCost),
    costDifference: round6(realizedCost - plannedCost),
    plannedOrdersCount: plannedOrderIds.size,
    realizedOrdersCount: realizedOrderIds.size,
    notInvoicedOrdersCount: notInvoicedOrderIds.size,
    partiallyInvoicedOrdersCount: partialOrderIds.size,
    invoicedPercent: computedInvoicedPercent,
  };

  const costDifference = summaryMetrics.costDifference;
  const differenceBridge = computeMaterialUsageDifferenceBridge({
    totalBalanceQuantity: summaryMetrics.pendingQuantity,
    notInvoicedOrdersQuantity: bridgeNotInvoicedQty,
    partiallyInvoicedOrdersQuantity: bridgePartialQty,
    invoiceLinkWarningQuantity: bridgeInvoiceLinkQty,
    missingCostQuantity: missingCosts > 0 ? 0 : 0,
  });

  const warnings = new Set<string>([
    MATERIAL_USAGE_AUDIT_FISCAL_NOTE,
    PLANNED_REALIZED_FISCAL_VS_PRODUCTION_NOTE,
  ]);
  if (partialInvoiceFallbacks > 0) {
    warnings.add(PLANNED_REALIZED_PARTIAL_INVOICE_FALLBACK_WARNING);
    warnings.add(
      "Não foi possível identificar faturamento parcial por item para alguns pedidos; foi usado fallback."
    );
  }
  if (missingCosts > 0) warnings.add(PLANNED_REALIZED_MISSING_COST_WARNING);
  if (summaryRow?.dataQuality) {
    for (const w of summaryRow.dataQuality) warnings.add(w);
  }
  if (invoiceLinkWarnings > 0) {
    warnings.add("Pedido faturado sem NF vinculada claramente no registro do pedido.");
  }
  if (!differenceBridge.reconciles) warnings.add(MATERIAL_USAGE_AUDIT_UNEXPLAINED_WARNING);

  return {
    material: {
      id: materialId,
      code: sample.materialCode,
      description: sample.materialDescription,
      unit: sample.unitLabel,
    },
    summary: {
      ...summaryMetrics,
      pendingOrdersCount: summaryMetrics.notInvoicedOrdersCount,
      costDifferenceExplanation: explainMaterialUsageCostDifference(costDifference),
    },
    differenceBridge,
    products,
    notInvoicedOrders,
    partiallyInvoicedOrders,
    realizedOrders,
    plannedOrders,
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

export { PLANNED_REALIZED_MISSING_BOM_WARNING } from "./materialDemandPlannedRealized.js";
