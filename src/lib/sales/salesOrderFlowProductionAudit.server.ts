/**
 * OP-78 — Loader Prisma read-only do auditor do Fluxo de Pedidos.
 * Sem writes, sem Nomus HTTP, sem recompute materializante.
 */

import type { PrismaClient } from "@prisma/client";
import { loadSalesOrderFlowEvidence } from "./salesOrderFlowEvidence.server.js";
import { resolveSalesOrderItemFlowFromEvidence } from "./salesOrderItemFlowEngine.js";
import { resolveSalesOrderFlow } from "./salesOrderFlowEngine.js";
import { buildSalesOrderFlowCompletionContextFromPack } from "./salesOrderFlowCompletionDates.js";
import {
  findSalesOrderFlowEventsByOrderId,
  findSalesOrderFlowManagementByOrderId,
  findSalesOrderFlowSnapshotByOrderId,
  findSalesOrderItemFlowSnapshotsByOrderId,
} from "./salesOrderFlowRepository.server.js";
import {
  buildSalesOrderFlowFingerprint,
  buildSalesOrderItemFlowFingerprint,
  SALES_ORDER_FLOW_COMPUTATION_VERSION,
} from "./salesOrderFlowFingerprint.js";
import {
  buildSalesOrderFlowRecomputeDraft,
  planSalesOrderFlowRecompute,
} from "./salesOrderFlowRecompute.js";
import {
  buildUnavailableSalesOrderFlowProductionAuditReport,
  decStr,
  inconsistencyLabel,
  salesOrderAuditCodeCandidates,
  stageLabel,
  type SalesOrderFlowProductionAuditItemRow,
  type SalesOrderFlowProductionAuditReport,
} from "./salesOrderFlowProductionAudit.js";
import type { SalesOrderFlowStage } from "./salesOrderFlowCatalog.js";

export type SalesOrderFlowProductionAuditDb = Pick<
  PrismaClient,
  | "salesOrder"
  | "salesOrderItem"
  | "product"
  | "salesOrderNfeLink"
  | "nomusNfe"
  | "nomusProductionOrderSalesLink"
  | "nomusProductionOrder"
  | "orderToCashAuditFact"
  | "nomusStockDocument"
  | "nomusStockDocumentItem"
  | "salesOrderFlowSnapshot"
  | "salesOrderItemFlowSnapshot"
  | "salesOrderFlowEvent"
  | "salesOrderFlowManagement"
>;

async function loadItemFinancials(
  db: Pick<PrismaClient, "salesOrderItem">,
  salesOrderId: string
): Promise<{ salesOrderItemId: string; plannedNetValue: unknown }[]> {
  const rows = await db.salesOrderItem.findMany({
    where: { salesOrderId },
    select: { id: true, totalNetValue: true },
  });
  return rows.map((r) => ({
    salesOrderItemId: r.id,
    plannedNetValue: r.totalNetValue ?? 0,
  }));
}

function toIso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Carrega auditoria completa do Fluxo para um código de pedido.
 * Pedido ausente → report unavailable (não lança).
 */
export async function loadSalesOrderFlowProductionAudit(
  prisma: SalesOrderFlowProductionAuditDb,
  requestedOrder: string,
  referenceDate: Date = new Date()
): Promise<SalesOrderFlowProductionAuditReport> {
  const candidates = salesOrderAuditCodeCandidates(requestedOrder);
  const orderRow = await prisma.salesOrder.findFirst({
    where: {
      OR: candidates.flatMap((code) => [
        { orderCode: { equals: code, mode: "insensitive" as const } },
        { externalSalesOrderCode: { equals: code, mode: "insensitive" as const } },
      ]),
    },
    select: { id: true, orderCode: true },
  });

  if (!orderRow) {
    return buildUnavailableSalesOrderFlowProductionAuditReport({
      requestedOrder,
      generatedAt: referenceDate,
    });
  }

  const pack = await loadSalesOrderFlowEvidence(prisma, orderRow.id);
  if (!pack) {
    return buildUnavailableSalesOrderFlowProductionAuditReport({
      requestedOrder,
      generatedAt: referenceDate,
    });
  }

  const itemResults = pack.items
    .map((item) =>
      resolveSalesOrderItemFlowFromEvidence(pack, item.id, {
        referenceDate: pack.meta.loadedAt,
      })
    )
    .filter((r): r is NonNullable<typeof r> => r != null);

  const itemFinancials = await loadItemFinancials(prisma, orderRow.id);

  const [existingOrderRow, existingItemRows, eventsPage, management] =
    await Promise.all([
      findSalesOrderFlowSnapshotByOrderId(prisma, orderRow.id),
      findSalesOrderItemFlowSnapshotsByOrderId(prisma, orderRow.id),
      findSalesOrderFlowEventsByOrderId(prisma, orderRow.id, {
        page: 0,
        pageSize: 50,
      }),
      findSalesOrderFlowManagementByOrderId(prisma, orderRow.id),
    ]);

  const completionCtx = buildSalesOrderFlowCompletionContextFromPack(pack, {
    persistedCompletedAt: existingOrderRow?.completedAt ?? null,
  });

  const orderResult = resolveSalesOrderFlow(itemResults, {
    salesOrderId: orderRow.id,
    orderStatus: pack.order.status,
    promisedDeliveryAt: pack.order.expectedDeliveryDate,
    referenceDate: pack.meta.loadedAt,
    itemFinancials,
    ...completionCtx,
  });

  const existingItems = existingItemRows.map((r) => ({
    salesOrderItemId: r.salesOrderItemId,
    currentStage: r.currentStage,
    fingerprint: r.fingerprint,
    stageEnteredAt: r.stageEnteredAt,
    fulfillmentClassification: r.fulfillmentClassification,
    cutQuantity: r.cutQuantity,
    canceledQuantity: r.canceledQuantity,
    inconsistenciesJson: r.inconsistenciesJson,
  }));

  const draft = buildSalesOrderFlowRecomputeDraft({
    salesOrderId: orderRow.id,
    itemResults,
    orderResult,
    existingItems,
    existingOrder: existingOrderRow
      ? {
          currentStage: existingOrderRow.currentStage,
          fingerprint: existingOrderRow.fingerprint,
          inconsistenciesJson: existingOrderRow.inconsistenciesJson,
        }
      : null,
    computedAt: referenceDate,
    computationVersion: SALES_ORDER_FLOW_COMPUTATION_VERSION,
  });

  const plan = planSalesOrderFlowRecompute({
    draft,
    existingOrder: existingOrderRow
      ? {
          currentStage: existingOrderRow.currentStage,
          fingerprint: existingOrderRow.fingerprint,
        }
      : null,
    existingItems,
  });

  const calculatedItemFingerprints = new Map(
    itemResults.map((r) => [
      r.salesOrderItemId,
      buildSalesOrderItemFlowFingerprint(r),
    ] as const)
  );
  const calculatedOrderFingerprint = buildSalesOrderFlowFingerprint(
    orderResult,
    [...calculatedItemFingerprints.values()]
  );

  const persistedByItem = new Map(
    existingItemRows.map((r) => [r.salesOrderItemId, r] as const)
  );

  const itemStageMismatches: SalesOrderFlowProductionAuditReport["divergence"]["itemStageMismatches"] =
    [];
  const itemFingerprintMismatches: string[] = [];

  const items: SalesOrderFlowProductionAuditItemRow[] = itemResults.map(
    (result) => {
      const persisted = persistedByItem.get(result.salesOrderItemId) ?? null;
      const calcFp = calculatedItemFingerprints.get(result.salesOrderItemId)!;
      const stageMatches =
        persisted == null ? null : persisted.currentStage === result.currentStage;
      const fpMatches =
        persisted == null ? null : persisted.fingerprint === calcFp;
      if (stageMatches === false) {
        itemStageMismatches.push({
          salesOrderItemId: result.salesOrderItemId,
          calculated: result.currentStage,
          persisted: persisted?.currentStage ?? null,
        });
      }
      if (fpMatches === false) {
        itemFingerprintMismatches.push(result.salesOrderItemId);
      }

      const evidenceItem = pack.items.find((i) => i.id === result.salesOrderItemId);
      const links = pack.productionLinks.filter(
        (l) => l.salesOrderItemId === result.salesOrderItemId
      );

      return {
        salesOrderItemId: result.salesOrderItemId,
        sku: evidenceItem?.skuSnapshot ?? null,
        productName: evidenceItem?.productNameSnapshot ?? null,
        releaseStatus: evidenceItem?.nomusItemStatusNormalized ?? null,
        fulfillmentClassification: result.fulfillment.classification,
        requiresProduction: result.requiresProduction,
        productionRequirement: result.productionRequirement.classification,
        orderedQuantity: decStr(result.orderedQuantity) ?? "0.00",
        fulfilledQuantity:
          evidenceItem?.nomusQuantityFulfilled == null
            ? null
            : Number(evidenceItem.nomusQuantityFulfilled).toFixed(2),
        activeRemainingQuantity: decStr(result.activeRemainingQuantity),
        shipTargetQuantity: decStr(result.shipTargetQuantity) ?? "0.00",
        productionOrderQuantity: decStr(result.productionOrderQuantity) ?? "0.00",
        producedQuantity: decStr(result.producedQuantity),
        documentedQuantity: decStr(result.documentedQuantity) ?? "0.00",
        invoicedQuantity: decStr(result.invoicedQuantity) ?? "0.00",
        shippedQuantity: decStr(result.shippedQuantity) ?? "0.00",
        cutQuantity: decStr(result.cutQuantity) ?? "0.00",
        canceledQuantity: decStr(result.canceledQuantity) ?? "0.00",
        calculatedStage: result.currentStage,
        calculatedStageLabel:
          stageLabel(result.currentStage) ?? result.currentStage,
        stageReason: result.stageReason,
        nextAction: result.nextAction,
        responsibleArea: result.responsibleArea,
        progress: {
          productionOrder: decStr(result.progress.productionOrder) ?? "0.00",
          produced: decStr(result.progress.produced),
          documented: decStr(result.progress.documented) ?? "0.00",
          invoiced: decStr(result.progress.invoiced) ?? "0.00",
          shipped: decStr(result.progress.shipped) ?? "0.00",
        },
        productionOrderLinks: links.map((l) => ({
          productionOrderExternalId: l.productionOrderExternalId,
          linkedQuantity:
            l.linkedQuantity == null ? null : String(l.linkedQuantity),
          isCurrent: l.isCurrent,
        })),
        inconsistencies: result.inconsistencies.map((i) => ({
          code: i.code,
          label: inconsistencyLabel(i.code),
          severity: i.severity,
          detail: i.detail,
        })),
        persistedSnapshot: {
          present: persisted != null,
          currentStage: persisted?.currentStage ?? null,
          fingerprint: persisted?.fingerprint ?? null,
          stageMatchesCalculated: stageMatches,
          fingerprintMatchesCalculated: fpMatches,
        },
      };
    }
  );

  const pendingItems = itemResults.filter(
    (r) => r.currentStage === "WAITING_RELEASE"
  ).length;
  const canceledItems = itemResults.filter(
    (r) => r.currentStage === "CANCELED"
  ).length;
  const releasedOrBeyondItems = itemResults.length - pendingItems - canceledItems;

  const orderStageMatches =
    existingOrderRow == null
      ? null
      : existingOrderRow.currentStage === orderResult.currentStage;
  const orderFingerprintMatches =
    existingOrderRow == null
      ? null
      : existingOrderRow.fingerprint === calculatedOrderFingerprint;

  const hasDivergence =
    plan.reason === "fingerprint_changed" ||
    plan.reason === "first_run" ||
    itemStageMismatches.length > 0 ||
    itemFingerprintMismatches.length > 0 ||
    orderStageMatches === false;

  const inconsistencies: SalesOrderFlowProductionAuditReport["inconsistencies"] =
    [];
  for (const row of orderResult.inconsistencies) {
    inconsistencies.push({
      code: row.code,
      label: inconsistencyLabel(row.code),
      severity: row.severity,
      detail: row.detail,
      scope: "ORDER",
      salesOrderItemId: null,
    });
  }
  for (const item of items) {
    for (const row of item.inconsistencies) {
      inconsistencies.push({
        ...row,
        scope: "ITEM",
        salesOrderItemId: item.salesOrderItemId,
      });
    }
  }

  let status: SalesOrderFlowProductionAuditReport["status"] = "ok";
  if (hasDivergence) status = "with_divergences";
  else if (inconsistencies.length > 0) status = "with_inconsistencies";

  return {
    ok: true,
    mode: "READ_ONLY",
    generatedAt: referenceDate.toISOString(),
    requestedOrder,
    orderFound: true,
    status,
    exactUnavailableReason: null,
    guarantees: {
      databaseWrites: false,
      nomusCalls: false,
      passwordExposed: false,
      decimalSerializedAsString: true,
    },
    order: {
      salesOrderId: orderRow.id,
      orderCode: pack.order.orderCode,
      status: pack.order.status,
      issueDate: pack.order.issueDate,
      expectedDeliveryDate: pack.order.expectedDeliveryDate,
      customerName:
        pack.order.customer?.tradeName ??
        pack.order.customer?.companyName ??
        null,
      sellerName: pack.order.seller.sellerName,
      companyIssuer: pack.order.company.companyIssuer,
    },
    releaseSummary: {
      pendingItems,
      releasedOrBeyondItems,
      canceledItems,
    },
    consolidated: {
      calculatedStage: orderResult.currentStage as SalesOrderFlowStage,
      calculatedStageLabel: stageLabel(orderResult.currentStage),
      bottleneckItemId: orderResult.currentBottleneck?.salesOrderItemId ?? null,
      bottleneckStage: orderResult.currentBottleneck?.stage ?? null,
      nextAction: orderResult.nextAction,
      responsibleArea: orderResult.responsibleArea,
      progress: {
        productionOrder: decStr(orderResult.progress.productionOrder),
        produced: decStr(orderResult.progress.produced),
        documented: decStr(orderResult.progress.documented),
        invoiced: decStr(orderResult.progress.invoiced),
        shipped: decStr(orderResult.progress.shipped),
      },
      dates: {
        promisedDeliveryAt: orderResult.promisedDeliveryAt,
        firstShippedAt: orderResult.firstShippedAt,
        lastShippedAt: orderResult.lastShippedAt,
        completedAt: orderResult.completedAt,
        isOverdue: orderResult.isOverdue,
      },
    },
    items,
    productionOrders: pack.productionOrders.map((op) => ({
      id: op.id,
      externalId: op.externalId,
      status: op.status,
      plannedQuantity:
        op.plannedQuantity == null ? null : String(op.plannedQuantity),
      producedQuantity:
        op.producedQuantity == null ? null : String(op.producedQuantity),
      productCode: op.productCode,
    })),
    stockDocuments: pack.stockDocuments.map((doc) => ({
      id: doc.id,
      externalId: doc.externalId,
      idNfe: doc.idNfe,
      documentNumber: doc.documentNumber,
      statusRaw: doc.statusRaw,
      isCancelled: doc.isCancelled,
      dataDocumento: doc.dataDocumento,
    })),
    nfes: pack.nfes.map((nfe) => ({
      externalId: nfe.externalId,
      numero: nfe.numero,
      status:
        nfe.statusNormalized?.statusNormalized ??
        nfe.statusNormalized?.label ??
        (nfe.statusRaw != null ? String(nfe.statusRaw) : null),
      isCanceled: nfe.isCanceled,
      isValidForBilling: nfe.isValidForBilling,
    })),
    persistedOrderSnapshot: {
      present: existingOrderRow != null,
      currentStage: existingOrderRow?.currentStage ?? null,
      fingerprint: existingOrderRow?.fingerprint ?? null,
      computationVersion: existingOrderRow?.computationVersion ?? null,
      computedAt: toIso(existingOrderRow?.computedAt),
      nextAction: existingOrderRow?.nextAction ?? null,
      bottleneckSalesOrderItemId:
        existingOrderRow?.bottleneckSalesOrderItemId ?? null,
    },
    divergence: {
      hasDivergence,
      planReason: plan.reason,
      orderStageMatches,
      orderFingerprintMatches,
      itemStageMismatches,
      itemFingerprintMismatches,
      calculatedOrderFingerprint,
      persistedOrderFingerprint: existingOrderRow?.fingerprint ?? null,
    },
    events: eventsPage.items.map((event) => ({
      id: event.id,
      eventType: event.eventType,
      fromStage: event.fromStage,
      toStage: event.toStage,
      salesOrderItemId: event.salesOrderItemId,
      occurredAt: toIso(event.occurredAt) ?? "",
      dedupeKey: event.dedupeKey,
    })),
    management: {
      present: management != null,
      priority: management?.priority ?? null,
      responsibleName: management?.responsibleName ?? null,
      responsibleArea: management?.responsibleArea ?? null,
      isBlocked: management?.isBlocked ?? null,
      blockReason: management?.blockReason ?? null,
      expectedResolutionAt: toIso(management?.expectedResolutionAt),
      internalNote: management?.internalNote ?? null,
      updatedAt: toIso(management?.updatedAt),
    },
    inconsistencies,
  };
}
