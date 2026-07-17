/**
 * OP-54 — Planejamento puro da recomputação do Fluxo de Pedidos.
 * Sem I/O: mapeia motores → writes / eventos / decisão de skip.
 */

import type { Prisma } from "@prisma/client";
import type { ResolveSalesOrderFlowResult } from "./salesOrderFlowEngine.js";
import type { ResolveSalesOrderItemFlowResult } from "./salesOrderItemFlowEngine.js";
import {
  buildSalesOrderFlowFingerprint,
  buildSalesOrderItemFlowFingerprint,
  SALES_ORDER_FLOW_COMPUTATION_VERSION,
} from "./salesOrderFlowFingerprint.js";
import type {
  SalesOrderFlowEventWrite,
  SalesOrderFlowSnapshotWrite,
  SalesOrderItemFlowSnapshotWrite,
} from "./salesOrderFlowRepository.server.js";

export type ExistingItemFlowSnapshotRef = {
  salesOrderItemId: string;
  currentStage: string;
  fingerprint: string;
  stageEnteredAt: Date | null;
};

export type ExistingOrderFlowSnapshotRef = {
  currentStage: string;
  fingerprint: string;
} | null;

export type SalesOrderFlowRecomputeDraft = {
  computationVersion: string;
  computedAt: Date;
  itemResults: ResolveSalesOrderItemFlowResult[];
  orderResult: ResolveSalesOrderFlowResult;
  itemWrites: SalesOrderItemFlowSnapshotWrite[];
  orderWrite: SalesOrderFlowSnapshotWrite;
  events: SalesOrderFlowEventWrite[];
  orderFingerprint: string;
  itemFingerprints: Map<string, string>;
};

export type SalesOrderFlowRecomputePlan =
  | {
      action: "unchanged";
      draft: SalesOrderFlowRecomputeDraft;
      reason: "fingerprint_match";
    }
  | {
      action: "persist";
      draft: SalesOrderFlowRecomputeDraft;
      reason: "first_run" | "fingerprint_changed";
    };

function parseIsoDate(value: string | null | undefined): Date | null {
  if (value == null || value === "") return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function progressJson(
  progress: ResolveSalesOrderItemFlowResult["progress"]
): Prisma.InputJsonValue {
  return {
    productionOrder: progress.productionOrder.toFixed(),
    produced: progress.produced == null ? null : progress.produced.toFixed(),
    documented: progress.documented.toFixed(),
    invoiced: progress.invoiced.toFixed(),
    shipped: progress.shipped.toFixed(),
  };
}

function inconsistenciesJson(
  rows: ResolveSalesOrderItemFlowResult["inconsistencies"]
): Prisma.InputJsonValue {
  return rows.map((r) => ({
    code: r.code,
    severity: r.severity,
    detail: r.detail,
  }));
}

export function buildSalesOrderFlowRecomputeDraft(input: {
  salesOrderId: string;
  itemResults: readonly ResolveSalesOrderItemFlowResult[];
  orderResult: ResolveSalesOrderFlowResult;
  existingItems: readonly ExistingItemFlowSnapshotRef[];
  computedAt?: Date;
  computationVersion?: string;
}): SalesOrderFlowRecomputeDraft {
  const computedAt = input.computedAt ?? new Date();
  const computationVersion =
    input.computationVersion ?? SALES_ORDER_FLOW_COMPUTATION_VERSION;
  const existingByItem = new Map(
    input.existingItems.map((r) => [r.salesOrderItemId, r] as const)
  );

  const itemFingerprints = new Map<string, string>();
  const itemWrites: SalesOrderItemFlowSnapshotWrite[] = [];

  for (const result of input.itemResults) {
    const fingerprint = buildSalesOrderItemFlowFingerprint(
      result,
      computationVersion
    );
    itemFingerprints.set(result.salesOrderItemId, fingerprint);
    const prev = existingByItem.get(result.salesOrderItemId);
    const stageChanged = !prev || prev.currentStage !== result.currentStage;
    const stageEnteredAt = stageChanged
      ? computedAt
      : (prev?.stageEnteredAt ?? computedAt);

    itemWrites.push({
      salesOrderId: input.salesOrderId,
      salesOrderItemId: result.salesOrderItemId,
      currentStage: result.currentStage,
      stageReason: result.stageReason,
      fulfillmentClassification: result.fulfillment.classification,
      requiresProductionClassification: result.productionRequirement.classification,
      requiresProduction: result.requiresProduction,
      orderedQuantity: result.orderedQuantity,
      productionOrderQuantity: result.productionOrderQuantity,
      producedQuantity: result.producedQuantity,
      documentedQuantity: result.documentedQuantity,
      invoicedQuantity: result.invoicedQuantity,
      shippedQuantity: result.shippedQuantity,
      activeRemainingQuantity: result.activeRemainingQuantity,
      shipTargetQuantity: result.shipTargetQuantity,
      cutQuantity: result.cutQuantity,
      canceledQuantity: result.canceledQuantity,
      progressProductionOrder: result.progress.productionOrder,
      progressProduced: result.progress.produced,
      progressDocumented: result.progress.documented,
      progressInvoiced: result.progress.invoiced,
      progressShipped: result.progress.shipped,
      progressJson: progressJson(result.progress),
      inconsistenciesJson: inconsistenciesJson(result.inconsistencies),
      nextAction: result.nextAction,
      responsibleArea: result.responsibleArea,
      stageEnteredAt,
      promisedDeliveryAt: parseIsoDate(result.promisedDeliveryAt),
      isOverdue: result.isOverdue,
      isActiveForKanban: result.isActiveForKanban,
      fingerprint,
      computationVersion,
      computedAt,
    });
  }

  const orderFingerprint = buildSalesOrderFlowFingerprint(
    input.orderResult,
    [...itemFingerprints.values()],
    computationVersion
  );

  const order = input.orderResult;
  const orderWrite: SalesOrderFlowSnapshotWrite = {
    salesOrderId: input.salesOrderId,
    currentStage: order.currentStage,
    bottleneckStage: order.currentBottleneck?.stage ?? null,
    bottleneckSalesOrderItemId: order.currentBottleneck?.salesOrderItemId ?? null,
    bottleneckReason: order.currentBottleneck?.stageReason ?? null,
    nextAction: order.nextAction,
    responsibleArea: order.responsibleArea,
    totalItems: order.totalItems,
    activeItems: order.activeItems,
    completedItems: order.completedItems,
    pendingItems: order.pendingItems,
    inconsistentItems: order.inconsistentItems,
    canceledItems: order.canceledItems,
    progressProductionOrder: order.progress.productionOrder,
    progressProduced: order.progress.produced,
    progressDocumented: order.progress.documented,
    progressInvoiced: order.progress.invoiced,
    progressShipped: order.progress.shipped,
    progressJson: progressJson(order.progress),
    orderValue: order.orderValue,
    fulfilledValue: order.fulfilledValue,
    activeResidualValue: order.activeResidualValue,
    cutValue: order.cutValue,
    canceledValue: order.canceledValue,
    firstShippedAt: parseIsoDate(order.firstShippedAt),
    lastShippedAt: parseIsoDate(order.lastShippedAt),
    completedAt: parseIsoDate(order.completedAt),
    promisedDeliveryAt: parseIsoDate(order.promisedDeliveryAt),
    isOverdue: order.isOverdue,
    isInActiveOperationalColumn: order.isInActiveOperationalColumn,
    inconsistenciesJson: inconsistenciesJson(order.inconsistencies),
    badgesJson: [...order.badges],
    fingerprint: orderFingerprint,
    computationVersion,
    computedAt,
  };

  const events: SalesOrderFlowEventWrite[] = [];

  for (const write of itemWrites) {
    const prev = existingByItem.get(write.salesOrderItemId);
    if (prev && prev.currentStage !== write.currentStage) {
      events.push({
        salesOrderId: input.salesOrderId,
        salesOrderItemId: write.salesOrderItemId,
        eventType: "STAGE_CHANGED",
        fromStage: prev.currentStage,
        toStage: write.currentStage,
        dedupeKey: [
          "item",
          write.salesOrderItemId,
          "STAGE_CHANGED",
          prev.currentStage,
          write.currentStage,
          write.fingerprint,
        ].join("|"),
        payloadJson: {
          scope: "ITEM",
          fingerprint: write.fingerprint,
        },
        occurredAt: computedAt,
      });
    }
  }

  return {
    computationVersion,
    computedAt,
    itemResults: [...input.itemResults],
    orderResult: input.orderResult,
    itemWrites,
    orderWrite,
    events,
    orderFingerprint,
    itemFingerprints,
  };
}

export function planSalesOrderFlowRecompute(input: {
  draft: SalesOrderFlowRecomputeDraft;
  existingOrder: ExistingOrderFlowSnapshotRef;
  existingItems: readonly ExistingItemFlowSnapshotRef[];
}): SalesOrderFlowRecomputePlan {
  const { draft, existingOrder, existingItems } = input;

  if (!existingOrder) {
    // First run: also emit order STAGE_CHANGED from null → stage if useful?
    // YAGNI: only transitions from an existing snapshot.
    return { action: "persist", draft, reason: "first_run" };
  }

  const existingItemFp = new Map(
    existingItems.map((r) => [r.salesOrderItemId, r.fingerprint] as const)
  );
  const sameOrderFp = existingOrder.fingerprint === draft.orderFingerprint;
  const sameItemSet =
    existingItemFp.size === draft.itemFingerprints.size &&
    [...draft.itemFingerprints.entries()].every(
      ([id, fp]) => existingItemFp.get(id) === fp
    );

  if (sameOrderFp && sameItemSet) {
    return { action: "unchanged", draft, reason: "fingerprint_match" };
  }

  const events = [...draft.events];
  // Order-level stage change event (only when previous snapshot exists).
  if (existingOrder.currentStage !== draft.orderWrite.currentStage) {
    events.push({
      salesOrderId: draft.orderWrite.salesOrderId,
      eventType: "STAGE_CHANGED",
      fromStage: existingOrder.currentStage,
      toStage: draft.orderWrite.currentStage,
      dedupeKey: [
        "order",
        draft.orderWrite.salesOrderId,
        "STAGE_CHANGED",
        existingOrder.currentStage,
        draft.orderWrite.currentStage,
        draft.orderFingerprint,
      ].join("|"),
      payloadJson: {
        scope: "ORDER",
        fingerprint: draft.orderFingerprint,
      },
      occurredAt: draft.computedAt,
    });
  }

  return {
    action: "persist",
    draft: { ...draft, events },
    reason: "fingerprint_changed",
  };
}
