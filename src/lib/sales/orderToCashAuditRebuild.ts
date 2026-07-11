/**
 * Helpers puros do rebuild OrderToCashAudit (CLI, summary, mapeamento para Prisma create).
 * Sem I/O — o script scripts/rebuildOrderToCashAudit.ts carrega e persiste.
 */

import type { OrderToCashAuditFactRow } from "./orderToCashAuditBuilder.js";

export const ORDER_TO_CASH_DATE_AXES = [
  "ORDER_ISSUE_DATE",
  "EXPECTED_DELIVERY_DATE",
  "STOCK_DOCUMENT_DATE",
  "NFE_DATE",
  "RECEIVABLE_DUE_DATE",
  "RECEIVABLE_SETTLEMENT_DATE",
] as const;

export type OrderToCashDateAxis = (typeof ORDER_TO_CASH_DATE_AXES)[number];

export type OrderToCashRebuildMode = "preview" | "apply";

export type OrderToCashRebuildCliOptions = {
  mode: OrderToCashRebuildMode;
  orderCode: string | null;
  salesOrderId: string | null;
  customerExternalId: number | null;
  year: number | null;
  fromDate: Date | null;
  toDate: Date | null;
  dateAxis: OrderToCashDateAxis;
  limit: number | null;
};

function parseArgValue(argv: string[], name: string): string | null {
  const eq = `--${name}=`;
  for (const arg of argv) {
    if (arg.startsWith(eq)) return arg.slice(eq.length);
    if (arg === `--${name}`) {
      const idx = argv.indexOf(arg);
      const next = argv[idx + 1];
      if (next && !next.startsWith("--")) return next;
    }
  }
  return null;
}

function parseDateArg(value: string | null): Date | null {
  if (!value?.trim()) return null;
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [y, m, d] = trimmed.split("-").map(Number);
    return new Date(y!, m! - 1, d!);
  }
  const d = new Date(trimmed);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function parseOrderToCashRebuildCli(argv: string[]): OrderToCashRebuildCliOptions {
  const modeRaw = (parseArgValue(argv, "mode") ?? "preview").trim().toLowerCase();
  if (modeRaw !== "preview" && modeRaw !== "apply") {
    throw new Error(`--mode inválido: ${modeRaw}. Use preview|apply.`);
  }

  const dateAxisRaw = (parseArgValue(argv, "dateAxis") ?? "ORDER_ISSUE_DATE").trim().toUpperCase();
  if (!(ORDER_TO_CASH_DATE_AXES as readonly string[]).includes(dateAxisRaw)) {
    throw new Error(
      `--dateAxis inválido: ${dateAxisRaw}. Permitidos: ${ORDER_TO_CASH_DATE_AXES.join(", ")}`
    );
  }

  const yearRaw = parseArgValue(argv, "year");
  const year = yearRaw != null && yearRaw !== "" ? Number(yearRaw) : null;
  if (year != null && (!Number.isInteger(year) || year < 2000 || year > 2100)) {
    throw new Error(`--year inválido: ${yearRaw}`);
  }

  const customerRaw = parseArgValue(argv, "customerExternalId");
  const customerExternalId =
    customerRaw != null && customerRaw !== "" ? Number(customerRaw) : null;
  if (customerExternalId != null && !Number.isFinite(customerExternalId)) {
    throw new Error(`--customerExternalId inválido: ${customerRaw}`);
  }

  const limitRaw = parseArgValue(argv, "limit");
  const limit = limitRaw != null && limitRaw !== "" ? Number(limitRaw) : null;
  if (limit != null && (!Number.isInteger(limit) || limit <= 0)) {
    throw new Error(`--limit inválido: ${limitRaw}`);
  }

  return {
    mode: modeRaw,
    orderCode: parseArgValue(argv, "orderCode")?.trim() || null,
    salesOrderId: parseArgValue(argv, "salesOrderId")?.trim() || null,
    customerExternalId,
    year,
    fromDate: parseDateArg(parseArgValue(argv, "from")),
    toDate: parseDateArg(parseArgValue(argv, "to")),
    dateAxis: dateAxisRaw as OrderToCashDateAxis,
    limit,
  };
}

/** Valida combinação mínima de filtros (script mais flexível que a UI futura). */
export function validateOrderToCashRebuildFilters(
  options: OrderToCashRebuildCliOptions
): string[] {
  const warnings: string[] = [];
  const hasOrder =
    Boolean(options.orderCode) || Boolean(options.salesOrderId);
  const hasCustomerYear =
    options.customerExternalId != null && options.year != null;
  const hasPeriod = options.fromDate != null || options.toDate != null;

  if (!hasOrder && !hasCustomerYear && !hasPeriod && options.customerExternalId == null) {
    warnings.push(
      "Sem filtro forte (orderCode/salesOrderId/customer+year/from-to). Rebuild pode ser amplo — use --limit."
    );
  }
  if (options.customerExternalId != null && options.year == null && !hasOrder && !hasPeriod) {
    warnings.push(
      "customerExternalId sem --year: na UI futura cliente+ano serão obrigatórios; aqui o script aceita, mas recomenda-se --year."
    );
  }
  return warnings;
}

export function resolvePeriodBounds(options: OrderToCashRebuildCliOptions): {
  from: Date | null;
  to: Date | null;
} {
  if (options.fromDate || options.toDate) {
    let to = options.toDate;
    if (to) {
      to = new Date(to);
      to.setHours(23, 59, 59, 999);
    }
    return { from: options.fromDate, to };
  }
  if (options.year != null) {
    return {
      from: new Date(options.year, 0, 1),
      to: new Date(options.year, 11, 31, 23, 59, 59, 999),
    };
  }
  return { from: null, to: null };
}

export type OrderToCashRebuildPreviewSummary = {
  totalOrders: number;
  totalOrderItems: number;
  totalFacts: number;
  totalOrderValue: number;
  totalAllocatedValue: number;
  totalReceivableValue: number;
  totalReceivedValue: number;
  totalOpenValue: number;
  totalBlockedValue: number;
  statusCounts: Record<string, number>;
  operationalStageCounts: Record<string, number>;
  financialStageCounts: Record<string, number>;
  paymentStatusCounts: Record<string, number>;
  orderToCashStageCounts: Record<string, number>;
  alertCounts: Record<string, number>;
  topRiskOrders: Array<{
    orderCode: string;
    orderToCashStage: string | null;
    temperature: string | null;
    alertCount: number;
    orderNetValue: number | null;
  }>;
  warnings: string[];
};

function bump(map: Record<string, number>, key: string | null | undefined): void {
  const k = key?.trim() || "(null)";
  map[k] = (map[k] ?? 0) + 1;
}

export function buildOrderToCashRebuildPreviewSummary(input: {
  ordersCount: number;
  orderItemsCount: number;
  rows: OrderToCashAuditFactRow[];
  builderSummary: {
    totalOrderValue: number;
    totalAllocatedValueByOrderPrice: number;
    totalReceivableValue: number;
    totalReceivedValue: number;
    totalOpenValue: number;
  };
  warnings: string[];
}): OrderToCashRebuildPreviewSummary {
  const statusCounts: Record<string, number> = {};
  const operationalStageCounts: Record<string, number> = {};
  const financialStageCounts: Record<string, number> = {};
  const paymentStatusCounts: Record<string, number> = {};
  const orderToCashStageCounts: Record<string, number> = {};
  const alertCounts: Record<string, number> = {};

  const byOrder = new Map<
    string,
    {
      orderCode: string;
      orderToCashStage: string | null;
      temperature: string | null;
      alertCount: number;
      orderNetValue: number | null;
      blocked: boolean;
    }
  >();

  let totalBlockedValue = 0;

  for (const row of input.rows) {
    bump(statusCounts, row.orderStatus);
    bump(operationalStageCounts, row.operationalStage);
    bump(financialStageCounts, row.financialStage);
    bump(paymentStatusCounts, row.paymentStatus);
    bump(orderToCashStageCounts, row.orderToCashStage);
    for (const alert of row.alertsJson ?? []) bump(alertCounts, alert);

    const code = row.orderCode ?? row.salesOrderId ?? "unknown";
    const existing = byOrder.get(code);
    const alertCount = (row.alertsJson ?? []).length;
    const blocked =
      row.orderToCashStage === "BLOQUEADO_REVISAO" ||
      (row.blockingReasonsJson?.length ?? 0) > 0;
    if (!existing) {
      byOrder.set(code, {
        orderCode: code,
        orderToCashStage: row.orderToCashStage,
        temperature: row.temperature,
        alertCount,
        orderNetValue: row.orderNetValue,
        blocked,
      });
      if (blocked) totalBlockedValue += row.orderNetValue ?? 0;
    } else {
      existing.alertCount = Math.max(existing.alertCount, alertCount);
      if (blocked && !existing.blocked) {
        existing.blocked = true;
        totalBlockedValue += existing.orderNetValue ?? 0;
      }
    }
  }

  const topRiskOrders = [...byOrder.values()]
    .sort((a, b) => {
      const score = (o: typeof a) =>
        (o.blocked ? 1000 : 0) +
        o.alertCount * 10 +
        (o.temperature === "CONGELADO" ? 50 : o.temperature === "FRIO" ? 20 : 0);
      return score(b) - score(a);
    })
    .slice(0, 10)
    .map(({ blocked: _b, ...rest }) => rest);

  return {
    totalOrders: input.ordersCount,
    totalOrderItems: input.orderItemsCount,
    totalFacts: input.rows.length,
    totalOrderValue: input.builderSummary.totalOrderValue,
    totalAllocatedValue: input.builderSummary.totalAllocatedValueByOrderPrice,
    totalReceivableValue: input.builderSummary.totalReceivableValue,
    totalReceivedValue: input.builderSummary.totalReceivedValue,
    totalOpenValue: input.builderSummary.totalOpenValue,
    totalBlockedValue: Number(totalBlockedValue.toFixed(6)),
    statusCounts,
    operationalStageCounts,
    financialStageCounts,
    paymentStatusCounts,
    orderToCashStageCounts,
    alertCounts,
    topRiskOrders,
    warnings: input.warnings,
  };
}

export function formatCounts(title: string, counts: Record<string, number>): string {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return `${title}: (vazio)`;
  return `${title}:\n${entries.map(([k, v]) => `  - ${k}: ${v}`).join("\n")}`;
}

/** Mapeia row do builder para create Prisma (Decimais como number — Prisma aceita). */
export function orderToCashFactRowToPrismaData(
  row: OrderToCashAuditFactRow,
  runId: string
): Record<string, unknown> {
  return {
    runId,
    auditKey: row.auditKey,
    lineType: row.lineType,
    salesOrderId: row.salesOrderId,
    externalSalesOrderId: row.externalSalesOrderId,
    orderCode: row.orderCode,
    orderStatus: row.orderStatus,
    orderIssueDate: row.orderIssueDate,
    orderExpectedDeliveryDate: row.orderExpectedDeliveryDate,
    orderTotalValue: row.orderTotalValue,
    orderNetValue: row.orderNetValue,
    orderGrossValue: row.orderGrossValue,
    companyId: row.companyId,
    companyName: row.companyName,
    customerId: row.customerId,
    externalCustomerId: row.externalCustomerId,
    customerName: row.customerName,
    customerDocument: row.customerDocument,
    customerGroup: row.customerGroup,
    customerCity: row.customerCity,
    customerState: row.customerState,
    sellerId: row.sellerId,
    externalSellerId: row.externalSellerId,
    sellerName: row.sellerName,
    sellerSource: row.sellerSource,
    sellerQualityStatus: row.sellerQualityStatus,
    paymentConditionId: row.paymentConditionId,
    paymentConditionName: row.paymentConditionName,
    paymentConditionSource: row.paymentConditionSource,
    paymentTermsJson: row.paymentTermsJson ?? undefined,
    plannedInstallmentsCount: row.plannedInstallmentsCount,
    plannedFirstDueDate: row.plannedFirstDueDate,
    plannedLastDueDate: row.plannedLastDueDate,
    plannedPaymentDatesJson: row.plannedPaymentDatesJson ?? undefined,
    plannedReceivableValue: row.plannedReceivableValue,
    plannedPaymentStatus: row.plannedPaymentStatus,
    salesOrderItemId: row.salesOrderItemId,
    externalSalesOrderItemId: row.externalSalesOrderItemId,
    orderItemSequence: row.orderItemSequence,
    externalProductId: row.externalProductId,
    productId: row.productId,
    productCode: row.productCode,
    sku: row.sku,
    productName: row.productName,
    productDescription: row.productDescription,
    orderedQuantity: row.orderedQuantity,
    orderUnitPrice: row.orderUnitPrice,
    orderItemTotalValue: row.orderItemTotalValue,
    orderItemExpectedDeliveryDate: row.orderItemExpectedDeliveryDate,
    orderItemStatus: row.orderItemStatus,
    stockDocumentId: row.stockDocumentId,
    stockDocumentExternalId: row.stockDocumentExternalId,
    stockDocumentType: row.stockDocumentType,
    stockDocumentDate: row.stockDocumentDate,
    stockDocumentTotalValue: row.stockDocumentTotalValue,
    stockDocumentPersonId: row.stockDocumentPersonId,
    stockDocumentPersonName: row.stockDocumentPersonName,
    stockDocumentIdNfe: row.stockDocumentIdNfe,
    stockDocumentItemId: row.stockDocumentItemId,
    stockDocumentItemExternalProductId: row.stockDocumentItemExternalProductId,
    stockDocumentItemProductCode: row.stockDocumentItemProductCode,
    stockDocumentItemProductName: row.stockDocumentItemProductName,
    stockDocumentItemQuantity: row.stockDocumentItemQuantity,
    stockDocumentItemUnitValue: row.stockDocumentItemUnitValue,
    stockDocumentItemTotalValue: row.stockDocumentItemTotalValue,
    matchedByProduct: row.matchedByProduct,
    quantityUsedForOrder: row.quantityUsedForOrder,
    quantityRemainingBeforeAllocation: row.quantityRemainingBeforeAllocation,
    quantityRemainingAfterAllocation: row.quantityRemainingAfterAllocation,
    excessQuantity: row.excessQuantity,
    outsideOrderQuantity: row.outsideOrderQuantity,
    allocatedValueByOrderPrice: row.allocatedValueByOrderPrice,
    allocatedValueByDocumentPrice: row.allocatedValueByDocumentPrice,
    priceDifferenceValue: row.priceDifferenceValue,
    priceDifferencePercent: row.priceDifferencePercent,
    nfeId: row.nfeId,
    nfeExternalId: row.nfeExternalId,
    nfeNumber: row.nfeNumber,
    nfeSerie: row.nfeSerie,
    nfeKey: row.nfeKey,
    nfeStatus: row.nfeStatus,
    nfeOperationType: row.nfeOperationType,
    nfeProcessedAt: row.nfeProcessedAt,
    nfeIssueDate: row.nfeIssueDate,
    nfeHeaderValue: row.nfeHeaderValue,
    nfeLinkedBy: row.nfeLinkedBy,
    nfeItemsAvailable: row.nfeItemsAvailable,
    nfeItemsSource: row.nfeItemsSource,
    nfeItemProductCode: row.nfeItemProductCode,
    nfeItemProductName: row.nfeItemProductName,
    nfeItemQuantity: row.nfeItemQuantity,
    nfeItemUnitValue: row.nfeItemUnitValue,
    nfeItemTotalValue: row.nfeItemTotalValue,
    nfeItemMatchedOrderItem: row.nfeItemMatchedOrderItem,
    receivableIdsJson: row.receivableIdsJson ?? undefined,
    receivableCount: row.receivableCount,
    receivableTotalValue: row.receivableTotalValue,
    receivableOpenValue: row.receivableOpenValue,
    receivableReceivedValue: row.receivableReceivedValue,
    receivableDueDatesJson: row.receivableDueDatesJson ?? undefined,
    receivableSettlementDatesJson: row.receivableSettlementDatesJson ?? undefined,
    receivableStatus: row.receivableStatus,
    receivableSource: row.receivableSource,
    paymentScheduledDate: row.paymentScheduledDate,
    paymentDueDate: row.paymentDueDate,
    paymentSettlementDate: row.paymentSettlementDate,
    paymentReceivedAt: row.paymentReceivedAt,
    paymentExpectedValue: row.paymentExpectedValue,
    paymentReceivedValue: row.paymentReceivedValue,
    paymentOpenValue: row.paymentOpenValue,
    paymentDelayDays: row.paymentDelayDays,
    paymentStatus: row.paymentStatus,
    commercialStage: row.commercialStage,
    operationalStage: row.operationalStage,
    fiscalStage: row.fiscalStage,
    financialStage: row.financialStage,
    cashStage: row.cashStage,
    orderToCashStage: row.orderToCashStage,
    temperature: row.temperature,
    confidenceScore: row.confidenceScore,
    confidenceLabel: row.confidenceLabel,
    responsibleArea: row.responsibleArea,
    recommendedAction: row.recommendedAction,
    hasDeliveryDelay: row.hasDeliveryDelay,
    hasMissingStockDocument: row.hasMissingStockDocument,
    hasPartialFulfillment: row.hasPartialFulfillment,
    hasFullFulfillment: row.hasFullFulfillment,
    hasExcessQuantity: row.hasExcessQuantity,
    hasProductOutsideOrder: row.hasProductOutsideOrder,
    hasNfeHeaderGreaterThanOrder: row.hasNfeHeaderGreaterThanOrder,
    hasPriceMismatch: row.hasPriceMismatch,
    hasDocumentWithoutReceivable: row.hasDocumentWithoutReceivable,
    hasReceivableWithoutSafeLink: row.hasReceivableWithoutSafeLink,
    hasPaymentConditionMissing: row.hasPaymentConditionMissing,
    hasPaymentDateDivergence: row.hasPaymentDateDivergence,
    hasOverdueReceivable: row.hasOverdueReceivable,
    hasRecentPaymentNotReflected: row.hasRecentPaymentNotReflected,
    alertsJson: row.alertsJson,
    blockingReasonsJson: row.blockingReasonsJson,
    lastOrderUpdateAt: row.lastOrderUpdateAt,
    lastDocumentDate: row.lastDocumentDate,
    lastNfeDate: row.lastNfeDate,
    lastReceivableDueDate: row.lastReceivableDueDate,
    lastReceivableSettlementDate: row.lastReceivableSettlementDate,
    lastEvidenceDate: row.lastEvidenceDate,
    daysFromOrderToDocument: row.daysFromOrderToDocument,
    daysFromDocumentToNfe: row.daysFromDocumentToNfe,
    daysFromNfeToReceivable: row.daysFromNfeToReceivable,
    daysFromReceivableToSettlement: row.daysFromReceivableToSettlement,
    daysDeliveryDelay: row.daysDeliveryDelay,
    daysPaymentDelay: row.daysPaymentDelay,
  };
}
