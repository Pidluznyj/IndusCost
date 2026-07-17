/**
 * OP-61 — Contrato puro do detalhe/timeline do Fluxo de Pedidos.
 */

import {
  SALES_ORDER_FLOW_STAGE_LABELS,
  SALES_ORDER_FLOW_STAGE_NEXT_ACTION,
  SALES_ORDER_FLOW_STAGE_RESPONSIBLE_AREA,
  isSalesOrderFlowStage,
  type SalesOrderFlowStage,
} from "./salesOrderFlowCatalog.js";
import { calculateDaysInCurrentStage } from "./salesOrderFlowDaysInStage.js";
import {
  parseSalesOrderFlowBadges,
  parseSalesOrderFlowInconsistencies,
  type SalesOrderFlowListInconsistency,
} from "./salesOrderFlowList.js";
import { SALES_ORDER_FLOW_EVENT_TYPES } from "./salesOrderFlowTimeline.js";
import { isUuidLike } from "./salesOrderFlowRebuild.js";

export class SalesOrderFlowDetailQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SalesOrderFlowDetailQueryError";
  }
}

export type SalesOrderFlowDetailOfficialLinks = {
  salesOrder: string;
  salesOrderPrint: string;
  salesOrderDetailApi: string;
  salesOrderIntelligenceApi: string;
  outputDocuments: string;
  productionOrders: string;
  /** Auditoria 360° (Conciliação de Carteira). */
  portfolioAudit360: string;
};

export type SalesOrderFlowDetailColumnExplanation = {
  stage: SalesOrderFlowStage | null;
  label: string | null;
  reason: string;
  responsibleArea: string | null;
  nextAction: string | null;
};

export type SalesOrderFlowDetailBottleneck = {
  stage: string | null;
  salesOrderItemId: string | null;
  reason: string | null;
};

export type SalesOrderFlowDetailFinancialSituation = {
  orderValue: number | null;
  fulfilledValue: number | null;
  activeResidualValue: number | null;
  cutValue: number | null;
  canceledValue: number | null;
  documentCount: number;
  validNfeCount: number;
  canceledNfeCount: number;
};

export type SalesOrderFlowDetailManagement = {
  priority: string;
  responsibleUserId: string | null;
  responsibleName: string | null;
  responsibleArea: string | null;
  isBlocked: boolean;
  blockReason: string | null;
  reason: string | null;
  expectedResolutionAt: string | null;
  internalNote: string | null;
  /** Para concorrência otimista no PATCH de management. */
  updatedAt: string | null;
};

export type SalesOrderFlowDetailPayload = {
  salesOrderId: string;
  recomputable: boolean;
  snapshotStatus: "READY" | "SNAPSHOT_MISSING";
  message: string | null;
  order: {
    orderCode: string;
    customerId: string;
    customerName: string | null;
    sellerName: string | null;
    companyIssuer: string | null;
    issueDate: string | null;
    expectedDeliveryDate: string | null;
    status: string;
    manualMetadata: {
      notes: string | null;
      internalNotes: string | null;
      responsible: string | null;
      paymentTerms: string | null;
      paymentMethod: string | null;
      freightCondition: string | null;
      deliveryLocation: string | null;
    };
  };
  orderSnapshot: Record<string, unknown> | null;
  itemSnapshots: Array<Record<string, unknown>>;
  columnExplanation: SalesOrderFlowDetailColumnExplanation;
  bottleneck: SalesOrderFlowDetailBottleneck | null;
  nextAction: string | null;
  responsibleArea: string | null;
  progress: {
    productionOrder: number | null;
    produced: number | null;
    documented: number | null;
    invoiced: number | null;
    shipped: number | null;
  } | null;
  shipmentDates: {
    firstShippedAt: string | null;
    lastShippedAt: string | null;
    completedAt: string | null;
    promisedDeliveryAt: string | null;
    isOverdue: boolean | null;
  } | null;
  productionOrders: Array<Record<string, unknown>>;
  stockDocuments: Array<Record<string, unknown>>;
  nfes: Array<Record<string, unknown>>;
  financialSituation: SalesOrderFlowDetailFinancialSituation | null;
  inconsistencies: SalesOrderFlowListInconsistency[];
  badges: string[];
  management: SalesOrderFlowDetailManagement | null;
  officialLinks: SalesOrderFlowDetailOfficialLinks;
  valuesVisible: boolean;
  productionVisible: boolean;
  fiscalVisible: boolean;
  financialVisible: boolean;
  inconsistenciesVisible: boolean;
  timelineVisible: boolean;
  generatedAt: string;
};

export type SalesOrderFlowEventsPayload = {
  salesOrderId: string;
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
  filters: {
    eventType: string | null;
    salesOrderItemId: string | null;
  };
  items: Array<{
    id: string;
    eventType: string;
    fromStage: string | null;
    toStage: string | null;
    salesOrderItemId: string | null;
    dedupeKey: string;
    details: unknown;
    actorId: string | null;
    occurredAt: string;
    observedAt: string | null;
    createdAt: string;
  }>;
  generatedAt: string;
};

function decimalNumber(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof value === "object" && value !== null && "toNumber" in value) {
    const n = (value as { toNumber: () => number }).toNumber();
    return Number.isFinite(n) ? n : 0;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function dateIso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function assertSalesOrderFlowDetailId(raw: string): string {
  const id = raw.trim();
  if (!id || !isUuidLike(id)) {
    throw new SalesOrderFlowDetailQueryError("salesOrderId inválido.");
  }
  return id;
}

export function buildSalesOrderFlowOfficialLinks(
  salesOrderId: string,
  orderCode?: string | null
): SalesOrderFlowDetailOfficialLinks {
  const code = orderCode?.trim() || "";
  return {
    salesOrder: `/sales-orders/${salesOrderId}`,
    salesOrderPrint: `/sales-orders/${salesOrderId}/print`,
    salesOrderDetailApi: `/api/sales-orders/${salesOrderId}/detail`,
    salesOrderIntelligenceApi: `/api/sales-orders/${salesOrderId}/intelligence`,
    outputDocuments: code
      ? `/output-documents?order=${encodeURIComponent(code)}`
      : `/output-documents`,
    productionOrders: code
      ? `/production-orders?search=${encodeURIComponent(code)}`
      : `/production-orders`,
    portfolioAudit360: `/finance/portfolio-reconciliation?auditOrderId=${encodeURIComponent(salesOrderId)}`,
  };
}

export function buildColumnExplanation(input: {
  currentStage: string | null | undefined;
  nextAction?: string | null;
  responsibleArea?: string | null;
  bottleneckReason?: string | null;
  recomputable: boolean;
}): SalesOrderFlowDetailColumnExplanation {
  if (input.recomputable || !input.currentStage) {
    return {
      stage: null,
      label: null,
      reason:
        "Snapshot ainda não materializado. A coluna será definida após recomputação/rebuild.",
      responsibleArea: null,
      nextAction: "Executar rebuild/recompute do Fluxo de Pedidos.",
    };
  }
  const stage = isSalesOrderFlowStage(input.currentStage)
    ? input.currentStage
    : null;
  return {
    stage,
    label: stage ? SALES_ORDER_FLOW_STAGE_LABELS[stage] : input.currentStage,
    reason:
      input.bottleneckReason?.trim() ||
      (stage
        ? `Pedido na coluna ${SALES_ORDER_FLOW_STAGE_LABELS[stage]} (primeira obrigação ativa).`
        : "Etapa consolidada do snapshot."),
    responsibleArea:
      input.responsibleArea ??
      (stage ? SALES_ORDER_FLOW_STAGE_RESPONSIBLE_AREA[stage] : null),
    nextAction:
      input.nextAction ??
      (stage ? SALES_ORDER_FLOW_STAGE_NEXT_ACTION[stage] : null),
  };
}

export function mapOrderSnapshotForDetail(
  row: Record<string, unknown> | null,
  options: {
    canViewValues: boolean;
    canViewProduction?: boolean;
    canViewInconsistencies?: boolean;
    now?: Date;
  }
): Record<string, unknown> | null {
  if (!row) return null;
  const stageEnteredAt = null;
  const values = options.canViewValues;
  const production = options.canViewProduction !== false;
  const inconsistencies = options.canViewInconsistencies !== false;
  return {
    currentStage: row.currentStage ?? null,
    bottleneckStage: row.bottleneckStage ?? null,
    bottleneckSalesOrderItemId: row.bottleneckSalesOrderItemId ?? null,
    bottleneckReason: row.bottleneckReason ?? null,
    nextAction: row.nextAction ?? null,
    responsibleArea: row.responsibleArea ?? null,
    totalItems: row.totalItems ?? 0,
    activeItems: row.activeItems ?? 0,
    completedItems: row.completedItems ?? 0,
    pendingItems: row.pendingItems ?? 0,
    inconsistentItems: inconsistencies ? (row.inconsistentItems ?? 0) : null,
    canceledItems: row.canceledItems ?? 0,
    progressProductionOrder: production
      ? decimalNumber(row.progressProductionOrder)
      : null,
    progressProduced:
      !production || row.progressProduced == null
        ? null
        : decimalNumber(row.progressProduced),
    progressDocumented: decimalNumber(row.progressDocumented),
    progressInvoiced: decimalNumber(row.progressInvoiced),
    progressShipped: decimalNumber(row.progressShipped),
    orderValue: values ? decimalNumber(row.orderValue) : null,
    fulfilledValue: values ? decimalNumber(row.fulfilledValue) : null,
    activeResidualValue: values
      ? decimalNumber(row.activeResidualValue)
      : null,
    cutValue: values ? decimalNumber(row.cutValue) : null,
    canceledValue: values ? decimalNumber(row.canceledValue) : null,
    firstShippedAt: dateIso(row.firstShippedAt as Date | string | null),
    lastShippedAt: dateIso(row.lastShippedAt as Date | string | null),
    completedAt: dateIso(row.completedAt as Date | string | null),
    promisedDeliveryAt: dateIso(row.promisedDeliveryAt as Date | string | null),
    isOverdue: row.isOverdue === true,
    isInActiveOperationalColumn: row.isInActiveOperationalColumn !== false,
    inconsistencies: inconsistencies
      ? parseSalesOrderFlowInconsistencies(row.inconsistenciesJson)
      : [],
    badges: parseSalesOrderFlowBadges(row.badgesJson),
    fingerprint: row.fingerprint ?? null,
    computationVersion: row.computationVersion ?? null,
    computedAt: dateIso(row.computedAt as Date | string | null),
    stageEnteredAt,
    daysInStage: calculateDaysInCurrentStage(
      stageEnteredAt,
      options.now ?? new Date()
    ),
  };
}

export function mapItemSnapshotForDetail(
  row: Record<string, unknown>,
  options: {
    canViewValues: boolean;
    canViewProduction?: boolean;
    canViewInconsistencies?: boolean;
    now?: Date;
  }
): Record<string, unknown> {
  const production = options.canViewProduction !== false;
  const inconsistencies = options.canViewInconsistencies !== false;
  return {
    salesOrderItemId: row.salesOrderItemId,
    currentStage: row.currentStage ?? null,
    fulfillmentClassification: row.fulfillmentClassification ?? null,
    orderedQuantity: decimalNumber(row.orderedQuantity),
    activeRemainingQuantity: decimalNumber(row.activeRemainingQuantity),
    documentedQuantity: decimalNumber(row.documentedQuantity),
    invoicedQuantity: decimalNumber(row.invoicedQuantity),
    shippedQuantity: decimalNumber(row.shippedQuantity),
    cutQuantity: decimalNumber(row.cutQuantity),
    canceledQuantity: decimalNumber(row.canceledQuantity),
    shipTargetQuantity: decimalNumber(row.shipTargetQuantity),
    progressProductionOrder: production
      ? decimalNumber(row.progressProductionOrder)
      : null,
    progressProduced:
      !production || row.progressProduced == null
        ? null
        : decimalNumber(row.progressProduced),
    progressDocumented: decimalNumber(row.progressDocumented),
    progressInvoiced: decimalNumber(row.progressInvoiced),
    progressShipped: decimalNumber(row.progressShipped),
    nextAction: row.nextAction ?? null,
    responsibleArea: row.responsibleArea ?? null,
    stageEnteredAt: dateIso(row.stageEnteredAt as Date | string | null),
    daysInStage: calculateDaysInCurrentStage(
      row.stageEnteredAt as Date | string | null,
      options.now ?? new Date()
    ),
    promisedDeliveryAt: dateIso(row.promisedDeliveryAt as Date | string | null),
    isOverdue: row.isOverdue === true,
    isActiveForKanban: row.isActiveForKanban !== false,
    inconsistencies: inconsistencies
      ? parseSalesOrderFlowInconsistencies(row.inconsistenciesJson)
      : [],
    fingerprint: row.fingerprint ?? null,
    computationVersion: row.computationVersion ?? null,
    computedAt: dateIso(row.computedAt as Date | string | null),
  };
}

export function mapNfeForDetail(
  nfe: {
    externalId: number;
    nomusNfeId: string | null;
    numero: string | null;
    serie?: string | null;
    chave: string | null;
    statusRaw: number | null;
    issuedAt?: string | null;
    statusNormalized: {
      statusNormalized?: string;
      label?: string;
      isCanceled?: boolean;
      isValidForBilling?: boolean;
    };
    isCanceled: boolean;
    isValidForBilling: boolean;
    sources: string[];
  },
  fiscalVisible: boolean
): Record<string, unknown> {
  return {
    externalId: nfe.externalId,
    nomusNfeId: nfe.nomusNfeId,
    numero: nfe.numero,
    serie: nfe.serie ?? null,
    chave: fiscalVisible ? nfe.chave : null,
    statusRaw: nfe.statusRaw,
    issuedAt: nfe.issuedAt ?? null,
    statusNormalized: {
      code: nfe.statusNormalized.statusNormalized ?? null,
      label: nfe.statusNormalized.label ?? null,
    },
    isCanceled: nfe.isCanceled,
    isValidForBilling: nfe.isValidForBilling,
    sources: nfe.sources,
  };
}

export function parseSalesOrderFlowEventsQuery(
  query: Record<string, unknown>
): {
  page: number;
  pageSize: number;
  eventType: string | null;
  salesOrderItemId: string | null;
} {
  const pageRaw = Number(query.page ?? 0);
  const page = Number.isFinite(pageRaw) && pageRaw >= 0 ? Math.trunc(pageRaw) : 0;
  const sizeRaw = Number(query.pageSize ?? query.limit ?? 50);
  const pageSize = Number.isFinite(sizeRaw)
    ? Math.min(500, Math.max(1, Math.trunc(sizeRaw)))
    : 50;
  const eventType =
    typeof query.eventType === "string" && query.eventType.trim()
      ? query.eventType.trim()
      : null;
  if (
    eventType &&
    !(SALES_ORDER_FLOW_EVENT_TYPES as readonly string[]).includes(eventType)
  ) {
    throw new SalesOrderFlowDetailQueryError(
      `eventType inválido: ${eventType}`
    );
  }
  const salesOrderItemId =
    typeof query.salesOrderItemId === "string" && query.salesOrderItemId.trim()
      ? query.salesOrderItemId.trim()
      : null;
  if (salesOrderItemId && !isUuidLike(salesOrderItemId)) {
    throw new SalesOrderFlowDetailQueryError("salesOrderItemId inválido.");
  }
  return { page, pageSize, eventType, salesOrderItemId };
}
