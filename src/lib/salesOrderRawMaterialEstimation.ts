import { parseNomusBrOrIsoDate } from "./salesOrderNomusRaw.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const AMOUNT_TOLERANCE_RATIO = 0.005;
const AMOUNT_TOLERANCE_MIN = 0.01;

export type RawMaterialEstimationConfidence = "HIGH" | "MEDIUM" | "LOW";

export type RawMaterialDemandStatus =
  | "FULLY_INVOICED"
  | "OPEN_WITHIN_CYCLE"
  | "OPEN_OVERDUE_WITHOUT_INVOICE"
  | "PARTIALLY_INVOICED_LIVE_BALANCE"
  | "PARTIALLY_INVOICED_STALE_BALANCE"
  | "CRITICAL_UNSERVED_BALANCE_30D"
  | "MISSING_BOM"
  | "CANCELLED_OR_CLOSED"
  | "REVIEW_DATA";

export const RAW_MATERIAL_DEMAND_STATUS_LABELS: Record<RawMaterialDemandStatus, string> = {
  FULLY_INVOICED: "Atendido totalmente",
  OPEN_WITHIN_CYCLE: "Aberto dentro do ciclo",
  OPEN_OVERDUE_WITHOUT_INVOICE: "Aberto atrasado sem NF",
  PARTIALLY_INVOICED_LIVE_BALANCE: "Parcial atendido — saldo vivo",
  PARTIALLY_INVOICED_STALE_BALANCE: "Parcial atendido — saldo envelhecido",
  CRITICAL_UNSERVED_BALANCE_30D: "Saldo crítico não atendido > 30 dias",
  MISSING_BOM: "Sem BOM",
  CANCELLED_OR_CLOSED: "Cancelado ou finalizado",
  REVIEW_DATA: "Revisão de dados",
};

export type RawMaterialEstimationConfig = {
  billingCycleDays: number;
  partialBillingLiveDays: number;
  staleBalanceDays: number;
  veryCriticalDays: number;
  probableLossDays: number;
};

export const DEFAULT_RAW_MATERIAL_ESTIMATION_CONFIG: RawMaterialEstimationConfig = {
  billingCycleDays: 14,
  partialBillingLiveDays: 14,
  staleBalanceDays: 30,
  veryCriticalDays: 60,
  probableLossDays: 90,
};

export type RawMaterialEstimationPeriod = {
  start: Date | string | null;
  end: Date | string | null;
};

export type RawMaterialDemandOrderItemInput = {
  itemId: string;
  orderId: string;
  orderNumber: string;
  orderStatus: string;
  issueDate: Date | string;
  expectedDeliveryDate?: Date | string | null;
  isCancelled?: boolean;
  isItemCancelled?: boolean;
  productId: string;
  productCode: string | null;
  productName: string | null;
  quantity?: number | null;
  invoicedQuantity?: number | null;
  netAmount?: number | null;
  invoicedNetAmount?: number | null;
  hasInvoicing?: boolean;
  lastInvoiceDate?: Date | string | null;
};

export type RawMaterialBomLine = {
  materialCode: string;
  materialName: string;
  unit: string;
  quantityPerUnit: number;
};

export type RawMaterialDemandClassificationInput = {
  item: RawMaterialDemandOrderItemInput;
  referenceDate: Date;
  hasValidBom: boolean;
  period?: RawMaterialEstimationPeriod | null;
};

export type RawMaterialDemandClassification = {
  status: RawMaterialDemandStatus;
  statusLabel: string;
  includeInRecommended: boolean;
  includeInConservative: boolean;
  includeInUnservedRevenue: boolean;
  reviewRequired: boolean;
  openQuantity: number;
  openNetAmount: number;
  lastInvoiceDate: Date | null;
  liveWindowStart: Date | null;
  liveWindowEnd: Date | null;
  daysAfterLiveWindow: number;
  overlapFactor: number;
  confidence: RawMaterialEstimationConfidence;
  warnings: string[];
};

export type RawMaterialDemandLineResult = {
  recommendedDemand: number;
  conservativeDemand: number;
  uncertaintyDemand: number;
  reviewDemand: number;
  materialCode: string;
  materialName: string;
  unit: string;
  sourceOrderId: string;
  sourceOrderNumber: string;
  sourceItemId: string;
  productCode: string | null;
  productName: string | null;
  status: RawMaterialDemandStatus;
  factorUsed: number;
  explanation: string;
  classification: RawMaterialDemandClassification;
};

export type RawMaterialIntelligenceMaterialAggregate = {
  materialCode: string;
  materialName: string;
  unit: string;
  recommendedDemand: number;
  conservativeDemand: number;
  uncertaintyDemand: number;
  reviewDemand: number;
};

export type RawMaterialIntelligenceSummary = {
  recommendedDemandTotal: number;
  conservativeDemandTotal: number;
  uncertaintyDemandTotal: number;
  reviewItemsCount: number;
  unservedRevenuePotential: number;
  criticalBalanceOver30Days: number;
  missingBomItemsCount: number;
  reliability: {
    highCount: number;
    mediumCount: number;
    lowCount: number;
    overallScore: number;
  };
  byMaterial: RawMaterialIntelligenceMaterialAggregate[];
};

export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

export function safeFiniteNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return fallback;
}

export function safeNonNegativeNumber(value: unknown, fallback = 0): number {
  return Math.max(0, safeFiniteNumber(value, fallback));
}

export function addDays(date: Date, days: number): Date {
  const base = startOfLocalDay(date);
  const safeDays = safeFiniteNumber(days, 0);
  return new Date(base.getTime() + safeDays * MS_PER_DAY);
}

export function differenceInDaysSafe(a: Date, b: Date): number {
  const aDay = startOfLocalDay(a).getTime();
  const bDay = startOfLocalDay(b).getTime();
  const diff = Math.floor((aDay - bDay) / MS_PER_DAY);
  return Number.isFinite(diff) ? diff : 0;
}

export function toEstimationDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : startOfLocalDay(value);
  }
  return parseNomusBrOrIsoDate(value);
}

export function calculateWindowOverlapFactor(
  windowStart: Date,
  windowEnd: Date,
  filterStart: Date | string | null | undefined,
  filterEnd: Date | string | null | undefined
): number {
  const ws = startOfLocalDay(windowStart).getTime();
  const we = startOfLocalDay(windowEnd).getTime();
  if (we < ws) return 0;

  const parsedStart = filterStart == null ? null : toEstimationDate(filterStart);
  const parsedEnd = filterEnd == null ? null : toEstimationDate(filterEnd);
  if (parsedStart == null && parsedEnd == null) return 1;

  const fs = parsedStart ? parsedStart.getTime() : Number.NEGATIVE_INFINITY;
  const fe = parsedEnd ? parsedEnd.getTime() : Number.POSITIVE_INFINITY;

  const overlapStart = Math.max(ws, fs);
  const overlapEnd = Math.min(we, fe);
  if (overlapEnd < overlapStart) return 0;

  const windowDays = Math.max(1, differenceInDaysSafe(windowEnd, windowStart) + 1);
  const overlapDays = differenceInDaysSafe(new Date(overlapEnd), new Date(overlapStart)) + 1;
  const factor = overlapDays / windowDays;
  return Number.isFinite(factor) ? Math.min(1, Math.max(0, factor)) : 0;
}

export type EstimatedConsumptionWindow = {
  windowStart: Date | null;
  windowEnd: Date | null;
  basis: "issue_date" | "last_invoice" | "none";
  logisticsHintDate: Date | null;
};

export function resolveEstimatedConsumptionWindow(
  orderItem: RawMaterialDemandOrderItemInput,
  config: RawMaterialEstimationConfig = DEFAULT_RAW_MATERIAL_ESTIMATION_CONFIG
): EstimatedConsumptionWindow {
  const issueDate = toEstimationDate(orderItem.issueDate);
  const expectedDeliveryDate = toEstimationDate(orderItem.expectedDeliveryDate ?? null);
  const lastInvoiceDate = toEstimationDate(orderItem.lastInvoiceDate ?? null);
  const hasInvoicing = orderItem.hasInvoicing === true;

  if (!issueDate) {
    return {
      windowStart: null,
      windowEnd: null,
      basis: "none",
      logisticsHintDate: expectedDeliveryDate,
    };
  }

  if (!hasInvoicing) {
    const windowStart = issueDate;
    const windowEnd = addDays(issueDate, config.billingCycleDays);
    return {
      windowStart,
      windowEnd,
      basis: "issue_date",
      logisticsHintDate: expectedDeliveryDate,
    };
  }

  if (lastInvoiceDate) {
    const windowStart = lastInvoiceDate;
    const windowEnd = addDays(lastInvoiceDate, config.partialBillingLiveDays);
    return {
      windowStart,
      windowEnd,
      basis: "last_invoice",
      logisticsHintDate: expectedDeliveryDate,
    };
  }

  const windowStart = issueDate;
  const windowEnd = addDays(issueDate, config.billingCycleDays);
  return {
    windowStart,
    windowEnd,
    basis: "issue_date",
    logisticsHintDate: expectedDeliveryDate,
  };
}

export function resolveSoldQuantity(item: RawMaterialDemandOrderItemInput): number {
  return safeNonNegativeNumber(item.quantity, 0);
}

export function resolveSoldNetAmount(item: RawMaterialDemandOrderItemInput): number {
  return safeNonNegativeNumber(item.netAmount, 0);
}

export type QuantityResolution = {
  quantity: number;
  confidence: RawMaterialEstimationConfidence;
  usedValueFallback: boolean;
  warnings: string[];
};

export function resolveInvoicedQuantity(item: RawMaterialDemandOrderItemInput): QuantityResolution {
  const sold = resolveSoldQuantity(item);
  const warnings: string[] = [];

  if (!item.hasInvoicing) {
    return { quantity: 0, confidence: "HIGH", usedValueFallback: false, warnings };
  }

  const direct = item.invoicedQuantity;
  if (direct != null && Number.isFinite(direct) && direct >= 0) {
    if (sold > 0 && direct > sold) {
      warnings.push("Quantidade faturada maior que vendida; saldo normalizado para zero.");
    }
    return {
      quantity: Math.min(safeNonNegativeNumber(direct), sold),
      confidence: sold > 0 && direct > sold ? "LOW" : "HIGH",
      usedValueFallback: false,
      warnings,
    };
  }

  const soldAmount = resolveSoldNetAmount(item);
  const invoicedAmount = resolveInvoicedNetAmount(item);
  if (sold > 0 && soldAmount > 0 && invoicedAmount > 0) {
    const ratio = Math.min(1, invoicedAmount / soldAmount);
    warnings.push("Quantidade faturada estimada por valor líquido.");
    return {
      quantity: sold * ratio,
      confidence: "LOW",
      usedValueFallback: true,
      warnings,
    };
  }

  if (sold > 0) {
    warnings.push("NF sem quantidade por item; assumido faturamento total do item.");
    return {
      quantity: sold,
      confidence: "LOW",
      usedValueFallback: true,
      warnings,
    };
  }

  return { quantity: 0, confidence: "LOW", usedValueFallback: true, warnings };
}

export function resolveInvoicedNetAmount(item: RawMaterialDemandOrderItemInput): number {
  return safeNonNegativeNumber(item.invoicedNetAmount, 0);
}

export function resolveOpenQuantity(item: RawMaterialDemandOrderItemInput): QuantityResolution {
  const sold = resolveSoldQuantity(item);
  const invoiced = resolveInvoicedQuantity(item);
  const open = Math.max(0, sold - invoiced.quantity);

  if (open === 0 && sold > 0) {
    const soldAmount = resolveSoldNetAmount(item);
    const invoicedAmount = resolveInvoicedNetAmount(item);
    if (soldAmount > 0 && invoicedAmount > 0) {
      const tolerance = Math.max(soldAmount * AMOUNT_TOLERANCE_RATIO, AMOUNT_TOLERANCE_MIN);
      if (invoicedAmount >= soldAmount - tolerance) {
        return { quantity: 0, confidence: invoiced.confidence, usedValueFallback: invoiced.usedValueFallback, warnings: invoiced.warnings };
      }
    }
  }

  return {
    quantity: open,
    confidence: invoiced.confidence,
    usedValueFallback: invoiced.usedValueFallback,
    warnings: invoiced.warnings,
  };
}

export function resolveOpenNetAmount(item: RawMaterialDemandOrderItemInput): number {
  const soldAmount = resolveSoldNetAmount(item);
  const invoicedAmount = resolveInvoicedNetAmount(item);
  if (soldAmount > 0 && invoicedAmount > 0) {
    return Math.max(0, soldAmount - invoicedAmount);
  }

  const soldQty = resolveSoldQuantity(item);
  if (soldQty <= 0) return 0;
  const unitPrice = soldAmount > 0 ? soldAmount / soldQty : 0;
  const openQty = resolveOpenQuantity(item).quantity;
  return safeNonNegativeNumber(openQty * unitPrice, 0);
}

function isCancelledItem(item: RawMaterialDemandOrderItemInput): boolean {
  if (item.isCancelled === true || item.isItemCancelled === true) return true;
  const status = item.orderStatus.trim().toUpperCase();
  return status === "CANCELLED" || status === "ERROR";
}

function isFullyInvoicedByAmount(item: RawMaterialDemandOrderItemInput): boolean {
  const soldAmount = resolveSoldNetAmount(item);
  const invoicedAmount = resolveInvoicedNetAmount(item);
  if (soldAmount <= 0 || invoicedAmount <= 0) return false;
  const tolerance = Math.max(soldAmount * AMOUNT_TOLERANCE_RATIO, AMOUNT_TOLERANCE_MIN);
  return invoicedAmount >= soldAmount - tolerance;
}

function resolveClassificationConfidence(
  openResolution: QuantityResolution,
  hasValidBom: boolean,
  status: RawMaterialDemandStatus
): RawMaterialEstimationConfidence {
  if (status === "MISSING_BOM" || status === "REVIEW_DATA") return "LOW";
  if (!hasValidBom) return "LOW";
  if (openResolution.usedValueFallback) return "LOW";
  if (openResolution.confidence === "LOW") return "LOW";
  if (status === "FULLY_INVOICED" || status === "CANCELLED_OR_CLOSED") return "HIGH";
  if (
    status === "OPEN_WITHIN_CYCLE" ||
    status === "PARTIALLY_INVOICED_LIVE_BALANCE"
  ) {
    return "HIGH";
  }
  return "MEDIUM";
}

export function classifyRawMaterialDemandItem(
  input: RawMaterialDemandClassificationInput,
  config: RawMaterialEstimationConfig = DEFAULT_RAW_MATERIAL_ESTIMATION_CONFIG
): RawMaterialDemandClassification {
  const { item, referenceDate, hasValidBom, period } = input;
  const warnings: string[] = [];
  const refDay = startOfLocalDay(referenceDate);

  if (isCancelledItem(item)) {
    return {
      status: "CANCELLED_OR_CLOSED",
      statusLabel: RAW_MATERIAL_DEMAND_STATUS_LABELS.CANCELLED_OR_CLOSED,
      includeInRecommended: false,
      includeInConservative: false,
      includeInUnservedRevenue: false,
      reviewRequired: false,
      openQuantity: 0,
      openNetAmount: 0,
      lastInvoiceDate: toEstimationDate(item.lastInvoiceDate ?? null),
      liveWindowStart: null,
      liveWindowEnd: null,
      daysAfterLiveWindow: 0,
      overlapFactor: 0,
      confidence: "HIGH",
      warnings,
    };
  }

  if (!hasValidBom) {
    const open = resolveOpenQuantity(item);
    warnings.push("Produto sem estrutura/BOM válida.");
    return {
      status: "MISSING_BOM",
      statusLabel: RAW_MATERIAL_DEMAND_STATUS_LABELS.MISSING_BOM,
      includeInRecommended: false,
      includeInConservative: false,
      includeInUnservedRevenue: false,
      reviewRequired: true,
      openQuantity: open.quantity,
      openNetAmount: resolveOpenNetAmount(item),
      lastInvoiceDate: toEstimationDate(item.lastInvoiceDate ?? null),
      liveWindowStart: null,
      liveWindowEnd: null,
      daysAfterLiveWindow: 0,
      overlapFactor: 0,
      confidence: "LOW",
      warnings: [...warnings, ...open.warnings],
    };
  }

  const issueDate = toEstimationDate(item.issueDate);
  if (!issueDate) {
    warnings.push("Data de emissão ausente ou inválida.");
    const open = resolveOpenQuantity(item);
    return {
      status: "REVIEW_DATA",
      statusLabel: RAW_MATERIAL_DEMAND_STATUS_LABELS.REVIEW_DATA,
      includeInRecommended: false,
      includeInConservative: false,
      includeInUnservedRevenue: false,
      reviewRequired: true,
      openQuantity: open.quantity,
      openNetAmount: resolveOpenNetAmount(item),
      lastInvoiceDate: toEstimationDate(item.lastInvoiceDate ?? null),
      liveWindowStart: null,
      liveWindowEnd: null,
      daysAfterLiveWindow: 0,
      overlapFactor: 0,
      confidence: "LOW",
      warnings: [...warnings, ...open.warnings],
    };
  }

  const openResolution = resolveOpenQuantity(item);
  warnings.push(...openResolution.warnings);
  const openQuantity = openResolution.quantity;
  const openNetAmount = resolveOpenNetAmount(item);
  const lastInvoiceDate = toEstimationDate(item.lastInvoiceDate ?? null);
  const consumptionWindow = resolveEstimatedConsumptionWindow(item, config);
  const liveWindowStart = consumptionWindow.windowStart;
  const liveWindowEnd = consumptionWindow.windowEnd;

  const overlapFactor =
    liveWindowStart && liveWindowEnd
      ? calculateWindowOverlapFactor(
          liveWindowStart,
          liveWindowEnd,
          period?.start ?? null,
          period?.end ?? null
        )
      : period?.start || period?.end
        ? 0
        : 1;

  const fullyInvoiced =
    openQuantity <= 0 ||
    (resolveSoldQuantity(item) > 0 &&
      resolveInvoicedQuantity(item).quantity >= resolveSoldQuantity(item)) ||
    isFullyInvoicedByAmount(item);

  const invoicedOverflow =
    item.invoicedQuantity != null &&
    Number.isFinite(item.invoicedQuantity) &&
    resolveSoldQuantity(item) > 0 &&
    item.invoicedQuantity > resolveSoldQuantity(item);

  if (fullyInvoiced) {
    return {
      status: invoicedOverflow ? "REVIEW_DATA" : "FULLY_INVOICED",
      statusLabel: invoicedOverflow
        ? RAW_MATERIAL_DEMAND_STATUS_LABELS.REVIEW_DATA
        : RAW_MATERIAL_DEMAND_STATUS_LABELS.FULLY_INVOICED,
      includeInRecommended: false,
      includeInConservative: false,
      includeInUnservedRevenue: false,
      reviewRequired: invoicedOverflow,
      openQuantity: 0,
      openNetAmount: 0,
      lastInvoiceDate,
      liveWindowStart,
      liveWindowEnd,
      daysAfterLiveWindow: 0,
      overlapFactor: 0,
      confidence: invoicedOverflow
        ? "LOW"
        : resolveClassificationConfidence(openResolution, hasValidBom, "FULLY_INVOICED"),
      warnings,
    };
  }

  const daysAfterLiveWindow =
    liveWindowEnd && refDay.getTime() > liveWindowEnd.getTime()
      ? differenceInDaysSafe(refDay, liveWindowEnd)
      : 0;

  const isLive = liveWindowEnd ? refDay.getTime() <= liveWindowEnd.getTime() : false;
  const hasInvoicing = item.hasInvoicing === true;
  const isPartial =
    hasInvoicing &&
    resolveInvoicedQuantity(item).quantity > 0 &&
    openQuantity > 0;

  let status: RawMaterialDemandStatus;

  if (daysAfterLiveWindow > config.staleBalanceDays) {
    status = "CRITICAL_UNSERVED_BALANCE_30D";
  } else if (!hasInvoicing) {
    status = isLive ? "OPEN_WITHIN_CYCLE" : "OPEN_OVERDUE_WITHOUT_INVOICE";
  } else if (isPartial) {
    status = isLive
      ? "PARTIALLY_INVOICED_LIVE_BALANCE"
      : "PARTIALLY_INVOICED_STALE_BALANCE";
  } else if (hasInvoicing && openQuantity > 0) {
    status = isLive ? "OPEN_WITHIN_CYCLE" : "OPEN_OVERDUE_WITHOUT_INVOICE";
  } else {
    status = "REVIEW_DATA";
    warnings.push("Não foi possível classificar o item com os dados disponíveis.");
  }

  const includeInRecommended =
    overlapFactor > 0 &&
    (status === "OPEN_WITHIN_CYCLE" || status === "PARTIALLY_INVOICED_LIVE_BALANCE");

  const includeInConservative =
    overlapFactor > 0 &&
    openQuantity > 0 &&
    (status === "OPEN_WITHIN_CYCLE" ||
      status === "OPEN_OVERDUE_WITHOUT_INVOICE" ||
      status === "PARTIALLY_INVOICED_LIVE_BALANCE" ||
      status === "PARTIALLY_INVOICED_STALE_BALANCE" ||
      status === "CRITICAL_UNSERVED_BALANCE_30D");

  const includeInUnservedRevenue =
    openNetAmount > 0 &&
    (status === "OPEN_OVERDUE_WITHOUT_INVOICE" ||
      status === "PARTIALLY_INVOICED_STALE_BALANCE" ||
      status === "CRITICAL_UNSERVED_BALANCE_30D");

  const reviewRequired =
    status === "REVIEW_DATA" ||
    status === "OPEN_OVERDUE_WITHOUT_INVOICE" ||
    status === "PARTIALLY_INVOICED_STALE_BALANCE" ||
    status === "CRITICAL_UNSERVED_BALANCE_30D" ||
    openResolution.usedValueFallback;

  return {
    status,
    statusLabel: RAW_MATERIAL_DEMAND_STATUS_LABELS[status],
    includeInRecommended,
    includeInConservative,
    includeInUnservedRevenue,
    reviewRequired,
    openQuantity,
    openNetAmount,
    lastInvoiceDate,
    liveWindowStart,
    liveWindowEnd,
    daysAfterLiveWindow,
    overlapFactor,
    confidence: resolveClassificationConfidence(openResolution, hasValidBom, status),
    warnings,
  };
}

function roundDemand(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 1_000_000) / 1_000_000;
}

function buildDemandExplanation(
  classification: RawMaterialDemandClassification,
  bomLine: RawMaterialBomLine,
  factorUsed: number
): string {
  const base = `${classification.statusLabel}: saldo aberto ${classification.openQuantity}`;
  const window =
    classification.liveWindowStart && classification.liveWindowEnd
      ? `; janela ${classification.liveWindowStart.toISOString().slice(0, 10)}–${classification.liveWindowEnd.toISOString().slice(0, 10)}`
      : "";
  const factor = factorUsed < 1 ? `; fator período ${(factorUsed * 100).toFixed(1)}%` : "";
  return `${base}${window}; consumo ${bomLine.quantityPerUnit} ${bomLine.unit}/un${factor}`;
}

export function calculateRawMaterialDemandForItem(
  item: RawMaterialDemandOrderItemInput,
  bomLines: RawMaterialBomLine[],
  config: RawMaterialEstimationConfig = DEFAULT_RAW_MATERIAL_ESTIMATION_CONFIG,
  period?: RawMaterialEstimationPeriod | null,
  referenceDate: Date = new Date()
): RawMaterialDemandLineResult[] {
  const hasValidBom = bomLines.length > 0 && bomLines.every((line) => line.quantityPerUnit > 0);
  const classification = classifyRawMaterialDemandItem(
    { item, referenceDate, hasValidBom, period },
    config
  );

  const factorUsed = classification.overlapFactor;
  const effectiveOpenRecommended = classification.includeInRecommended
    ? classification.openQuantity * factorUsed
    : 0;
  const effectiveOpenConservative = classification.includeInConservative
    ? classification.openQuantity * factorUsed
    : 0;

  if (!hasValidBom) {
    return [
      {
        recommendedDemand: 0,
        conservativeDemand: 0,
        uncertaintyDemand: 0,
        reviewDemand: classification.openQuantity,
        materialCode: "—",
        materialName: "Sem BOM",
        unit: "—",
        sourceOrderId: item.orderId,
        sourceOrderNumber: item.orderNumber,
        sourceItemId: item.itemId,
        productCode: item.productCode,
        productName: item.productName,
        status: classification.status,
        factorUsed,
        explanation: "Produto sem BOM válida; necessidade não calculada automaticamente.",
        classification,
      },
    ];
  }

  return bomLines.map((bomLine) => {
    const qtyPerUnit = safeNonNegativeNumber(bomLine.quantityPerUnit, 0);
    const recommendedDemand = roundDemand(effectiveOpenRecommended * qtyPerUnit);
    const conservativeDemand = roundDemand(effectiveOpenConservative * qtyPerUnit);
    const uncertaintyDemand = roundDemand(Math.max(0, conservativeDemand - recommendedDemand));
    const reviewDemand = classification.reviewRequired
      ? roundDemand(classification.openQuantity * qtyPerUnit)
      : 0;

    return {
      recommendedDemand,
      conservativeDemand,
      uncertaintyDemand,
      reviewDemand,
      materialCode: bomLine.materialCode,
      materialName: bomLine.materialName,
      unit: bomLine.unit,
      sourceOrderId: item.orderId,
      sourceOrderNumber: item.orderNumber,
      sourceItemId: item.itemId,
      productCode: item.productCode,
      productName: item.productName,
      status: classification.status,
      factorUsed,
      explanation: buildDemandExplanation(classification, bomLine, factorUsed),
      classification,
    };
  });
}

export function buildRawMaterialIntelligenceSummary(
  items: RawMaterialDemandLineResult[]
): RawMaterialIntelligenceSummary {
  const byMaterialMap = new Map<string, RawMaterialIntelligenceMaterialAggregate>();
  const reviewedItemIds = new Set<string>();
  const missingBomItemIds = new Set<string>();
  const confidenceCounts = { highCount: 0, mediumCount: 0, lowCount: 0 };
  const seenClassificationKeys = new Set<string>();

  let recommendedDemandTotal = 0;
  let conservativeDemandTotal = 0;
  let uncertaintyDemandTotal = 0;
  let unservedRevenuePotential = 0;
  let criticalBalanceOver30Days = 0;

  for (const row of items) {
    recommendedDemandTotal += safeNonNegativeNumber(row.recommendedDemand);
    conservativeDemandTotal += safeNonNegativeNumber(row.conservativeDemand);
    uncertaintyDemandTotal += safeNonNegativeNumber(row.uncertaintyDemand);

    const key = `${row.sourceItemId}:${row.materialCode}`;
    const existing = byMaterialMap.get(key) ?? {
      materialCode: row.materialCode,
      materialName: row.materialName,
      unit: row.unit,
      recommendedDemand: 0,
      conservativeDemand: 0,
      uncertaintyDemand: 0,
      reviewDemand: 0,
    };
    existing.recommendedDemand += safeNonNegativeNumber(row.recommendedDemand);
    existing.conservativeDemand += safeNonNegativeNumber(row.conservativeDemand);
    existing.uncertaintyDemand += safeNonNegativeNumber(row.uncertaintyDemand);
    existing.reviewDemand += safeNonNegativeNumber(row.reviewDemand);
    byMaterialMap.set(key, existing);

    const classKey = row.sourceItemId;
    if (!seenClassificationKeys.has(classKey)) {
      seenClassificationKeys.add(classKey);
      const cls = row.classification;
      if (cls.reviewRequired) reviewedItemIds.add(classKey);
      if (cls.status === "MISSING_BOM") missingBomItemIds.add(classKey);
      if (cls.includeInUnservedRevenue) {
        unservedRevenuePotential += safeNonNegativeNumber(cls.openNetAmount);
      }
      if (cls.status === "CRITICAL_UNSERVED_BALANCE_30D") {
        criticalBalanceOver30Days += safeNonNegativeNumber(cls.openNetAmount);
      }
      if (cls.confidence === "HIGH") confidenceCounts.highCount += 1;
      else if (cls.confidence === "MEDIUM") confidenceCounts.mediumCount += 1;
      else confidenceCounts.lowCount += 1;
    }
  }

  const totalClassified = Math.max(
    1,
    confidenceCounts.highCount + confidenceCounts.mediumCount + confidenceCounts.lowCount
  );
  const overallScore = roundDemand(
    ((confidenceCounts.highCount * 100 +
      confidenceCounts.mediumCount * 60 +
      confidenceCounts.lowCount * 20) /
      totalClassified)
  );

  return {
    recommendedDemandTotal: roundDemand(recommendedDemandTotal),
    conservativeDemandTotal: roundDemand(conservativeDemandTotal),
    uncertaintyDemandTotal: roundDemand(uncertaintyDemandTotal),
    reviewItemsCount: reviewedItemIds.size,
    unservedRevenuePotential: roundDemand(unservedRevenuePotential),
    criticalBalanceOver30Days: roundDemand(criticalBalanceOver30Days),
    missingBomItemsCount: missingBomItemIds.size,
    reliability: {
      ...confidenceCounts,
      overallScore,
    },
    byMaterial: [...byMaterialMap.values()].map((row) => ({
      ...row,
      recommendedDemand: roundDemand(row.recommendedDemand),
      conservativeDemand: roundDemand(row.conservativeDemand),
      uncertaintyDemand: roundDemand(row.uncertaintyDemand),
      reviewDemand: roundDemand(row.reviewDemand),
    })),
  };
}
