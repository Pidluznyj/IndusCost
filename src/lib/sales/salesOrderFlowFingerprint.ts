/**
 * OP-54 — Fingerprints estáveis do Fluxo de Pedidos (idempotência de materialização).
 * Puro: sem I/O.
 */

import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { ResolveSalesOrderFlowResult } from "./salesOrderFlowEngine.js";
import type { ResolveSalesOrderItemFlowResult } from "./salesOrderItemFlowEngine.js";

export const SALES_ORDER_FLOW_COMPUTATION_VERSION = "sales-order-flow/v1";

function hashPayload(parts: Array<string | number | boolean | null | undefined>): string {
  return createHash("sha256")
    .update(parts.map((p) => (p == null ? "" : String(p))).join("|"))
    .digest("hex");
}

function decStr(value: Prisma.Decimal | null | undefined): string {
  if (value == null) return "";
  return value.toFixed();
}

function boolStr(value: boolean | null | undefined): string {
  if (value == null) return "";
  return value ? "1" : "0";
}

/** Fingerprint do resultado OP-50 (item). */
export function buildSalesOrderItemFlowFingerprint(
  result: ResolveSalesOrderItemFlowResult,
  computationVersion: string = SALES_ORDER_FLOW_COMPUTATION_VERSION
): string {
  const inconsistencies = [...result.inconsistencies]
    .map((i) => `${i.code}:${i.severity}:${i.detail}`)
    .sort()
    .join(";");

  return hashPayload([
    "item",
    computationVersion,
    result.salesOrderItemId,
    result.currentStage,
    result.stageReason,
    result.fulfillment.classification,
    result.productionRequirement.classification,
    boolStr(result.requiresProduction),
    decStr(result.orderedQuantity),
    decStr(result.productionOrderQuantity),
    decStr(result.producedQuantity),
    decStr(result.documentedQuantity),
    decStr(result.invoicedQuantity),
    decStr(result.shippedQuantity),
    decStr(result.activeRemainingQuantity),
    decStr(result.activeObligationQuantity),
    decStr(result.remainingFulfillmentQuantity),
    decStr(result.shipTargetQuantity),
    decStr(result.cutQuantity),
    decStr(result.canceledQuantity),
    boolStr(result.fulfilledWithoutProduction),
    decStr(result.progress.productionOrder),
    decStr(result.progress.produced),
    decStr(result.progress.documented),
    decStr(result.progress.invoiced),
    decStr(result.progress.shipped),
    result.nextAction,
    result.responsibleArea,
    result.promisedDeliveryAt,
    boolStr(result.isOverdue),
    boolStr(result.isActiveForKanban),
    inconsistencies,
  ]);
}

/** Fingerprint do resultado OP-51 (pedido) + fingerprints dos itens. */
export function buildSalesOrderFlowFingerprint(
  result: ResolveSalesOrderFlowResult,
  itemFingerprints: readonly string[],
  computationVersion: string = SALES_ORDER_FLOW_COMPUTATION_VERSION
): string {
  const badges = [...result.badges].sort().join(",");
  const inconsistencies = [...result.inconsistencies]
    .map((i) => `${i.code}:${i.severity}:${i.detail}`)
    .sort()
    .join(";");
  const itemFp = [...itemFingerprints].sort().join(",");

  return hashPayload([
    "order",
    computationVersion,
    result.salesOrderId,
    result.currentStage,
    result.currentBottleneck?.stage,
    result.currentBottleneck?.salesOrderItemId,
    result.currentBottleneck?.stageReason,
    result.nextAction,
    result.responsibleArea,
    result.totalItems,
    result.activeItems,
    result.completedItems,
    result.pendingItems,
    result.inconsistentItems,
    result.canceledItems,
    decStr(result.progress.productionOrder),
    decStr(result.progress.produced),
    decStr(result.progress.documented),
    decStr(result.progress.invoiced),
    decStr(result.progress.shipped),
    decStr(result.orderValue),
    decStr(result.fulfilledValue),
    decStr(result.activeResidualValue),
    decStr(result.cutValue),
    decStr(result.canceledValue),
    result.firstShippedAt,
    result.lastShippedAt,
    result.completedAt,
    result.promisedDeliveryAt,
    boolStr(result.isOverdue),
    boolStr(result.isInActiveOperationalColumn),
    badges,
    inconsistencies,
    itemFp,
  ]);
}
