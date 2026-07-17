/**
 * OP-55 — Timeline e eventos idempotentes do Fluxo de Pedidos.
 * Puro: sem I/O. detailsJson sanitizado (sem payload bruto sensível).
 */

import { Prisma } from "@prisma/client";
import {
  compareSalesOrderFlowStagePriority,
  isSalesOrderFlowStage,
  type SalesOrderFlowInconsistencyCode,
  type SalesOrderFlowStage,
  type SalesOrderItemFlowStage,
} from "./salesOrderFlowCatalog.js";
import type { ResolveSalesOrderFlowResult } from "./salesOrderFlowEngine.js";
import type { ResolveSalesOrderItemFlowResult } from "./salesOrderItemFlowEngine.js";
import type { SalesOrderFlowEventWrite } from "./salesOrderFlowRepository.server.js";

export const SALES_ORDER_FLOW_EVENT_TYPES = [
  "SNAPSHOT_CREATED",
  "STAGE_CHANGED",
  "STAGE_RETURNED",
  "STAGE_COMPLETED",
  "CUT_DETECTED",
  "CANCELED",
  "INCONSISTENCY_CRITICAL",
  "INCONSISTENCY_RESOLVED",
] as const;

export type SalesOrderFlowEventType = (typeof SALES_ORDER_FLOW_EVENT_TYPES)[number];

export type SalesOrderFlowTimelineItemState = {
  salesOrderItemId: string;
  currentStage: string;
  fingerprint: string;
  fulfillmentClassification: string;
  cutQuantity: Prisma.Decimal;
  canceledQuantity: Prisma.Decimal;
  inconsistencyCodes: readonly string[];
};

export type SalesOrderFlowTimelineOrderState = {
  currentStage: string;
  fingerprint: string;
  inconsistencyCodes: readonly string[];
};

export type SalesOrderFlowTimelineEvidenceTimes = {
  /** Melhor evidência real por item (ex.: data de documento/NF). */
  itemOccurredAt?: ReadonlyMap<string, Date | null>;
  /** Evidência no nível do pedido. */
  orderOccurredAt?: Date | null;
};

function parseDate(value: Date | string | null | undefined): Date | null {
  if (value == null || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Escolhe occurredAt: evidência real > fallback observado. */
export function resolveSalesOrderFlowOccurredAt(input: {
  observedAt: Date;
  evidenceAt?: Date | string | null;
}): Date {
  return parseDate(input.evidenceAt) ?? input.observedAt;
}

/**
 * stageEnteredAt só muda quando currentStage muda.
 * Na mudança, usa occurredAt (evidência); senão preserva o anterior.
 */
export function resolveSalesOrderFlowStageEnteredAt(input: {
  previousStage: string | null | undefined;
  nextStage: string;
  previousStageEnteredAt: Date | null | undefined;
  occurredAt: Date;
  observedAt: Date;
}): Date {
  const stageChanged =
    input.previousStage == null || input.previousStage !== input.nextStage;
  if (!stageChanged) {
    return input.previousStageEnteredAt ?? input.observedAt;
  }
  return input.occurredAt;
}

export function buildSalesOrderFlowEventDedupeKey(parts: {
  scope: "item" | "order";
  scopeId: string;
  eventType: SalesOrderFlowEventType;
  fromStage?: string | null;
  toStage?: string | null;
  /** Token estável que diferencia visitas (fingerprint ou código). */
  uniqueness: string;
}): string {
  return [
    parts.scope,
    parts.scopeId,
    parts.eventType,
    parts.fromStage ?? "",
    parts.toStage ?? "",
    parts.uniqueness,
  ].join("|");
}

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

function criticalCodes(codes: readonly string[]): string[] {
  return codes.filter((c) => {
    // Severidade CRITICAL no catálogo OP-46.
    return c === "DUPLICATE_TRUTH_RISK";
  });
}

function stageDirection(
  fromStage: string,
  toStage: string
): "ADVANCE" | "RETURN" | "SAME" {
  if (fromStage === toStage) return "SAME";
  if (isSalesOrderFlowStage(fromStage) && isSalesOrderFlowStage(toStage)) {
    return compareSalesOrderFlowStagePriority(toStage, fromStage) > 0
      ? "ADVANCE"
      : "RETURN";
  }
  return "ADVANCE";
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
    const direction = stageDirection(previous.currentStage, next.currentStage);
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

  const prevCritical = new Set(criticalCodes(previous?.inconsistencyCodes ?? []));
  const nextCritical = criticalCodes(next.inconsistencyCodes);
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
    const direction = stageDirection(previous.currentStage, next.currentStage);
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

  const prevCritical = new Set(criticalCodes(previous.inconsistencyCodes));
  const nextCritical = criticalCodes(next.inconsistencyCodes);
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

export function extractInconsistencyCodesFromJson(
  value: unknown
): string[] {
  if (!Array.isArray(value)) return [];
  const codes: string[] = [];
  for (const row of value) {
    if (row && typeof row === "object" && "code" in row) {
      const code = (row as { code: unknown }).code;
      if (typeof code === "string") codes.push(code);
    }
  }
  return codes;
}

/** Type guard helper for callers. */
export function asSalesOrderItemFlowStage(
  stage: string
): SalesOrderItemFlowStage | null {
  return isSalesOrderFlowStage(stage) ? stage : null;
}

export type { SalesOrderFlowInconsistencyCode, SalesOrderFlowStage };
