/**
 * OP-54/OP-55 — Planejamento puro da recomputação do Fluxo de Pedidos.
 * Sem I/O: mapeia motores → writes / eventos de timeline / decisão de skip.
 */

import { Prisma } from "@prisma/client";
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
import {
  buildSalesOrderFlowTimelineEvents,
  buildSalesOrderItemFlowTimelineEvents,
  extractInconsistencyCodesFromJson,
  itemStateFromFlowResult,
  orderStateFromFlowResult,
  resolveSalesOrderFlowOccurredAt,
  resolveSalesOrderFlowStageEnteredAt,
  type SalesOrderFlowTimelineEvidenceTimes,
  type SalesOrderFlowTimelineItemState,
  type SalesOrderFlowTimelineOrderState,
} from "./salesOrderFlowTimeline.js";

export type ExistingItemFlowSnapshotRef = {
  salesOrderItemId: string;
  currentStage: string;
  fingerprint: string;
  stageEnteredAt: Date | null;
  fulfillmentClassification?: string | null;
  cutQuantity?: Prisma.Decimal | string | number | null;
  canceledQuantity?: Prisma.Decimal | string | number | null;
  inconsistenciesJson?: unknown;
};

export type ExistingOrderFlowSnapshotRef = {
  currentStage: string;
  fingerprint: string;
  inconsistenciesJson?: unknown;
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

function toDecimal(value: Prisma.Decimal | string | number | null | undefined): Prisma.Decimal {
  if (value instanceof Prisma.Decimal) return value;
  if (value == null || value === "") return new Prisma.Decimal(0);
  return new Prisma.Decimal(value);
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

function existingItemTimelineState(
  row: ExistingItemFlowSnapshotRef
): SalesOrderFlowTimelineItemState {
  return {
    salesOrderItemId: row.salesOrderItemId,
    currentStage: row.currentStage,
    fingerprint: row.fingerprint,
    fulfillmentClassification: row.fulfillmentClassification ?? "UNKNOWN",
    cutQuantity: toDecimal(row.cutQuantity),
    canceledQuantity: toDecimal(row.canceledQuantity),
    inconsistencyCodes: extractInconsistencyCodesFromJson(row.inconsistenciesJson),
  };
}

export function buildSalesOrderFlowRecomputeDraft(input: {
  salesOrderId: string;
  itemResults: readonly ResolveSalesOrderItemFlowResult[];
  orderResult: ResolveSalesOrderFlowResult;
  existingItems: readonly ExistingItemFlowSnapshotRef[];
  existingOrder?: ExistingOrderFlowSnapshotRef;
  computedAt?: Date;
  computationVersion?: string;
  evidenceTimes?: SalesOrderFlowTimelineEvidenceTimes;
}): SalesOrderFlowRecomputeDraft {
  const computedAt = input.computedAt ?? new Date();
  const computationVersion =
    input.computationVersion ?? SALES_ORDER_FLOW_COMPUTATION_VERSION;
  const existingByItem = new Map(
    input.existingItems.map((r) => [r.salesOrderItemId, r] as const)
  );

  const itemFingerprints = new Map<string, string>();
  const itemWrites: SalesOrderItemFlowSnapshotWrite[] = [];
  const events: SalesOrderFlowEventWrite[] = [];

  for (const result of input.itemResults) {
    const fingerprint = buildSalesOrderItemFlowFingerprint(
      result,
      computationVersion
    );
    itemFingerprints.set(result.salesOrderItemId, fingerprint);
    const prev = existingByItem.get(result.salesOrderItemId) ?? null;
    const evidenceAt =
      input.evidenceTimes?.itemOccurredAt?.get(result.salesOrderItemId) ?? null;
    const occurredAt = resolveSalesOrderFlowOccurredAt({
      observedAt: computedAt,
      evidenceAt,
    });
    const stageEnteredAt = resolveSalesOrderFlowStageEnteredAt({
      previousStage: prev?.currentStage,
      nextStage: result.currentStage,
      previousStageEnteredAt: prev?.stageEnteredAt,
      occurredAt,
      observedAt: computedAt,
    });

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
      // Snapshot "saldo ativo" = remainingFulfillment (obrigação − atendido), não FIN-03 bruto.
      activeRemainingQuantity: result.remainingFulfillmentQuantity,
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

    events.push(
      ...buildSalesOrderItemFlowTimelineEvents({
        salesOrderId: input.salesOrderId,
        previous: prev ? existingItemTimelineState(prev) : null,
        next: itemStateFromFlowResult(result, fingerprint),
        observedAt: computedAt,
        evidenceOccurredAt: evidenceAt,
      })
    );
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

  const previousOrder: SalesOrderFlowTimelineOrderState | null = input.existingOrder
    ? {
        currentStage: input.existingOrder.currentStage,
        fingerprint: input.existingOrder.fingerprint,
        inconsistencyCodes: extractInconsistencyCodesFromJson(
          input.existingOrder.inconsistenciesJson
        ),
      }
    : null;

  events.push(
    ...buildSalesOrderFlowTimelineEvents({
      salesOrderId: input.salesOrderId,
      previous: previousOrder,
      next: orderStateFromFlowResult(order, orderFingerprint),
      observedAt: computedAt,
      evidenceOccurredAt: input.evidenceTimes?.orderOccurredAt ?? null,
    })
  );

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

  return {
    action: "persist",
    draft,
    reason: "fingerprint_changed",
  };
}
