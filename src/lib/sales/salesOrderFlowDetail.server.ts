/**
 * OP-61 — Loader do detalhe/timeline do Fluxo de Pedidos.
 * Sem Nomus HTTP. Sem rawJson. Reutiliza evidências + repositories.
 */

import type { PrismaClient } from "@prisma/client";
import { loadSalesOrderFlowEvidence } from "./salesOrderFlowEvidence.server.js";
import type { SalesOrderFlowEvidencePack } from "./salesOrderFlowEvidence.js";
import {
  findSalesOrderFlowEventsByOrderId,
  findSalesOrderFlowManagementByOrderId,
  findSalesOrderFlowSnapshotByOrderId,
  findSalesOrderItemFlowSnapshotsByOrderId,
} from "./salesOrderFlowRepository.server.js";
import {
  assertSalesOrderFlowDetailId,
  buildColumnExplanation,
  buildSalesOrderFlowOfficialLinks,
  mapItemSnapshotForDetail,
  mapNfeForDetail,
  mapOrderSnapshotForDetail,
  parseSalesOrderFlowEventsQuery,
  SalesOrderFlowDetailQueryError,
  type SalesOrderFlowDetailPayload,
  type SalesOrderFlowEventsPayload,
} from "./salesOrderFlowDetail.js";
import { parseSalesOrderFlowBadges, parseSalesOrderFlowInconsistencies } from "./salesOrderFlowList.js";

export type SalesOrderFlowDetailDb = Pick<
  PrismaClient,
  | "salesOrder"
  | "salesOrderFlowSnapshot"
  | "salesOrderItemFlowSnapshot"
  | "salesOrderFlowEvent"
  | "salesOrderFlowManagement"
  | "product"
  | "salesOrderNfeLink"
  | "nomusNfe"
  | "nomusProductionOrderSalesLink"
  | "nomusProductionOrder"
  | "orderToCashAuditFact"
  | "nomusStockDocument"
  | "nomusStockDocumentItem"
>;

export type LoadSalesOrderFlowDetailOptions = {
  prisma: SalesOrderFlowDetailDb;
  canViewValues?: boolean;
  canViewFiscal?: boolean;
  scopeCustomerIds?: string[] | null;
  now?: () => Date;
};

export type LoadSalesOrderFlowDetailResult =
  | { ok: true; payload: SalesOrderFlowDetailPayload }
  | { ok: false; status: 404 | 403; body: { error: string; code?: string } };

function dateIso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function decimalNumber(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "object" && value !== null && "toNumber" in value) {
    const n = (value as { toNumber: () => number }).toNumber();
    return Number.isFinite(n) ? n : 0;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function mapManagement(
  row: Awaited<ReturnType<typeof findSalesOrderFlowManagementByOrderId>>
) {
  if (!row) return null;
  return {
    priority: row.priority,
    responsibleUserId: row.responsibleUserId,
    responsibleName: row.responsibleName,
    responsibleArea: row.responsibleArea,
    isBlocked: row.isBlocked,
    blockReason: row.blockReason,
    reason: row.reason,
    expectedResolutionAt: dateIso(row.expectedResolutionAt),
    internalNote: row.internalNote,
  };
}

function mapEvidenceProduction(pack: SalesOrderFlowEvidencePack) {
  return pack.productionOrders.map((op) => ({
    id: op.id,
    externalId: op.externalId,
    status: op.status,
    plannedQuantity: op.plannedQuantity,
    producedQuantity: op.producedQuantity,
    productCode: op.productCode,
    openedAt: op.openedAt,
    closedAt: op.closedAt,
  }));
}

function mapEvidenceDocuments(
  pack: SalesOrderFlowEvidencePack,
  canViewValues: boolean
) {
  return pack.stockDocuments.map((doc) => ({
    id: doc.id,
    externalId: doc.externalId,
    idNfe: doc.idNfe,
    tipoDocumentoEstoque: doc.tipoDocumentoEstoque,
    dataDocumento: doc.dataDocumento,
    totalValue: canViewValues ? doc.totalValue : null,
    statusRaw: doc.statusRaw,
    itemCount: doc.itemCount,
  }));
}

export async function loadSalesOrderFlowDetail(
  salesOrderIdRaw: string,
  options: LoadSalesOrderFlowDetailOptions
): Promise<LoadSalesOrderFlowDetailResult> {
  const salesOrderId = assertSalesOrderFlowDetailId(salesOrderIdRaw);
  const canViewValues = options.canViewValues !== false;
  const canViewFiscal = options.canViewFiscal === true;
  const now = options.now?.() ?? new Date();

  const orderMeta = await options.prisma.salesOrder.findUnique({
    where: { id: salesOrderId },
    select: { id: true, customerId: true },
  });
  if (!orderMeta) {
    return {
      ok: false,
      status: 404,
      body: { error: "Pedido não encontrado.", code: "SALES_ORDER_NOT_FOUND" },
    };
  }

  if (
    options.scopeCustomerIds &&
    !options.scopeCustomerIds.includes(orderMeta.customerId)
  ) {
    return {
      ok: false,
      status: 403,
      body: {
        error: "Pedido fora da sua carteira comercial.",
        code: "SALES_ORDER_FLOW_SCOPE_DENIED",
      },
    };
  }

  const [evidence, orderSnapshot, itemSnapshots, management] = await Promise.all([
    loadSalesOrderFlowEvidence(options.prisma, salesOrderId),
    findSalesOrderFlowSnapshotByOrderId(options.prisma, salesOrderId),
    findSalesOrderItemFlowSnapshotsByOrderId(options.prisma, salesOrderId),
    findSalesOrderFlowManagementByOrderId(options.prisma, salesOrderId),
  ]);

  if (!evidence) {
    return {
      ok: false,
      status: 404,
      body: { error: "Pedido não encontrado.", code: "SALES_ORDER_NOT_FOUND" },
    };
  }

  const recomputable = orderSnapshot == null;
  const mappedOrderSnapshot = mapOrderSnapshotForDetail(
    orderSnapshot as unknown as Record<string, unknown> | null,
    { canViewValues, now }
  );
  const mappedItems = itemSnapshots.map((row) =>
    mapItemSnapshotForDetail(row as unknown as Record<string, unknown>, {
      canViewValues,
      now,
    })
  );

  const columnExplanation = buildColumnExplanation({
    currentStage: orderSnapshot?.currentStage,
    nextAction: orderSnapshot?.nextAction,
    responsibleArea: orderSnapshot?.responsibleArea,
    bottleneckReason: orderSnapshot?.bottleneckReason,
    recomputable,
  });

  const financialSituation = canViewValues
    ? {
        orderValue: orderSnapshot
          ? decimalNumber(orderSnapshot.orderValue)
          : evidence.order.totalNetValue,
        fulfilledValue: orderSnapshot
          ? decimalNumber(orderSnapshot.fulfilledValue)
          : null,
        activeResidualValue: orderSnapshot
          ? decimalNumber(orderSnapshot.activeResidualValue)
          : null,
        cutValue: orderSnapshot ? decimalNumber(orderSnapshot.cutValue) : null,
        canceledValue: orderSnapshot
          ? decimalNumber(orderSnapshot.canceledValue)
          : null,
        documentCount: evidence.stockDocuments.length,
        validNfeCount: evidence.validNfes.length,
        canceledNfeCount: evidence.canceledNfes.length,
      }
    : {
        orderValue: null,
        fulfilledValue: null,
        activeResidualValue: null,
        cutValue: null,
        canceledValue: null,
        documentCount: evidence.stockDocuments.length,
        validNfeCount: evidence.validNfes.length,
        canceledNfeCount: evidence.canceledNfes.length,
      };

  const payload: SalesOrderFlowDetailPayload = {
    salesOrderId,
    recomputable,
    snapshotStatus: recomputable ? "SNAPSHOT_MISSING" : "READY",
    message: recomputable
      ? "Snapshot ausente — estado recomputável via rebuild/recompute do Fluxo de Pedidos."
      : null,
    order: {
      orderCode: evidence.order.orderCode,
      customerId: evidence.order.customerId,
      customerName:
        evidence.order.customer?.tradeName?.trim() ||
        evidence.order.customer?.companyName?.trim() ||
        null,
      sellerName: evidence.order.seller.sellerName,
      companyIssuer: evidence.order.company.companyIssuer,
      issueDate: evidence.order.issueDate,
      expectedDeliveryDate: evidence.order.expectedDeliveryDate,
      status: evidence.order.status,
      manualMetadata: evidence.order.manualMetadata,
    },
    orderSnapshot: mappedOrderSnapshot,
    itemSnapshots: mappedItems,
    columnExplanation,
    bottleneck: orderSnapshot
      ? {
          stage: orderSnapshot.bottleneckStage,
          salesOrderItemId: orderSnapshot.bottleneckSalesOrderItemId,
          reason: orderSnapshot.bottleneckReason,
        }
      : null,
    nextAction: columnExplanation.nextAction,
    responsibleArea: columnExplanation.responsibleArea,
    progress: orderSnapshot
      ? {
          productionOrder: decimalNumber(orderSnapshot.progressProductionOrder),
          produced:
            orderSnapshot.progressProduced == null
              ? null
              : decimalNumber(orderSnapshot.progressProduced),
          documented: decimalNumber(orderSnapshot.progressDocumented),
          invoiced: decimalNumber(orderSnapshot.progressInvoiced),
          shipped: decimalNumber(orderSnapshot.progressShipped),
        }
      : null,
    shipmentDates: orderSnapshot
      ? {
          firstShippedAt: dateIso(orderSnapshot.firstShippedAt),
          lastShippedAt: dateIso(orderSnapshot.lastShippedAt),
          completedAt: dateIso(orderSnapshot.completedAt),
          promisedDeliveryAt: dateIso(orderSnapshot.promisedDeliveryAt),
          isOverdue: orderSnapshot.isOverdue,
        }
      : {
          firstShippedAt: null,
          lastShippedAt: null,
          completedAt: null,
          promisedDeliveryAt: evidence.order.expectedDeliveryDate,
          isOverdue: null,
        },
    productionOrders: mapEvidenceProduction(evidence),
    stockDocuments: mapEvidenceDocuments(evidence, canViewValues),
    nfes: evidence.nfes.map((nfe) => mapNfeForDetail(nfe, canViewFiscal)),
    financialSituation,
    inconsistencies: orderSnapshot
      ? parseSalesOrderFlowInconsistencies(orderSnapshot.inconsistenciesJson)
      : [],
    badges: orderSnapshot
      ? parseSalesOrderFlowBadges(orderSnapshot.badgesJson)
      : [],
    management: mapManagement(management),
    officialLinks: buildSalesOrderFlowOfficialLinks(salesOrderId),
    valuesVisible: canViewValues,
    fiscalVisible: canViewFiscal,
    generatedAt: now.toISOString(),
  };

  return { ok: true, payload };
}

export async function loadSalesOrderFlowEvents(
  salesOrderIdRaw: string,
  query: Record<string, unknown>,
  options: {
    prisma: SalesOrderFlowDetailDb;
    scopeCustomerIds?: string[] | null;
    now?: () => Date;
  }
): Promise<
  | { ok: true; payload: SalesOrderFlowEventsPayload }
  | { ok: false; status: 404 | 403; body: { error: string; code?: string } }
> {
  const salesOrderId = assertSalesOrderFlowDetailId(salesOrderIdRaw);
  const parsed = parseSalesOrderFlowEventsQuery(query);
  const now = options.now?.() ?? new Date();

  const orderMeta = await options.prisma.salesOrder.findUnique({
    where: { id: salesOrderId },
    select: { id: true, customerId: true },
  });
  if (!orderMeta) {
    return {
      ok: false,
      status: 404,
      body: { error: "Pedido não encontrado.", code: "SALES_ORDER_NOT_FOUND" },
    };
  }
  if (
    options.scopeCustomerIds &&
    !options.scopeCustomerIds.includes(orderMeta.customerId)
  ) {
    return {
      ok: false,
      status: 403,
      body: {
        error: "Pedido fora da sua carteira comercial.",
        code: "SALES_ORDER_FLOW_SCOPE_DENIED",
      },
    };
  }

  const page = await findSalesOrderFlowEventsByOrderId(
    options.prisma,
    salesOrderId,
    {
      page: parsed.page,
      pageSize: parsed.pageSize,
      eventType: parsed.eventType,
      salesOrderItemId: parsed.salesOrderItemId,
    }
  );

  return {
    ok: true,
    payload: {
      salesOrderId,
      page: page.page,
      pageSize: page.pageSize,
      total: page.total,
      hasMore: page.hasMore,
      filters: {
        eventType: parsed.eventType,
        salesOrderItemId: parsed.salesOrderItemId,
      },
      items: page.items.map((item) => ({
        id: item.id,
        eventType: item.eventType,
        fromStage: item.fromStage,
        toStage: item.toStage,
        salesOrderItemId: item.salesOrderItemId,
        dedupeKey: item.dedupeKey,
        details: item.payloadJson ?? null,
        actorId: item.actorId,
        occurredAt: item.occurredAt.toISOString(),
        observedAt: item.observedAt ? item.observedAt.toISOString() : null,
        createdAt: item.createdAt.toISOString(),
      })),
      generatedAt: now.toISOString(),
    },
  };
}

export { SalesOrderFlowDetailQueryError };
