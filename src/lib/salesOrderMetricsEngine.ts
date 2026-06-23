/**
 * Camada única de métricas/status de Pedido de Venda.
 * Facade oficial — todos os módulos devem consumir daqui em vez de recalcular.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";
import { loadSalesOrderLinkedNfeContextMap, type SalesOrderLinkedNfeContext } from "./salesOrderLinkedNfe.js";
import { buildSalesOrderLinkedNfeContext } from "./salesOrderLinkedNfe.js";
import { buildManagementRowsFromOrders } from "./salesOrderManagement.js";
import type { SalesOrderManagementRow } from "./salesOrderManagementTypes.js";
import type { ManagementStatusCardId } from "./salesOrderManagementStatus.js";
import { isCancelledSalesOrderStatus } from "./salesOrderDashboardRules.js";

export const SALES_ORDER_METRICS_ENGINE_VERSION = "1.0.0";

export type SalesOrderMetricsRiskLevel = "none" | "low" | "medium" | "high";

/** DTO oficial enriquecido — contrato único para consumidores. */
export type SalesOrderEnrichedMetrics = {
  salesOrderId: string;
  externalSalesOrderId?: number | null;
  customerId?: string | null;
  orderCode: string;
  customerName: string;
  sellerName: string | null;
  companyIssuer: string | null;
  issueDate: string | null;
  expectedDeliveryDate: string | null;
  orderStatus: string;
  totalNetValue: number;
  hasNfe: boolean;
  nfeCount: number;
  nfeNumbers: string[];
  firstNfeDate: string | null;
  lastNfeDate: string | null;
  nfeTotalValue: number;
  invoiceCoveragePercent: number | null;
  fulfillmentPercent: number | null;
  isFullyInvoiced: boolean;
  isPartiallyInvoiced: boolean;
  isPendingInvoice: boolean;
  hasCut: boolean;
  isOnTime: boolean | null;
  isLate: boolean | null;
  daysLate: number | null;
  slaDays: number | null;
  logisticStatus: string;
  logisticStatusCardId: ManagementStatusCardId;
  managementStatus: string;
  deadlineStatus: string;
  riskLevel: SalesOrderMetricsRiskLevel;
  needsDataReview: boolean;
  reviewReasons: string[];
  linkedNfeSource?: "linked" | "raw_fallback";
};

export type SalesOrderMetricsEngineInput = {
  id: string;
  orderCode: string;
  status: string;
  customerId?: string | null;
  issueDate: Date;
  expectedDeliveryDate: Date | null;
  totalNetValue: unknown;
  responsible: string | null;
  nomusRawResponse: unknown;
  companyIssuer?: string | null;
  externalSalesOrderId?: number | null;
  Customer?: { companyName?: string | null; tradeName?: string | null; taxId?: string | null };
  items: Array<{
    id: string;
    externalProductId?: number | null;
    skuSnapshot?: string | null;
    productNameSnapshot?: string | null;
    quantity: unknown;
  }>;
};

export type SalesOrderMetricsAggregate = {
  totalOrders: number;
  totalSoldValue: number;
  totalInvoicedValue: number;
  soldInvoicedGap: number;
  invoiceCoveragePercent: number | null;
  withNfeCount: number;
  withoutNfeCount: number;
  deliveredOnTimeCount: number;
  deliveredLateCount: number;
  pendingOnTimeCount: number;
  pendingLateCount: number;
  partialCount: number;
  withCutCount: number;
  reviewCount: number;
  cancelledCount: number;
  finishedOrCancelledCount: number;
  byLogisticStatus: Record<string, { count: number; value: number }>;
};

export type SalesOperationalFunnelStageId =
  | "sold"
  | "withNfe"
  | "invoicedOnTime"
  | "invoicedLate"
  | "pendingNoNfe"
  | "pendingLate"
  | "partial"
  | "withCut"
  | "cancelled"
  | "reviewData";

export type SalesOperationalFunnelStage = {
  id: SalesOperationalFunnelStageId;
  label: string;
  description: string;
  count: number;
  value: number;
};

function resolveRiskLevel(row: SalesOrderManagementRow): SalesOrderMetricsRiskLevel {
  if (row.highRiskCount > 0) return "high";
  if (row.riskCount > 0) return "medium";
  if (row.needsDataReview) return "low";
  return "none";
}

export function enrichedMetricsFromManagementRow(
  row: SalesOrderManagementRow,
  extra?: { externalSalesOrderId?: number | null; linkStatus?: string; customerId?: string | null }
): SalesOrderEnrichedMetrics {
  const isFullyInvoiced =
    row.invoiceCoveragePercent != null && row.invoiceCoveragePercent >= 99.99;
  const isPartiallyInvoiced =
    row.hasInvoice &&
    row.invoiceCoveragePercent != null &&
    row.invoiceCoveragePercent > 0 &&
    row.invoiceCoveragePercent < 99.99;
  const isPendingInvoice = !row.hasInvoice || (row.invoicedValue ?? 0) <= 0;

  let isOnTime: boolean | null = null;
  let isLate: boolean | null = null;
  if (row.slaStatus === "on_time") {
    isOnTime = true;
    isLate = false;
  } else if (row.slaStatus === "late") {
    isOnTime = false;
    isLate = true;
  } else if (row.logisticStatusCardId === "deliveredOnTime" || row.logisticStatusCardId === "onTimePending") {
    isOnTime = true;
    isLate = false;
  } else if (row.logisticStatusCardId === "deliveredLate" || row.logisticStatusCardId === "overduePending") {
    isOnTime = false;
    isLate = true;
  }

  return {
    salesOrderId: row.id,
    externalSalesOrderId: extra?.externalSalesOrderId ?? null,
    customerId: extra?.customerId ?? null,
    orderCode: row.orderCode,
    customerName: row.customerName,
    sellerName: row.sellerName ?? row.responsible,
    companyIssuer: row.companyName ?? null,
    issueDate: row.issueDate ?? null,
    expectedDeliveryDate: row.expectedDeliveryDate ?? null,
    orderStatus: extra?.linkStatus ?? row.operationalStatus,
    totalNetValue: row.totalNetValue ?? 0,
    hasNfe: row.hasInvoice,
    nfeCount: row.nfeCount,
    nfeNumbers: row.invoiceNumbers,
    firstNfeDate: null,
    lastNfeDate: row.lastInvoiceDate ?? null,
    nfeTotalValue: row.invoicedValue ?? 0,
    invoiceCoveragePercent: row.invoiceCoveragePercent ?? row.invoicedPercent,
    fulfillmentPercent: row.fulfilledPercent,
    isFullyInvoiced,
    isPartiallyInvoiced,
    isPendingInvoice,
    hasCut: row.hasCut,
    isOnTime,
    isLate,
    daysLate: row.daysOverdue,
    slaDays: row.slaDays,
    logisticStatus: row.logisticStatusLabel,
    logisticStatusCardId: row.logisticStatusCardId,
    managementStatus: row.executiveStatusLabel,
    deadlineStatus: row.deadlineStatus,
    riskLevel: resolveRiskLevel(row),
    needsDataReview: row.needsDataReview,
    reviewReasons: row.reviewReasons,
    linkedNfeSource: row.linkedNfeSource,
  };
}

/** Fallback legado — NF com dataProcessamento no raw quando extração estruturada não encontra id. */
function legacyRawHasProcessedNfe(nomusRawResponse: unknown): boolean {
  if (!nomusRawResponse || typeof nomusRawResponse !== "object") return false;
  const nfes = (nomusRawResponse as { nfes?: unknown }).nfes;
  if (!Array.isArray(nfes)) return false;
  return nfes.some((nfe) => {
    if (!nfe || typeof nfe !== "object") return false;
    const dp = String((nfe as { dataProcessamento?: unknown }).dataProcessamento ?? "").trim();
    return dp.length > 0;
  });
}

/** Resolve hasNfe usando motor linked NFe (fallback raw dentro do motor). */
export function resolveSalesOrderHasNfe(input: {
  nomusRawResponse?: unknown;
  linkedNfeContext?: SalesOrderLinkedNfeContext | null;
  totalNetValue?: unknown;
  issueDate?: Date | string | null;
  expectedDeliveryDate?: Date | string | null;
}): boolean {
  if (input.linkedNfeContext) return input.linkedNfeContext.hasNfe;
  const ctx = buildSalesOrderLinkedNfeContext({
    links: [],
    nomusRawResponse: input.nomusRawResponse,
    totalNetValue: input.totalNetValue as number | null | undefined,
    issueDate: input.issueDate,
    expectedDeliveryDate: input.expectedDeliveryDate,
  });
  if (ctx.hasNfe) return true;
  return legacyRawHasProcessedNfe(input.nomusRawResponse);
}

/** @deprecated Use resolveSalesOrderHasNfe — alias para compatibilidade. */
export function salesOrderHasInvoicingFromEngine(nomusRawResponse: unknown): boolean {
  return resolveSalesOrderHasNfe({ nomusRawResponse });
}

export function buildSalesOrderEnrichedMetricsBatch(
  orders: SalesOrderMetricsEngineInput[],
  referenceDate = new Date(),
  linkedNfeContextMap?: Map<string, SalesOrderLinkedNfeContext>
): SalesOrderEnrichedMetrics[] {
  if (orders.length === 0) return [];
  const { rows } = buildManagementRowsFromOrders(orders, {}, referenceDate, linkedNfeContextMap);
  const byId = new Map(rows.map((row) => [row.id, row]));
  return orders.map((order) => {
    const row = byId.get(order.id);
    if (!row) {
      throw new Error(`Motor não produziu métricas para pedido ${order.id}`);
    }
    return enrichedMetricsFromManagementRow(row, {
      externalSalesOrderId: order.externalSalesOrderId ?? null,
      linkStatus: order.status,
      customerId: order.customerId ?? null,
    });
  });
}

export async function loadSalesOrderEnrichedMetricsMap(
  orders: SalesOrderMetricsEngineInput[],
  referenceDate = new Date()
): Promise<Map<string, SalesOrderEnrichedMetrics>> {
  if (orders.length === 0) return new Map();
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
  const metrics = buildSalesOrderEnrichedMetricsBatch(orders, referenceDate, linkedMap);
  return new Map(metrics.map((m) => [m.salesOrderId, m]));
}

const DEFAULT_ORDER_SELECT = {
  id: true,
  customerId: true,
  orderCode: true,
  status: true,
  issueDate: true,
  expectedDeliveryDate: true,
  totalNetValue: true,
  responsible: true,
  nomusRawResponse: true,
  companyIssuer: true,
  externalSalesOrderId: true,
  Customer: { select: { companyName: true, tradeName: true, taxId: true } },
  items: {
    select: {
      id: true,
      externalProductId: true,
      skuSnapshot: true,
      productNameSnapshot: true,
      quantity: true,
    },
  },
} as const;

export async function loadSalesOrderEnrichedMetricsFromDb(
  where: Prisma.SalesOrderWhereInput,
  referenceDate = new Date()
): Promise<SalesOrderEnrichedMetrics[]> {
  const orders = await prisma.salesOrder.findMany({
    where,
    select: DEFAULT_ORDER_SELECT,
  });
  const map = await loadSalesOrderEnrichedMetricsMap(orders, referenceDate);
  return orders.map((order) => map.get(order.id)!);
}

export async function loadSalesOrderEnrichedMetricsForIssueYear(
  year: number,
  referenceDate = new Date()
): Promise<SalesOrderEnrichedMetrics[]> {
  const start = new Date(year, 0, 1);
  const end = new Date(year, 11, 31, 23, 59, 59, 999);
  return loadSalesOrderEnrichedMetricsFromDb(
    { issueDate: { gte: start, lte: end } },
    referenceDate
  );
}

export function aggregateSalesOrderMetrics(
  metrics: SalesOrderEnrichedMetrics[]
): SalesOrderMetricsAggregate {
  let totalSoldValue = 0;
  let totalInvoicedValue = 0;
  let withNfeCount = 0;
  let withoutNfeCount = 0;
  let deliveredOnTimeCount = 0;
  let deliveredLateCount = 0;
  let pendingOnTimeCount = 0;
  let pendingLateCount = 0;
  let partialCount = 0;
  let withCutCount = 0;
  let reviewCount = 0;
  let cancelledCount = 0;
  let finishedOrCancelledCount = 0;
  const byLogisticStatus: Record<string, { count: number; value: number }> = {};

  for (const m of metrics) {
    if (isCancelledSalesOrderStatus(m.orderStatus) || m.logisticStatusCardId === "finishedOrCancelled") {
      if (isCancelledSalesOrderStatus(m.orderStatus)) cancelledCount += 1;
      else finishedOrCancelledCount += 1;
      continue;
    }

    totalSoldValue += m.totalNetValue;
    totalInvoicedValue += m.nfeTotalValue;
    if (m.hasNfe) withNfeCount += 1;
    else withoutNfeCount += 1;

    switch (m.logisticStatusCardId) {
      case "deliveredOnTime":
        deliveredOnTimeCount += 1;
        break;
      case "deliveredLate":
        deliveredLateCount += 1;
        break;
      case "onTimePending":
        pendingOnTimeCount += 1;
        break;
      case "overduePending":
        pendingLateCount += 1;
        break;
      case "reviewData":
        reviewCount += 1;
        break;
      default:
        break;
    }

    if (m.isPartiallyInvoiced || m.fulfillmentPercent != null && m.fulfillmentPercent > 0 && m.fulfillmentPercent < 99.99) {
      partialCount += 1;
    }
    if (m.hasCut) withCutCount += 1;
    if (m.needsDataReview) reviewCount += 1;

    const bucket = byLogisticStatus[m.logisticStatus] ?? { count: 0, value: 0 };
    bucket.count += 1;
    bucket.value += m.totalNetValue;
    byLogisticStatus[m.logisticStatus] = bucket;
  }

  const activeCount =
    metrics.length - cancelledCount - finishedOrCancelledCount;

  return {
    totalOrders: activeCount,
    totalSoldValue,
    totalInvoicedValue,
    soldInvoicedGap: totalSoldValue - totalInvoicedValue,
    invoiceCoveragePercent:
      totalSoldValue > 0 ? Math.round((totalInvoicedValue / totalSoldValue) * 10000) / 100 : null,
    withNfeCount,
    withoutNfeCount,
    deliveredOnTimeCount,
    deliveredLateCount,
    pendingOnTimeCount,
    pendingLateCount,
    partialCount,
    withCutCount,
    reviewCount,
    cancelledCount,
    finishedOrCancelledCount,
    byLogisticStatus,
  };
}

export function buildOperationalFunnelStages(
  metrics: SalesOrderEnrichedMetrics[]
): SalesOperationalFunnelStage[] {
  const valid = metrics.filter(
    (m) => !isCancelledSalesOrderStatus(m.orderStatus) && m.logisticStatusCardId !== "finishedOrCancelled"
  );
  const sum = (pred: (m: SalesOrderEnrichedMetrics) => boolean) => {
    let count = 0;
    let value = 0;
    for (const m of valid) {
      if (pred(m)) {
        count += 1;
        value += m.totalNetValue;
      }
    }
    return { count, value };
  };

  const sold = { count: valid.length, value: valid.reduce((s, m) => s + m.totalNetValue, 0) };
  const withNfe = sum((m) => m.hasNfe);
  const invoicedOnTime = sum((m) => m.logisticStatusCardId === "deliveredOnTime");
  const invoicedLate = sum((m) => m.logisticStatusCardId === "deliveredLate");
  const pendingNoNfe = sum((m) => !m.hasNfe && m.logisticStatusCardId === "onTimePending");
  const pendingLate = sum((m) => m.logisticStatusCardId === "overduePending");
  const partial = sum((m) => m.isPartiallyInvoiced);
  const withCut = sum((m) => m.hasCut);
  const reviewData = sum((m) => m.needsDataReview || m.logisticStatusCardId === "reviewData");
  let cancelledCount = 0;
  let cancelledValue = 0;
  for (const m of metrics) {
    if (isCancelledSalesOrderStatus(m.orderStatus)) {
      cancelledCount += 1;
      cancelledValue += m.totalNetValue;
    }
  }
  const cancelled = { count: cancelledCount, value: cancelledValue };

  return [
    {
      id: "sold",
      label: "Pedidos vendidos",
      description: "Pedidos emitidos no período (exc. cancelados/finalizados BI).",
      ...sold,
    },
    {
      id: "withNfe",
      label: "Com NF / faturados",
      description: "Pedidos com ao menos uma NF-e vinculada processada.",
      ...withNfe,
    },
    {
      id: "invoicedOnTime",
      label: "Faturados no prazo",
      description: "Status logístico BI: Entregue no Prazo.",
      ...invoicedOnTime,
    },
    {
      id: "invoicedLate",
      label: "Faturados com atraso",
      description: "Status logístico BI: Entregue com Atraso.",
      ...invoicedLate,
    },
    {
      id: "pendingNoNfe",
      label: "Pendentes sem NF",
      description: "Sem NF e ainda no prazo (pendente).",
      ...pendingNoNfe,
    },
    {
      id: "pendingLate",
      label: "Pendentes atrasados",
      description: "Sem NF completa e prazo vencido.",
      ...pendingLate,
    },
    {
      id: "partial",
      label: "Parciais",
      description: "Faturamento ou atendimento parcial.",
      ...partial,
    },
    {
      id: "withCut",
      label: "Com corte",
      description: "Atendimento com corte.",
      ...withCut,
    },
    {
      id: "reviewData",
      label: "Revisar dados",
      description: "Dados insuficientes ou divergentes para cálculo confiável.",
      ...reviewData,
    },
    {
      id: "cancelled",
      label: "Cancelados",
      description: "Pedidos cancelados no período.",
      ...cancelled,
    },
  ];
}

/** Pedido elegível como demanda de matéria-prima (exclui cancelados/finalizados). */
export function isSalesOrderDemandEligible(metrics: SalesOrderEnrichedMetrics): boolean {
  if (isCancelledSalesOrderStatus(metrics.orderStatus)) return false;
  if (metrics.logisticStatusCardId === "finishedOrCancelled") return false;
  return true;
}

/** Filtro de escopo faturamento para demanda MP. */
export function matchesMaterialDemandInvoicingScope(
  metrics: SalesOrderEnrichedMetrics,
  scope: "all" | "invoiced" | "portfolio"
): boolean {
  if (scope === "all") return true;
  if (scope === "invoiced") return metrics.hasNfe && metrics.isFullyInvoiced;
  return metrics.isPendingInvoice || metrics.isPartiallyInvoiced;
}

export const LOGISTIC_STATUS_BADGE_TONE: Record<
  ManagementStatusCardId,
  "success" | "warning" | "danger" | "neutral" | "info"
> = {
  deliveredOnTime: "success",
  deliveredLate: "danger",
  onTimePending: "info",
  overduePending: "danger",
  finishedOrCancelled: "neutral",
  reviewData: "warning",
};

export function logisticStatusBadgeTone(
  cardId: ManagementStatusCardId
): "success" | "warning" | "danger" | "neutral" | "info" {
  return LOGISTIC_STATUS_BADGE_TONE[cardId] ?? "neutral";
}
