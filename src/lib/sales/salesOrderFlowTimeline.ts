/**
 * OP-55 — Timeline e eventos idempotentes do Fluxo de Pedidos.
 * Builders de evento (podem usar Decimal/JSON Prisma). Constantes UI: *.shared.ts.
 */

import { Prisma } from "@prisma/client";
import type { ResolveSalesOrderFlowResult } from "./salesOrderFlowEngine.js";
import type { ResolveSalesOrderItemFlowResult } from "./salesOrderItemFlowEngine.js";
import type { SalesOrderFlowEventWrite } from "./salesOrderFlowRepository.server.js";
import {
  SALES_ORDER_FLOW_EVENT_TYPES,
  asSalesOrderItemFlowStage,
  buildSalesOrderFlowEventDedupeKey,
  extractInconsistencyCodesFromJson,
  resolveSalesOrderFlowOccurredAt,
  resolveSalesOrderFlowStageEnteredAt,
  salesOrderFlowCriticalInconsistencyCodes,
  salesOrderFlowStageDirection,
  type SalesOrderFlowEventType,
  type SalesOrderFlowTimelineOrderState,
} from "./salesOrderFlowTimeline.shared.js";

export {
  SALES_ORDER_FLOW_EVENT_TYPES,
  asSalesOrderItemFlowStage,
  buildSalesOrderFlowEventDedupeKey,
  extractInconsistencyCodesFromJson,
  resolveSalesOrderFlowOccurredAt,
  resolveSalesOrderFlowStageEnteredAt,
  type SalesOrderFlowEventType,
  type SalesOrderFlowInconsistencyCode,
  type SalesOrderFlowStage,
  type SalesOrderFlowTimelineOrderState,
} from "./salesOrderFlowTimeline.shared.js";

export type SalesOrderFlowTimelineItemState = {
  salesOrderItemId: string;
  currentStage: string;
  fingerprint: string;
  fulfillmentClassification: string;
  cutQuantity: Prisma.Decimal;
  canceledQuantity: Prisma.Decimal;
  inconsistencyCodes: readonly string[];
};

export type SalesOrderFlowTimelineEvidenceTimes = {
  /** Melhor evidência real por item (ex.: data de documento/NF). */
  itemOccurredAt?: ReadonlyMap<string, Date | null>;
  /** Evidência no nível do pedido. */
  orderOccurredAt?: Date | null;
};

/** detailsJson: só campos auditáveis, sem raw Nomus / notas internas. */
export function buildSalesOrderFlowEventDetails(input: {
  scope: "ITEM" | "ORDER";
  fingerprint?: string;
  direction?: "ADVANCE" | "RETURN" | "SAME" | "INITIAL";
  codes?: readonly string[];
  fulfillmentClassification?: string;
}): Prisma.InputJsonValue {
  const details: Record<string, unknown> = {
    scope: input.scope,
  };
  if (input.fingerprint) details.fingerprint = input.fingerprint;
  if (input.direction) details.direction = input.direction;
  if (input.codes && input.codes.length > 0) details.codes = [...input.codes];
  if (input.fulfillmentClassification) {
    details.fulfillmentClassification = input.fulfillmentClassification;
  }
  return details as Prisma.InputJsonValue;
}

function eventWrite(input: {
  salesOrderId: string;
  salesOrderItemId?: string | null;
  eventType: SalesOrderFlowEventType;
  fromStage?: string | null;
  toStage?: string | null;
  dedupeKey: string;
  detailsJson: Prisma.InputJsonValue;
  occurredAt: Date;
  observedAt: Date;
}): SalesOrderFlowEventWrite {
  return {
    salesOrderId: input.salesOrderId,
    salesOrderItemId: input.salesOrderItemId ?? null,
    eventType: input.eventType,
    fromStage: input.fromStage ?? null,
    toStage: input.toStage ?? null,
    dedupeKey: input.dedupeKey,
    detailsJson: input.detailsJson,
    payloadJson: input.detailsJson,
    occurredAt: input.occurredAt,
    observedAt: input.observedAt,
  };
}

function qtyGtZero(value: Prisma.Decimal | null | undefined): boolean {
  return value != null && value.gt(0);
}

/**
 * Gera eventos de timeline para um item (criação, transição, corte, etc.).
 */
export function buildSalesOrderItemFlowTimelineEvents(input: {
  salesOrderId: string;
  previous: SalesOrderFlowTimelineItemState | null;
  next: SalesOrderFlowTimelineItemState;
  observedAt: Date;
  evidenceOccurredAt?: Date | null;
}): SalesOrderFlowEventWrite[] {
  const { salesOrderId, previous, next, observedAt } = input;
  const occurredAt = resolveSalesOrderFlowOccurredAt({
    observedAt,
    evidenceAt: input.evidenceOccurredAt,
  });
  const events: SalesOrderFlowEventWrite[] = [];

  if (!previous) {
    events.push(
      eventWrite({
        salesOrderId,
        salesOrderItemId: next.salesOrderItemId,
        eventType: "SNAPSHOT_CREATED",
        toStage: next.currentStage,
        dedupeKey: buildSalesOrderFlowEventDedupeKey({
          scope: "item",
          scopeId: next.salesOrderItemId,
          eventType: "SNAPSHOT_CREATED",
          toStage: next.currentStage,
          uniqueness: next.fingerprint,
        }),
        detailsJson: buildSalesOrderFlowEventDetails({
          scope: "ITEM",
          fingerprint: next.fingerprint,
          direction: "INITIAL",
        }),
        occurredAt,
        observedAt,
      })
    );
  } else if (previous.currentStage !== next.currentStage) {
    const direction = salesOrderFlowStageDirection(
      previous.currentStage,
      next.currentStage
    );
    const transitionType: SalesOrderFlowEventType =
      direction === "RETURN" ? "STAGE_RETURNED" : "STAGE_CHANGED";

    events.push(
      eventWrite({
        salesOrderId,
        salesOrderItemId: next.salesOrderItemId,
        eventType: transitionType,
        fromStage: previous.currentStage,
        toStage: next.currentStage,
        dedupeKey: buildSalesOrderFlowEventDedupeKey({
          scope: "item",
          scopeId: next.salesOrderItemId,
          eventType: transitionType,
          fromStage: previous.currentStage,
          toStage: next.currentStage,
          uniqueness: next.fingerprint,
        }),
        detailsJson: buildSalesOrderFlowEventDetails({
          scope: "ITEM",
          fingerprint: next.fingerprint,
          direction,
        }),
        occurredAt,
        observedAt,
      })
    );

    if (next.currentStage === "SHIPPED_COMPLETED") {
      events.push(
        eventWrite({
          salesOrderId,
          salesOrderItemId: next.salesOrderItemId,
          eventType: "STAGE_COMPLETED",
          fromStage: previous.currentStage,
          toStage: next.currentStage,
          dedupeKey: buildSalesOrderFlowEventDedupeKey({
            scope: "item",
            scopeId: next.salesOrderItemId,
            eventType: "STAGE_COMPLETED",
            fromStage: previous.currentStage,
            toStage: next.currentStage,
            uniqueness: next.fingerprint,
          }),
          detailsJson: buildSalesOrderFlowEventDetails({
            scope: "ITEM",
            fingerprint: next.fingerprint,
            direction: "ADVANCE",
          }),
          occurredAt,
          observedAt,
        })
      );
    }

    if (next.currentStage === "CANCELED") {
      events.push(
        eventWrite({
          salesOrderId,
          salesOrderItemId: next.salesOrderItemId,
          eventType: "CANCELED",
          fromStage: previous.currentStage,
          toStage: next.currentStage,
          dedupeKey: buildSalesOrderFlowEventDedupeKey({
            scope: "item",
            scopeId: next.salesOrderItemId,
            eventType: "CANCELED",
            fromStage: previous.currentStage,
            toStage: next.currentStage,
            uniqueness: next.fingerprint,
          }),
          detailsJson: buildSalesOrderFlowEventDetails({
            scope: "ITEM",
            fingerprint: next.fingerprint,
            fulfillmentClassification: next.fulfillmentClassification,
          }),
          occurredAt,
          observedAt,
        })
      );
    }
  }

  const prevCut = previous ? qtyGtZero(previous.cutQuantity) : false;
  const nextCut = qtyGtZero(next.cutQuantity);
  const cutAppeared =
    next.fulfillmentClassification === "FULFILLED_WITH_CUT" || nextCut;
  const prevHadCut =
    previous?.fulfillmentClassification === "FULFILLED_WITH_CUT" || prevCut;

  if (cutAppeared && !prevHadCut) {
    events.push(
      eventWrite({
        salesOrderId,
        salesOrderItemId: next.salesOrderItemId,
        eventType: "CUT_DETECTED",
        toStage: next.currentStage,
        dedupeKey: buildSalesOrderFlowEventDedupeKey({
          scope: "item",
          scopeId: next.salesOrderItemId,
          eventType: "CUT_DETECTED",
          toStage: next.currentStage,
          uniqueness: `${next.fingerprint}|${next.cutQuantity.toFixed()}`,
        }),
        detailsJson: buildSalesOrderFlowEventDetails({
          scope: "ITEM",
          fingerprint: next.fingerprint,
          fulfillmentClassification: next.fulfillmentClassification,
        }),
        occurredAt,
        observedAt,
      })
    );
  }

  const prevCritical = new Set(
    salesOrderFlowCriticalInconsistencyCodes(previous?.inconsistencyCodes ?? [])
  );
  const nextCritical = salesOrderFlowCriticalInconsistencyCodes(
    next.inconsistencyCodes
  );
  for (const code of nextCritical) {
    if (prevCritical.has(code)) continue;
    events.push(
      eventWrite({
        salesOrderId,
        salesOrderItemId: next.salesOrderItemId,
        eventType: "INCONSISTENCY_CRITICAL",
        toStage: next.currentStage,
        dedupeKey: buildSalesOrderFlowEventDedupeKey({
          scope: "item",
          scopeId: next.salesOrderItemId,
          eventType: "INCONSISTENCY_CRITICAL",
          toStage: next.currentStage,
          uniqueness: `${code}|${next.fingerprint}`,
        }),
        detailsJson: buildSalesOrderFlowEventDetails({
          scope: "ITEM",
          fingerprint: next.fingerprint,
          codes: [code],
        }),
        occurredAt,
        observedAt,
      })
    );
  }
  for (const code of prevCritical) {
    if (nextCritical.includes(code)) continue;
    events.push(
      eventWrite({
        salesOrderId,
        salesOrderItemId: next.salesOrderItemId,
        eventType: "INCONSISTENCY_RESOLVED",
        toStage: next.currentStage,
        dedupeKey: buildSalesOrderFlowEventDedupeKey({
          scope: "item",
          scopeId: next.salesOrderItemId,
          eventType: "INCONSISTENCY_RESOLVED",
          toStage: next.currentStage,
          uniqueness: `${code}|${next.fingerprint}`,
        }),
        detailsJson: buildSalesOrderFlowEventDetails({
          scope: "ITEM",
          fingerprint: next.fingerprint,
          codes: [code],
        }),
        occurredAt,
        observedAt,
      })
    );
  }

  return events;
}

export function buildSalesOrderFlowTimelineEvents(input: {
  salesOrderId: string;
  previous: SalesOrderFlowTimelineOrderState | null;
  next: SalesOrderFlowTimelineOrderState;
  observedAt: Date;
  evidenceOccurredAt?: Date | null;
}): SalesOrderFlowEventWrite[] {
  const { salesOrderId, previous, next, observedAt } = input;
  const occurredAt = resolveSalesOrderFlowOccurredAt({
    observedAt,
    evidenceAt: input.evidenceOccurredAt,
  });
  const events: SalesOrderFlowEventWrite[] = [];

  if (!previous) {
    events.push(
      eventWrite({
        salesOrderId,
        eventType: "SNAPSHOT_CREATED",
        toStage: next.currentStage,
        dedupeKey: buildSalesOrderFlowEventDedupeKey({
          scope: "order",
          scopeId: salesOrderId,
          eventType: "SNAPSHOT_CREATED",
          toStage: next.currentStage,
          uniqueness: next.fingerprint,
        }),
        detailsJson: buildSalesOrderFlowEventDetails({
          scope: "ORDER",
          fingerprint: next.fingerprint,
          direction: "INITIAL",
        }),
        occurredAt,
        observedAt,
      })
    );
    return events;
  }

  if (previous.currentStage !== next.currentStage) {
    const direction = salesOrderFlowStageDirection(
      previous.currentStage,
      next.currentStage
    );
    const transitionType: SalesOrderFlowEventType =
      direction === "RETURN" ? "STAGE_RETURNED" : "STAGE_CHANGED";

    events.push(
      eventWrite({
        salesOrderId,
        eventType: transitionType,
        fromStage: previous.currentStage,
        toStage: next.currentStage,
        dedupeKey: buildSalesOrderFlowEventDedupeKey({
          scope: "order",
          scopeId: salesOrderId,
          eventType: transitionType,
          fromStage: previous.currentStage,
          toStage: next.currentStage,
          uniqueness: next.fingerprint,
        }),
        detailsJson: buildSalesOrderFlowEventDetails({
          scope: "ORDER",
          fingerprint: next.fingerprint,
          direction,
        }),
        occurredAt,
        observedAt,
      })
    );

    if (next.currentStage === "SHIPPED_COMPLETED") {
      events.push(
        eventWrite({
          salesOrderId,
          eventType: "STAGE_COMPLETED",
          fromStage: previous.currentStage,
          toStage: next.currentStage,
          dedupeKey: buildSalesOrderFlowEventDedupeKey({
            scope: "order",
            scopeId: salesOrderId,
            eventType: "STAGE_COMPLETED",
            fromStage: previous.currentStage,
            toStage: next.currentStage,
            uniqueness: next.fingerprint,
          }),
          detailsJson: buildSalesOrderFlowEventDetails({
            scope: "ORDER",
            fingerprint: next.fingerprint,
            direction: "ADVANCE",
          }),
          occurredAt,
          observedAt,
        })
      );
    }

    if (next.currentStage === "CANCELED") {
      events.push(
        eventWrite({
          salesOrderId,
          eventType: "CANCELED",
          fromStage: previous.currentStage,
          toStage: next.currentStage,
          dedupeKey: buildSalesOrderFlowEventDedupeKey({
            scope: "order",
            scopeId: salesOrderId,
            eventType: "CANCELED",
            fromStage: previous.currentStage,
            toStage: next.currentStage,
            uniqueness: next.fingerprint,
          }),
          detailsJson: buildSalesOrderFlowEventDetails({
            scope: "ORDER",
            fingerprint: next.fingerprint,
          }),
          occurredAt,
          observedAt,
        })
      );
    }
  }

  const prevCritical = new Set(
    salesOrderFlowCriticalInconsistencyCodes(previous.inconsistencyCodes)
  );
  const nextCritical = salesOrderFlowCriticalInconsistencyCodes(
    next.inconsistencyCodes
  );
  for (const code of nextCritical) {
    if (prevCritical.has(code)) continue;
    events.push(
      eventWrite({
        salesOrderId,
        eventType: "INCONSISTENCY_CRITICAL",
        toStage: next.currentStage,
        dedupeKey: buildSalesOrderFlowEventDedupeKey({
          scope: "order",
          scopeId: salesOrderId,
          eventType: "INCONSISTENCY_CRITICAL",
          toStage: next.currentStage,
          uniqueness: `${code}|${next.fingerprint}`,
        }),
        detailsJson: buildSalesOrderFlowEventDetails({
          scope: "ORDER",
          fingerprint: next.fingerprint,
          codes: [code],
        }),
        occurredAt,
        observedAt,
      })
    );
  }
  for (const code of prevCritical) {
    if (nextCritical.includes(code)) continue;
    events.push(
      eventWrite({
        salesOrderId,
        eventType: "INCONSISTENCY_RESOLVED",
        toStage: next.currentStage,
        dedupeKey: buildSalesOrderFlowEventDedupeKey({
          scope: "order",
          scopeId: salesOrderId,
          eventType: "INCONSISTENCY_RESOLVED",
          toStage: next.currentStage,
          uniqueness: `${code}|${next.fingerprint}`,
        }),
        detailsJson: buildSalesOrderFlowEventDetails({
          scope: "ORDER",
          fingerprint: next.fingerprint,
          codes: [code],
        }),
        occurredAt,
        observedAt,
      })
    );
  }

  return events;
}

export function itemStateFromFlowResult(
  result: ResolveSalesOrderItemFlowResult,
  fingerprint: string
): SalesOrderFlowTimelineItemState {
  return {
    salesOrderItemId: result.salesOrderItemId,
    currentStage: result.currentStage,
    fingerprint,
    fulfillmentClassification: result.fulfillment.classification,
    cutQuantity: result.cutQuantity,
    canceledQuantity: result.canceledQuantity,
    inconsistencyCodes: result.inconsistencies.map((i) => i.code),
  };
}

export function orderStateFromFlowResult(
  result: ResolveSalesOrderFlowResult,
  fingerprint: string
): SalesOrderFlowTimelineOrderState {
  return {
    currentStage: result.currentStage,
    fingerprint,
    inconsistencyCodes: result.inconsistencies.map((i) => i.code),
  };
}
