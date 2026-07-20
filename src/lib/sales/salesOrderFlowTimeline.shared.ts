/**
 * OP-55 — Constantes e helpers puros da timeline do Fluxo de Pedidos.
 * Sem Prisma / sem *.server (seguro para o bundle frontend).
 */

import {
  compareSalesOrderFlowStagePriority,
  isSalesOrderFlowStage,
  type SalesOrderFlowInconsistencyCode,
  type SalesOrderFlowStage,
  type SalesOrderItemFlowStage,
} from "./salesOrderFlowCatalog.js";

export const SALES_ORDER_FLOW_EVENT_TYPES = [
  "SNAPSHOT_CREATED",
  "STAGE_CHANGED",
  "STAGE_RETURNED",
  "STAGE_COMPLETED",
  "CUT_DETECTED",
  "CANCELED",
  "INCONSISTENCY_CRITICAL",
  "INCONSISTENCY_RESOLVED",
  "MANAGEMENT_UPDATED",
] as const;

export type SalesOrderFlowEventType = (typeof SALES_ORDER_FLOW_EVENT_TYPES)[number];

export type SalesOrderFlowTimelineOrderState = {
  currentStage: string;
  fingerprint: string;
  inconsistencyCodes: readonly string[];
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

export function salesOrderFlowStageDirection(
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

/** Severidade CRITICAL no catálogo OP-46. */
export function salesOrderFlowCriticalInconsistencyCodes(
  codes: readonly string[]
): string[] {
  return codes.filter((c) => c === "DUPLICATE_TRUTH_RISK");
}

export function extractInconsistencyCodesFromJson(value: unknown): string[] {
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
