/**
 * OP-51 — Consolidação pura do fluxo no nível do Pedido.
 *
 * Usa exclusivamente resultados de `resolveSalesOrderItemFlow` (OP-50).
 * Regra central: primeira obrigação pendente entre itens ativos
 * (`pickSalesOrderFlowStageFromItemStages`).
 *
 * Sem I/O e sem persistência de snapshot.
 */

import { Prisma } from "@prisma/client";
import {
  SALES_ORDER_FLOW_INCONSISTENCY_SEVERITY_BY_CODE,
  SALES_ORDER_FLOW_STAGE_LABELS,
  SALES_ORDER_FLOW_STAGE_NEXT_ACTION,
  SALES_ORDER_FLOW_STAGE_RESPONSIBLE_AREA,
  compareSalesOrderFlowStagePriority,
  pickSalesOrderFlowStageFromItemStages,
  type SalesOrderFlowInconsistencyCode,
  type SalesOrderFlowResponsibleArea,
  type SalesOrderFlowStage,
  type SalesOrderItemFlowStage,
} from "./salesOrderFlowCatalog.js";
import type {
  QtyDecimal,
  ResolveSalesOrderItemFlowResult,
  SalesOrderItemFlowInconsistency,
  SalesOrderItemFlowProgress,
} from "./salesOrderItemFlowEngine.js";
import {
  maxIsoTimestamp,
  resolveSalesOrderFlowCompletedAt,
  type SalesOrderFlowItemTemporalAt,
} from "./salesOrderFlowCompletionDates.js";

const ZERO = new Prisma.Decimal(0);
const HUNDRED = new Prisma.Decimal(100);
const MONEY_DP = 2;
const ROUND = Prisma.Decimal.ROUND_HALF_UP;

export type SalesOrderFlowBadge =
  | "OVERDUE"
  | "INCONSISTENT"
  | "PARTIAL"
  | "CUT"
  | "CANCELED"
  | "MIXED_STAGES"
  | "COMPLETED"
  | "OUT_OF_ACTIVE_COLUMNS";

export type ResolveSalesOrderFlowItemFinancial = {
  salesOrderItemId: string;
  plannedNetValue: Prisma.Decimal | string | number;
};

export type ResolveSalesOrderFlowItemShippedAt = {
  salesOrderItemId: string;
  shippedAt: Date | string;
};

export type ResolveSalesOrderFlowOrderContext = {
  salesOrderId: string;
  /**
   * Status IndusCost do pedido (`CANCELLED` força fora das colunas ativas).
   */
  orderStatus?: string | null;
  promisedDeliveryAt?: Date | string | null;
  /**
   * Relógio de avaliação apenas para atraso (`isOverdue`).
   * Nunca entra em completedAt nem no fingerprint via completedAt.
   */
  referenceDate?: Date | string | null;
  /** Valores líquidos oficiais por item — base dos totais monetários. */
  itemFinancials?: readonly ResolveSalesOrderFlowItemFinancial[];
  /** Timestamps de envio/saída normalizados por item (quando conhecidos). */
  itemShippedAt?: readonly ResolveSalesOrderFlowItemShippedAt[];
  /** Datas de documento de saída válido por item (proxy quando envio ausente). */
  itemDocumentAt?: readonly SalesOrderFlowItemTemporalAt[];
  /** Datas issuedAt de NF-e válida por item (proxy terciário). */
  itemNfeIssuedAt?: readonly SalesOrderFlowItemTemporalAt[];
  /**
   * completedAt já persistido — reutilizado só se o pedido permanece
   * SHIPPED_COMPLETED e não há evidência temporal nova (1–3).
   */
  persistedCompletedAt?: Date | string | null;
};

export type SalesOrderFlowBottleneck = {
  stage: SalesOrderFlowStage;
  salesOrderItemId: string;
  stageReason: string;
};

export type ResolveSalesOrderFlowResult = {
  salesOrderId: string;
  currentStage: SalesOrderFlowStage;
  currentBottleneck: SalesOrderFlowBottleneck | null;
  nextAction: string;
  responsibleArea: SalesOrderFlowResponsibleArea;
  totalItems: number;
  completedItems: number;
  pendingItems: number;
  inconsistentItems: number;
  canceledItems: number;
  activeItems: number;
  progress: SalesOrderItemFlowProgress;
  orderValue: QtyDecimal;
  fulfilledValue: QtyDecimal;
  activeResidualValue: QtyDecimal;
  cutValue: QtyDecimal;
  canceledValue: QtyDecimal;
  firstShippedAt: string | null;
  lastShippedAt: string | null;
  completedAt: string | null;
  promisedDeliveryAt: string | null;
  isOverdue: boolean;
  badges: SalesOrderFlowBadge[];
  inconsistencies: SalesOrderItemFlowInconsistency[];
  /**
   * false quando o pedido está cancelado / sem itens ativos —
   * fora das colunas operacionais ativas do Kanban.
   */
  isInActiveOperationalColumn: boolean;
  itemStages: SalesOrderItemFlowStage[];
};

function money(value: Prisma.Decimal | string | number | null | undefined): QtyDecimal {
  if (value == null || value === "") return ZERO;
  try {
    const d = value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
    if (d.isNaN() || !d.isFinite()) return ZERO;
    return d.toDecimalPlaces(MONEY_DP, ROUND);
  } catch {
    return ZERO;
  }
}

function max0(d: QtyDecimal): QtyDecimal {
  return d.lt(0) ? ZERO : d;
}

function minQty(a: QtyDecimal, b: QtyDecimal): QtyDecimal {
  return a.lte(b) ? a : b;
}

function toIso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function proportional(
  planned: QtyDecimal,
  part: QtyDecimal | null,
  whole: QtyDecimal | null
): QtyDecimal {
  if (part == null || whole == null || whole.lte(0)) return ZERO;
  return planned.mul(max0(part)).div(whole).toDecimalPlaces(MONEY_DP, ROUND);
}

function pushInconsistency(
  list: SalesOrderItemFlowInconsistency[],
  code: SalesOrderFlowInconsistencyCode,
  detail: string
): void {
  if (list.some((i) => i.code === code && i.detail === detail)) return;
  list.push({
    code,
    severity: SALES_ORDER_FLOW_INCONSISTENCY_SEVERITY_BY_CODE[code],
    detail,
  });
}

function weightedProgressAverage(
  items: readonly ResolveSalesOrderItemFlowResult[],
  pick: (p: SalesOrderItemFlowProgress) => QtyDecimal | null
): QtyDecimal {
  let weightSum = ZERO;
  let coveredSum = ZERO;
  let anyNull = false;

  for (const item of items) {
    if (!item.isActiveForKanban) continue;
    const weight =
      item.shipTargetQuantity.gt(0)
        ? item.shipTargetQuantity
        : item.orderedQuantity != null && item.orderedQuantity.gt(0)
          ? item.orderedQuantity
          : ZERO;
    if (weight.lte(0)) continue;
    const pct = pick(item.progress);
    if (pct == null) {
      anyNull = true;
      continue;
    }
    weightSum = weightSum.add(weight);
    coveredSum = coveredSum.add(weight.mul(pct).div(HUNDRED));
  }

  if (weightSum.lte(0)) {
    return anyNull ? ZERO : ZERO;
  }
  const avg = coveredSum.mul(HUNDRED).div(weightSum);
  return minQty(avg, HUNDRED).toDecimalPlaces(2, ROUND);
}

function pickBottleneck(
  active: readonly ResolveSalesOrderItemFlowResult[],
  stage: SalesOrderFlowStage
): SalesOrderFlowBottleneck | null {
  const atStage = active.filter((i) => i.currentStage === stage);
  if (atStage.length === 0) {
    // fallback: item com estágio mais cedo
    if (active.length === 0) return null;
    const earliest = [...active].sort((a, b) =>
      compareSalesOrderFlowStagePriority(a.currentStage, b.currentStage)
    )[0]!;
    return {
      stage: earliest.currentStage,
      salesOrderItemId: earliest.salesOrderItemId,
      stageReason: earliest.stageReason,
    };
  }
  const sorted = [...atStage].sort((a, b) =>
    a.salesOrderItemId.localeCompare(b.salesOrderItemId)
  );
  const item = sorted[0]!;
  return {
    stage,
    salesOrderItemId: item.salesOrderItemId,
    stageReason: item.stageReason,
  };
}

/**
 * Consolida o fluxo do Pedido a partir dos resultados por item (OP-50).
 */
export function resolveSalesOrderFlow(
  itemResults: readonly ResolveSalesOrderItemFlowResult[],
  orderContext: ResolveSalesOrderFlowOrderContext
): ResolveSalesOrderFlowResult {
  const inconsistencies: SalesOrderItemFlowInconsistency[] = [];
  const financialById = new Map(
    (orderContext.itemFinancials ?? []).map((f) => [f.salesOrderItemId, f] as const)
  );
  const shippedAtById = new Map(
    (orderContext.itemShippedAt ?? []).map((s) => [s.salesOrderItemId, s.shippedAt] as const)
  );

  const totalItems = itemResults.length;
  const active = itemResults.filter((i) => i.isActiveForKanban);
  const canceledItems = itemResults.filter(
    (i) => i.currentStage === "CANCELED" || !i.isActiveForKanban
  ).length;
  const completedItems = itemResults.filter(
    (i) => i.isActiveForKanban && i.currentStage === "SHIPPED_COMPLETED"
  ).length;
  const pendingItems = active.filter(
    (i) => i.currentStage !== "SHIPPED_COMPLETED"
  ).length;
  const inconsistentItems = itemResults.filter(
    (i) => i.inconsistencies.length > 0
  ).length;

  // Propagar inconsistências dos itens (dedupe por code+detail).
  for (const item of itemResults) {
    for (const inc of item.inconsistencies) {
      pushInconsistency(
        inconsistencies,
        inc.code,
        `[item ${item.salesOrderItemId}] ${inc.detail}`
      );
    }
  }

  const activeStages = active.map((i) => i.currentStage);
  const uniqueActiveStages = new Set(activeStages);
  if (uniqueActiveStages.size > 1) {
    pushInconsistency(
      inconsistencies,
      "MIXED_ACTIVE_ITEM_STAGES",
      `Itens ativos em estágios distintos: ${[...uniqueActiveStages].join(", ")}.`
    );
  }

  let currentStage: SalesOrderFlowStage =
    pickSalesOrderFlowStageFromItemStages(
      itemResults.map((i) =>
        i.isActiveForKanban ? i.currentStage : ("CANCELED" as const)
      )
    ) ?? "CANCELED";

  // Pedido cancelado no IndusCost fica fora das colunas operacionais ativas.
  const orderCancelled =
    (orderContext.orderStatus ?? "").toUpperCase() === "CANCELLED" ||
    (orderContext.orderStatus ?? "").toUpperCase() === "CANCELED";

  if (orderCancelled) {
    currentStage = "CANCELED";
  }

  // Corte: pedido pode concluir quando não resta obrigação ativa e
  // toda quantidade atendida dos itens ativos está em SHIPPED_COMPLETED
  // (Doc+NF válidos já exigidos no motor do item).
  const allActiveCompleted =
    active.length > 0 &&
    active.every((i) => i.currentStage === "SHIPPED_COMPLETED");
  if (!orderCancelled && allActiveCompleted) {
    currentStage = "SHIPPED_COMPLETED";
  }

  const isInActiveOperationalColumn =
    !orderCancelled &&
    currentStage !== "CANCELED" &&
    active.length > 0;

  const currentBottleneck = isInActiveOperationalColumn
    ? pickBottleneck(active, currentStage)
    : null;

  // Monetários
  let orderValue = ZERO;
  let fulfilledValue = ZERO;
  let activeResidualValue = ZERO;
  let cutValue = ZERO;
  let canceledValue = ZERO;

  for (const item of itemResults) {
    const fin = financialById.get(item.salesOrderItemId);
    const planned = money(fin?.plannedNetValue ?? 0);
    orderValue = orderValue.add(planned);

    const ordered = item.orderedQuantity;
    if (
      item.currentStage === "CANCELED" ||
      item.fulfillment.classification === "CANCELED"
    ) {
      canceledValue = canceledValue.add(planned);
      continue;
    }

    const cutPart = proportional(planned, item.cutQuantity, ordered);
    const residualPart = proportional(
      planned,
      item.activeRemainingQuantity,
      ordered
    );
    let fulfilledPart = planned.sub(cutPart).sub(residualPart);
    if (fulfilledPart.lt(0)) fulfilledPart = ZERO;

    cutValue = cutValue.add(cutPart);
    activeResidualValue = activeResidualValue.add(residualPart);
    fulfilledValue = fulfilledValue.add(fulfilledPart);
  }

  orderValue = orderValue.toDecimalPlaces(MONEY_DP, ROUND);
  fulfilledValue = fulfilledValue.toDecimalPlaces(MONEY_DP, ROUND);
  activeResidualValue = activeResidualValue.toDecimalPlaces(MONEY_DP, ROUND);
  cutValue = cutValue.toDecimalPlaces(MONEY_DP, ROUND);
  canceledValue = canceledValue.toDecimalPlaces(MONEY_DP, ROUND);

  // Progressos consolidados (média ponderada por shipTarget/ordered dos ativos)
  const progressBase = active.length > 0 ? active : itemResults;
  const producedSamples = progressBase
    .filter((i) => i.isActiveForKanban)
    .map((i) => i.progress.produced);
  const allProducedNull =
    producedSamples.length === 0 || producedSamples.every((p) => p == null);

  const progress: SalesOrderItemFlowProgress = {
    productionOrder: weightedProgressAverage(progressBase, (p) => p.productionOrder),
    produced: allProducedNull
      ? null
      : weightedProgressAverage(progressBase, (p) => p.produced ?? ZERO),
    documented: weightedProgressAverage(progressBase, (p) => p.documented),
    invoiced: weightedProgressAverage(progressBase, (p) => p.invoiced),
    shipped: weightedProgressAverage(progressBase, (p) => p.shipped),
  };

  // Datas de envio normalizadas
  const shippedTimes: number[] = [];
  for (const item of itemResults) {
    if (item.currentStage !== "SHIPPED_COMPLETED" && item.shippedQuantity.lte(0)) {
      continue;
    }
    const raw = shippedAtById.get(item.salesOrderItemId);
    const iso = toIso(raw ?? null);
    if (iso) shippedTimes.push(new Date(iso).getTime());
  }
  shippedTimes.sort((a, b) => a - b);
  const firstShippedAt =
    shippedTimes.length > 0 ? new Date(shippedTimes[0]!).toISOString() : null;
  const lastShippedAt =
    shippedTimes.length > 0
      ? new Date(shippedTimes[shippedTimes.length - 1]!).toISOString()
      : null;

  const completedItemIds = new Set(
    itemResults
      .filter((i) => i.isActiveForKanban && i.currentStage === "SHIPPED_COMPLETED")
      .map((i) => i.salesOrderItemId)
  );
  const lastDocumentAt = maxIsoTimestamp(
    (orderContext.itemDocumentAt ?? [])
      .filter((row) => completedItemIds.has(row.salesOrderItemId))
      .map((row) => row.at)
  );
  const lastNfeIssuedAt = maxIsoTimestamp(
    (orderContext.itemNfeIssuedAt ?? [])
      .filter((row) => completedItemIds.has(row.salesOrderItemId))
      .map((row) => row.at)
  );

  const completedAt = resolveSalesOrderFlowCompletedAt({
    isShippedCompleted: currentStage === "SHIPPED_COMPLETED",
    lastNormalizedShippedAt: lastShippedAt,
    lastDocumentAt,
    lastNfeIssuedAt,
    persistedCompletedAt: orderContext.persistedCompletedAt,
  });
  if (currentStage === "SHIPPED_COMPLETED" && completedAt == null) {
    pushInconsistency(
      inconsistencies,
      "ORDER_COMPLETED_AT_MISSING",
      "Pedido em SHIPPED_COMPLETED sem data de envio, documento de saída ou NF-e com data confiável."
    );
  }

  const promisedDeliveryAt = toIso(orderContext.promisedDeliveryAt);
  const referenceDate = orderContext.referenceDate
    ? new Date(orderContext.referenceDate)
    : new Date();
  const promisedDate = orderContext.promisedDeliveryAt
    ? new Date(orderContext.promisedDeliveryAt)
    : null;

  const isOverdue =
    isInActiveOperationalColumn &&
    currentStage !== "SHIPPED_COMPLETED" &&
    promisedDate != null &&
    !Number.isNaN(promisedDate.getTime()) &&
    !Number.isNaN(referenceDate.getTime()) &&
    promisedDate.getTime() < referenceDate.getTime();

  const badges: SalesOrderFlowBadge[] = [];
  if (!isInActiveOperationalColumn || currentStage === "CANCELED") {
    badges.push("OUT_OF_ACTIVE_COLUMNS");
    badges.push("CANCELED");
  }
  if (currentStage === "SHIPPED_COMPLETED") badges.push("COMPLETED");
  if (isOverdue) badges.push("OVERDUE");
  if (inconsistencies.length > 0 || inconsistentItems > 0) badges.push("INCONSISTENT");
  if (cutValue.gt(0) || itemResults.some((i) => i.cutQuantity.gt(0))) {
    badges.push("CUT");
  }
  if (
    itemResults.some(
      (i) => i.fulfillment.classification === "PARTIALLY_FULFILLED"
    )
  ) {
    badges.push("PARTIAL");
  }
  if (uniqueActiveStages.size > 1) badges.push("MIXED_STAGES");

  return {
    salesOrderId: orderContext.salesOrderId,
    currentStage,
    currentBottleneck,
    nextAction: SALES_ORDER_FLOW_STAGE_NEXT_ACTION[currentStage],
    responsibleArea: SALES_ORDER_FLOW_STAGE_RESPONSIBLE_AREA[currentStage],
    totalItems,
    completedItems,
    pendingItems,
    inconsistentItems,
    canceledItems,
    activeItems: active.length,
    progress,
    orderValue,
    fulfilledValue,
    activeResidualValue,
    cutValue,
    canceledValue,
    firstShippedAt,
    lastShippedAt,
    completedAt,
    promisedDeliveryAt,
    isOverdue,
    badges: [...new Set(badges)],
    inconsistencies,
    isInActiveOperationalColumn,
    itemStages: itemResults.map((i) => i.currentStage),
  };
}

/** Label oficial do estágio consolidado (atalho UI). */
export function getSalesOrderFlowConsolidatedStageLabel(
  stage: SalesOrderFlowStage
): string {
  return SALES_ORDER_FLOW_STAGE_LABELS[stage];
}
