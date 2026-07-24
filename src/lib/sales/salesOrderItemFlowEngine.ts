/**
 * OP-50 — Motor puro do fluxo por item do Pedido de Venda.
 *
 * Fonte normativa: `docs/commercial/sales-order-flow/state-machine.md`
 * Evidências operacionais (KAN-LINK-07): exclusivamente
 * `SalesOrderOperationalEvidenceGraph` (pack → grafo → adapt → este motor).
 *
 * Precedência de estágio (validada no fluxo atual):
 * 1) obrigação ativa (+ corte/cancelamento)
 * 2) evidências terminais / envio / faturamento / documentação
 * 3) necessidade produtiva residual (não reabre se evidência posterior cobre)
 * 4) liberação comercial
 * 5) inconsistências
 *
 * Reutiliza:
 * - FIN-03 `classifySalesOrderItemFinancialFulfillment`
 * - OP-48 `resolveSalesOrderItemProductionRequirement`
 * - OP-46 catálogo de estágios / inconsistências / próxima ação
 *
 * Sem I/O, sem persistência de snapshot, sem Number para qty críticas.
 */

import { Prisma } from "@prisma/client";
import {
  classifySalesOrderItemFinancialFulfillment,
  type ClassifySalesOrderItemFinancialFulfillmentResult,
} from "@/src/lib/finance/salesOrderItemFinancialFulfillmentClassifier.js";
import {
  SALES_ORDER_FLOW_INCONSISTENCY_SEVERITY_BY_CODE,
  SALES_ORDER_FLOW_STAGE_NEXT_ACTION,
  SALES_ORDER_FLOW_STAGE_RESPONSIBLE_AREA,
  SALES_ORDER_ITEM_FLOW_STAGE_REASON,
  type SalesOrderFlowInconsistencyCode,
  type SalesOrderFlowInconsistencySeverity,
  type SalesOrderFlowResponsibleArea,
  type SalesOrderItemFlowStage,
} from "./salesOrderFlowCatalog.js";
import {
  resolveSalesOrderItemProductionRequirement,
  type ResolveSalesOrderItemProductionRequirementInput,
  type ResolveSalesOrderItemProductionRequirementResult,
  type SalesOrderItemProductCommercialClass,
} from "./salesOrderItemProductionRequirement.js";
import type { SalesOrderFlowEvidencePack } from "./salesOrderFlowEvidence.js";
import { adaptOperationalEvidenceItemToMotorAllocations } from "./salesOrderOperationalEvidenceGraph.js";
import { getSalesOrderOperationalEvidenceGraphFromPack } from "./salesOrderOperationalEvidenceFromPack.js";
import {
  normalizeNomusProductionOrderStatus,
  type NomusProductionOrderStatusNormalized,
} from "./nomusProductionOrderStatus.js";

export type QtyDecimal = Prisma.Decimal;

const ZERO = new Prisma.Decimal(0);
const HUNDRED = new Prisma.Decimal(100);
const QTY_DP = 6;
const ROUND = Prisma.Decimal.ROUND_HALF_UP;

export type SalesOrderItemFlowDocumentAllocationInput = {
  allocationKey: string;
  quantity: Prisma.Decimal | string | number;
  /** Documento cancelado/inválido não cobre. Default true. */
  isValid?: boolean;
  isCanceled?: boolean;
};

export type SalesOrderItemFlowNfeAllocationInput = {
  nfeExternalId: number;
  quantity?: Prisma.Decimal | string | number | null;
  isCanceled?: boolean;
  isValidForBilling?: boolean;
  /** Há documento de saída alocado ligado a esta NF. */
  hasDocument?: boolean;
  /** Data de envio/saída normalizada presente. */
  hasShipDate?: boolean;
};

export type SalesOrderItemFlowProductionLinkInput = {
  linkedQuantity?: Prisma.Decimal | string | number | null;
  isCurrent?: boolean;
  /** Status bruto Nomus da OP (`Liberada`, `Encerrada`, …). */
  status?: string | null;
  productionOrderId?: string | null;
  productionOrderExternalId?: number | null;
  isCanceled?: boolean;
};

export type ResolveSalesOrderItemFlowInput = {
  salesOrderItemId: string;
  status?: unknown;
  statusNormalized?: string | null;
  statusRaw?: string | null;
  nomusIsCanceled?: boolean | null;
  nomusIsCut?: boolean | null;
  nomusIsStale?: boolean | null;
  orderedQuantity?: Prisma.Decimal | string | number | null;
  fulfilledQuantity?: Prisma.Decimal | string | number | null;
  /**
   * Quantidade formalmente cortada (fonte oficial, quando existir além do status).
   * Usada na obrigação ativa quando o status não é terminal FULFILLED_WITH_CUT.
   */
  officialCutQuantity?: Prisma.Decimal | string | number | null;
  /**
   * Quantidade formalmente cancelada (parcial). Cancelamento total continua via status CANCELED.
   */
  officialCanceledQuantity?: Prisma.Decimal | string | number | null;
  /** Qty produzida normalizada — null até existir no stage. */
  producedQuantity?: Prisma.Decimal | string | number | null;
  productionOrderLinks?: readonly SalesOrderItemFlowProductionLinkInput[];
  documentAllocations?: readonly SalesOrderItemFlowDocumentAllocationInput[];
  nfeAllocations?: readonly SalesOrderItemFlowNfeAllocationInput[];
  promisedDeliveryAt?: Date | string | null;
  referenceDate?: Date | string | null;
  productType?: "PRODUCT" | "COMPONENT" | "MATERIAL" | null;
  costingMode?: string | null;
  productCommercialClass?: SalesOrderItemProductCommercialClass | null;
  hasProductRouting?: boolean | null;
  hasProductBom?: boolean | null;
  explicitRequiresProduction?: boolean | null;
};

export type SalesOrderItemFlowProgress = {
  /** 0–100 */
  productionOrder: QtyDecimal;
  /** 0–100; null se producedQuantity não normalizada */
  produced: QtyDecimal | null;
  documented: QtyDecimal;
  invoiced: QtyDecimal;
  shipped: QtyDecimal;
};

export type SalesOrderItemFlowInconsistency = {
  code: SalesOrderFlowInconsistencyCode;
  severity: SalesOrderFlowInconsistencySeverity;
  detail: string;
};

export type ResolveSalesOrderItemFlowResult = {
  salesOrderItemId: string;
  requiresProduction: boolean | null;
  productionRequirement: ResolveSalesOrderItemProductionRequirementResult;
  fulfillment: ClassifySalesOrderItemFinancialFulfillmentResult;
  orderedQuantity: QtyDecimal | null;
  productionOrderQuantity: QtyDecimal;
  producedQuantity: QtyDecimal | null;
  documentedQuantity: QtyDecimal;
  invoicedQuantity: QtyDecimal;
  shippedQuantity: QtyDecimal;
  activeRemainingQuantity: QtyDecimal | null;
  cutQuantity: QtyDecimal;
  canceledQuantity: QtyDecimal;
  /**
   * Obrigação ativa comercial:
   * orderedQuantity − cutQuantity − canceledQuantity.
   */
  activeObligationQuantity: QtyDecimal;
  /**
   * Saldo ainda não atendido:
   * max(0, activeObligation − fulfilledQuantity).
   * Só este residual pode exigir WAITING_PRODUCTION_ORDER.
   */
  remainingFulfillmentQuantity: QtyDecimal;
  /** Quantidade que ainda precisa cobrir doc/NF no fluxo (exclui corte/cancelamento). */
  shipTargetQuantity: QtyDecimal;
  /**
   * true quando a obrigação comercial foi atendida sem cobertura de OP
   * (classificação operacional — não afirma movimento de estoque).
   */
  fulfilledWithoutProduction: boolean;
  currentStage: SalesOrderItemFlowStage;
  stageReason: string;
  nextAction: string;
  responsibleArea: SalesOrderFlowResponsibleArea;
  promisedDeliveryAt: string | null;
  isOverdue: boolean;
  progress: SalesOrderItemFlowProgress;
  inconsistencies: SalesOrderItemFlowInconsistency[];
  /** false para cancelado/stale — não deve votar no Kanban. */
  isActiveForKanban: boolean;
};

function qty(
  value: Prisma.Decimal | string | number | null | undefined
): QtyDecimal | null {
  if (value == null || value === "") return null;
  try {
    const d = value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
    if (d.isNaN() || !d.isFinite()) return null;
    return d;
  } catch {
    return null;
  }
}

function qtyOrZero(
  value: Prisma.Decimal | string | number | null | undefined
): QtyDecimal {
  return qty(value) ?? ZERO;
}

function max0(d: QtyDecimal): QtyDecimal {
  return d.lt(0) ? ZERO : d;
}

function minQty(a: QtyDecimal, b: QtyDecimal): QtyDecimal {
  return a.lte(b) ? a : b;
}

function progressPct(covered: QtyDecimal, target: QtyDecimal): QtyDecimal {
  if (target.lte(0)) {
    return covered.gt(0) ? HUNDRED : ZERO;
  }
  const raw = covered.mul(HUNDRED).div(target);
  return minQty(raw, HUNDRED).toDecimalPlaces(2, ROUND);
}

function toIso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
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

function sumDedupedQty(
  rows: readonly { allocationKey: string; quantity: QtyDecimal }[]
): QtyDecimal {
  const seen = new Set<string>();
  let total = ZERO;
  for (const row of rows) {
    const key = row.allocationKey.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    total = total.add(max0(row.quantity));
  }
  return total;
}

type ProductionOrderQtyBuckets = {
  /** Planejada ativa: vínculos atuais, não cancelados (dedupe por OP). */
  activePlannedQuantity: QtyDecimal;
  /** Planejada encerrada: subset Encerrada. */
  closedPlannedQuantity: QtyDecimal;
  hasOfficialOpLink: boolean;
  dominantAwaitingStatus: NomusProductionOrderStatusNormalized | null;
};

function sumProductionOrderQtyBuckets(
  links: readonly SalesOrderItemFlowProductionLinkInput[] | undefined,
  inconsistencies: SalesOrderItemFlowInconsistency[]
): ProductionOrderQtyBuckets {
  let activePlannedQuantity = ZERO;
  let closedPlannedQuantity = ZERO;
  let hasOfficialOpLink = false;
  const seen = new Set<string>();
  const awaitingStatuses = new Set<NomusProductionOrderStatusNormalized>();

  for (const link of links ?? []) {
    if (link.isCurrent === false) continue;

    const statusInfo = normalizeNomusProductionOrderStatus(link.status);
    const canceled = link.isCanceled === true || statusInfo.isCanceled;
    if (canceled) continue;

    const dedupeKey =
      (link.productionOrderId?.trim() ||
        (link.productionOrderExternalId != null
          ? `ext:${link.productionOrderExternalId}`
          : "")) ||
      `qty:${String(link.linkedQuantity ?? "")}:${statusInfo.statusNormalized}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const q = qty(link.linkedQuantity);
    if (q == null) {
      pushInconsistency(
        inconsistencies,
        "OP_LINK_WITHOUT_QUANTITY",
        "Vínculo OP atual sem linkedQuantity."
      );
      continue;
    }

    const amount = max0(q);
    if (amount.lte(0)) continue;

    hasOfficialOpLink = true;
    activePlannedQuantity = activePlannedQuantity.add(amount);
    if (statusInfo.isClosed) {
      closedPlannedQuantity = closedPlannedQuantity.add(amount);
    } else {
      awaitingStatuses.add(statusInfo.statusNormalized);
    }
  }

  let dominantAwaitingStatus: NomusProductionOrderStatusNormalized | null = null;
  if (awaitingStatuses.has("RELEASED")) dominantAwaitingStatus = "RELEASED";
  else if (awaitingStatuses.has("REQUISITIONED_PARTIAL"))
    dominantAwaitingStatus = "REQUISITIONED_PARTIAL";
  else if (awaitingStatuses.has("REQUISITIONED_TOTAL"))
    dominantAwaitingStatus = "REQUISITIONED_TOTAL";
  else if (awaitingStatuses.has("UNKNOWN")) dominantAwaitingStatus = "UNKNOWN";

  return {
    activePlannedQuantity,
    closedPlannedQuantity,
    hasOfficialOpLink,
    dominantAwaitingStatus,
  };
}

function sumDocumentQty(
  rows: readonly SalesOrderItemFlowDocumentAllocationInput[] | undefined
): QtyDecimal {
  const valid = (rows ?? [])
    .filter((r) => r.isValid !== false && r.isCanceled !== true)
    .map((r) => ({
      allocationKey: r.allocationKey,
      quantity: qtyOrZero(r.quantity),
    }));
  return sumDedupedQty(valid);
}

function sumNfeQty(
  rows: readonly SalesOrderItemFlowNfeAllocationInput[] | undefined,
  options: { onlyValid: boolean }
): {
  quantity: QtyDecimal;
  anyCanceledWithCoverage: boolean;
  anyValidWithoutDocument: boolean;
  anyValidWithoutShipDate: boolean;
  anyDocumentWithoutNfe: boolean;
} {
  let quantity = ZERO;
  let anyCanceledWithCoverage = false;
  let anyValidWithoutDocument = false;
  let anyValidWithoutShipDate = false;
  const seen = new Set<number>();

  for (const row of rows ?? []) {
    if (seen.has(row.nfeExternalId)) continue;
    seen.add(row.nfeExternalId);

    const canceled = row.isCanceled === true;
    const valid =
      row.isValidForBilling !== false && !canceled;

    if (canceled) {
      anyCanceledWithCoverage = true;
      continue;
    }
    if (options.onlyValid && !valid) continue;

    const q = qty(row.quantity);
    // Sem qty explícita: NF válida conta como cobertura unitária simbólica só se caller passou quantity;
    // se quantity omitida, não inventar — 0.
    if (q != null) quantity = quantity.add(max0(q));

    if (valid && row.hasDocument === false) anyValidWithoutDocument = true;
    if (valid && row.hasShipDate !== true) anyValidWithoutShipDate = true;
  }

  return {
    quantity,
    anyCanceledWithCoverage,
    anyValidWithoutDocument,
    anyValidWithoutShipDate,
    anyDocumentWithoutNfe: false,
  };
}

/**
 * Função pura: resolve o estágio e métricas do fluxo para um item.
 */
export function resolveSalesOrderItemFlow(
  input: ResolveSalesOrderItemFlowInput
): ResolveSalesOrderItemFlowResult {
  const inconsistencies: SalesOrderItemFlowInconsistency[] = [];
  const orderedQuantity = qty(input.orderedQuantity);
  const fulfilledQuantity = qty(input.fulfilledQuantity);
  const producedQuantity = qty(input.producedQuantity);

  const fulfillment = classifySalesOrderItemFinancialFulfillment({
    status: input.status,
    statusNormalized: input.statusNormalized,
    statusRaw: input.statusRaw,
    orderedQuantity:
      orderedQuantity != null ? Number(orderedQuantity.toString()) : null,
    fulfilledQuantity:
      fulfilledQuantity != null ? Number(fulfilledQuantity.toString()) : null,
    nomusIsCut: input.nomusIsCut,
    nomusIsCanceled: input.nomusIsCanceled,
  });

  const activeRemainingQuantity = qty(fulfillment.remainingQuantity);

  const productionBuckets = sumProductionOrderQtyBuckets(
    input.productionOrderLinks,
    inconsistencies
  );
  /** Quantidade planejada vinculada (não é quantidade produzida). */
  const productionOrderQuantity = productionBuckets.activePlannedQuantity;
  const closedProductionOrderQuantity = productionBuckets.closedPlannedQuantity;
  const hasOfficialOpLink = productionBuckets.hasOfficialOpLink;

  const productionRequirement = resolveSalesOrderItemProductionRequirement({
    productType: input.productType,
    costingMode: input.costingMode,
    productCommercialClass: input.productCommercialClass,
    hasProductRouting: input.hasProductRouting,
    hasProductBom: input.hasProductBom,
    hasOfficialProductionOrderLink: hasOfficialOpLink,
    productionOrderLinkIsCurrent: hasOfficialOpLink ? true : false,
    explicitRequiresProduction: input.explicitRequiresProduction,
  } satisfies ResolveSalesOrderItemProductionRequirementInput);

  const requiresProduction = productionRequirement.requiresProduction;

  if (productionRequirement.impliesInconsistency) {
    pushInconsistency(
      inconsistencies,
      "REQUIRES_PRODUCTION_UNKNOWN",
      `Necessidade de produção indefinida (${productionRequirement.reasonCode}).`
    );
  }

  if (producedQuantity == null && hasOfficialOpLink) {
    pushInconsistency(
      inconsistencies,
      "PRODUCTION_QTY_NOT_NORMALIZED",
      "Quantidade produzida ainda não normalizada no stage; /rest/ordens.qtde é planejada e não prova execução."
    );
  }

  // Quantidades de corte / cancelamento
  // Regra: activeObligation = ordered − cut − canceled (nunca negativos).
  let canceledQuantity = ZERO;
  let cutQuantity = ZERO;
  if (fulfillment.classification === "CANCELED" || input.nomusIsCanceled === true) {
    canceledQuantity = orderedQuantity != null ? max0(orderedQuantity) : ZERO;
  } else if (fulfillment.classification === "FULFILLED_WITH_CUT") {
    if (orderedQuantity != null && fulfilledQuantity != null) {
      cutQuantity = max0(orderedQuantity.sub(fulfilledQuantity));
    } else if (orderedQuantity != null) {
      cutQuantity = max0(orderedQuantity);
    }
  } else {
    // Corte/cancelamento parcial oficial (quando a fonte expõe qty sem status terminal).
    const officialCut = max0(qtyOrZero(input.officialCutQuantity));
    const officialCanceled = max0(qtyOrZero(input.officialCanceledQuantity));
    if (orderedQuantity != null) {
      const ordered = max0(orderedQuantity);
      canceledQuantity = minQty(officialCanceled, ordered);
      const afterCancel = max0(ordered.sub(canceledQuantity));
      cutQuantity = minQty(officialCut, afterCancel);
    } else {
      canceledQuantity = officialCanceled;
      cutQuantity = officialCut;
    }
    if (input.nomusIsCut === true && cutQuantity.lte(0)) {
      // Neste ramo classification já não é FULFILLED_WITH_CUT (tratado acima).
      pushInconsistency(
        inconsistencies,
        "CUT_WITHOUT_OFFICIAL_STATUS",
        "Flag de corte sem status oficial FULFILLED_WITH_CUT."
      );
    }
  }

  // Alvo operacional a cobrir com DS/NF (exclui cancelado e corte).
  // OP só é exigida sobre remainingFulfillment (saldo ainda não atendido).
  let shipTargetQuantity = ZERO;
  if (fulfillment.classification === "CANCELED" || input.nomusIsCanceled === true) {
    shipTargetQuantity = ZERO;
  } else if (fulfillment.classification === "FULFILLED_WITH_CUT") {
    shipTargetQuantity =
      fulfilledQuantity != null ? max0(fulfilledQuantity) : ZERO;
  } else if (orderedQuantity != null) {
    shipTargetQuantity = max0(orderedQuantity.sub(canceledQuantity).sub(cutQuantity));
  }

  const activeObligationQuantity = shipTargetQuantity;
  const fulfilledForObligation =
    fulfilledQuantity != null ? max0(fulfilledQuantity) : ZERO;
  // Atendimento acima da obrigação ativa não gera saldo negativo.
  const remainingFulfillmentQuantity = max0(
    activeObligationQuantity.sub(fulfilledForObligation)
  );

  const documentedQuantity = sumDocumentQty(input.documentAllocations);
  const nfeAgg = sumNfeQty(input.nfeAllocations, { onlyValid: true });
  // Emissão/processamento de NF válida = proxy de envio (shipped = invoiced válido).
  const invoicedQuantity = nfeAgg.quantity;
  const shippedQuantity = nfeAgg.quantity;

  if (nfeAgg.anyCanceledWithCoverage) {
    pushInconsistency(
      inconsistencies,
      "NFE_CANCELED_WITH_ACTIVE_ITEMS",
      "Há NF-e cancelada no contexto do item."
    );
  }
  if (nfeAgg.anyValidWithoutDocument) {
    pushInconsistency(
      inconsistencies,
      "NFE_WITHOUT_DOCUMENT",
      "NF-e válida sem documento de saída alocado."
    );
  }
  if (nfeAgg.anyValidWithoutShipDate && invoicedQuantity.gt(0)) {
    pushInconsistency(
      inconsistencies,
      "NFE_SHIP_DATE_MISSING",
      "NF-e válida sem data de envio normalizada; envio por proxy de autorização."
    );
  }
  if (documentedQuantity.gt(0) && invoicedQuantity.lte(0)) {
    pushInconsistency(
      inconsistencies,
      "DOCUMENT_WITHOUT_NFE",
      "Documento de saída alocado sem NF-e válida."
    );
  }

  if (
    fulfillment.classification === "PARTIALLY_FULFILLED" &&
    (activeRemainingQuantity == null || activeRemainingQuantity.lte(0))
  ) {
    pushInconsistency(
      inconsistencies,
      "PARTIAL_WITHOUT_REMAINING_QTY",
      "Parcial sem saldo residual coerente."
    );
  }

  if (
    (fulfillment.classification === "FULLY_FULFILLED" ||
      fulfillment.classification === "FULFILLED_WITH_CUT") &&
    shipTargetQuantity.gt(0) &&
    documentedQuantity.lte(0) &&
    invoicedQuantity.lte(0)
  ) {
    pushInconsistency(
      inconsistencies,
      "FULFILLED_WITHOUT_COVERAGE",
      "Item atendido sem cobertura documental/fiscal."
    );
  }

  if (fulfillment.classification === "UNKNOWN") {
    pushInconsistency(
      inconsistencies,
      "ITEM_STATUS_UNKNOWN",
      "Status Nomus do item desconhecido; saldo preservado."
    );
  }

  if (input.nomusIsStale === true) {
    pushInconsistency(
      inconsistencies,
      "STALE_ITEM_PRESENT",
      "Item stale presente no pedido."
    );
  }

  // Excesso = cobertura acima do alvo (cap de progresso em 100%, excesso vira inconsistência).
  if (shipTargetQuantity.gt(0)) {
    if (productionOrderQuantity.gt(shipTargetQuantity)) {
      pushInconsistency(
        inconsistencies,
        "EXCESS_COVERAGE",
        "linkedQuantity de OP excede a obrigação ativa do item."
      );
    }
    if (documentedQuantity.gt(shipTargetQuantity)) {
      pushInconsistency(
        inconsistencies,
        "EXCESS_COVERAGE",
        "Quantidade documentada excede a obrigação ativa do item."
      );
    }
    if (invoicedQuantity.gt(shipTargetQuantity)) {
      pushInconsistency(
        inconsistencies,
        "EXCESS_COVERAGE",
        "Quantidade faturada/enviada (NF válida) excede a obrigação ativa do item."
      );
    }
  }

  const promisedDeliveryAt = toIso(input.promisedDeliveryAt);
  const referenceDate = input.referenceDate
    ? new Date(input.referenceDate)
    : new Date();
  const promisedDate = input.promisedDeliveryAt
    ? new Date(input.promisedDeliveryAt)
    : null;

  // Stage resolution
  let currentStage: SalesOrderItemFlowStage;
  let stageReason: string;

  const isCanceled =
    fulfillment.classification === "CANCELED" || input.nomusIsCanceled === true;
  const isStale = input.nomusIsStale === true;
  const statusNormalized = String(fulfillment.evidence.statusNormalized ?? "");
  const isUnknownCommercial =
    fulfillment.classification === "UNKNOWN" &&
    statusNormalized !== "RELEASED" &&
    statusNormalized !== "PARTIAL" &&
    statusNormalized !== "FULFILLED" &&
    statusNormalized !== "FULFILLED_WITH_CUT";
  const isPendingRelease =
    statusNormalized === "PENDING" ||
    (fulfillment.classification === "NOT_FULFILLED" &&
      statusNormalized === "PENDING");

  const needsProduction = requiresProduction === true;
  const skipProduction =
    requiresProduction === false || requiresProduction === null;

  const postProductionStage = resolvePostProductionStage({
    shipTargetQuantity,
    documentedQuantity,
    shippedQuantity,
  });

  /** Cobertura de OP exigida apenas para o saldo ainda não atendido. */
  const productionCoverageTarget = remainingFulfillmentQuantity;
  const fulfilledWithoutProductionFlag =
    needsProduction &&
    remainingFulfillmentQuantity.lte(0) &&
    activeObligationQuantity.gt(0) &&
    productionOrderQuantity.lt(activeObligationQuantity);

  if (fulfilledWithoutProductionFlag) {
    pushInconsistency(
      inconsistencies,
      "FULFILLED_WITHOUT_PRODUCTION",
      "Atendido pelo estoque / sem necessidade de OP (classificação operacional; não afirma movimento de estoque)."
    );
  }

  const documentCoversObligation =
    shipTargetQuantity.gt(0) && documentedQuantity.gte(shipTargetQuantity);
  const invoiceCoversObligation =
    shipTargetQuantity.gt(0) && invoicedQuantity.gte(shipTargetQuantity);
  const hasPartialDownstreamDocument =
    documentedQuantity.gt(0) && !documentCoversObligation;

  /**
   * Produção satisfeita para avançar ao pós-produção sem DS/NF:
   * apenas producedQuantity real cobrindo o residual, ou OPs Encerradas
   * cobrindo o residual. Quantidade planejada (Liberada/Requisitada) NÃO basta.
   *
   * /rest/ordens.qtde é planejada; IN_PRODUCTION exige evidência real de execução
   * (producedQuantity) — não preencher por aproximação de status ou datas.
   */
  const productionExecutionSatisfied =
    (producedQuantity != null &&
      producedQuantity.gte(productionCoverageTarget)) ||
    closedProductionOrderQuantity.gte(productionCoverageTarget);

  if (isCanceled) {
    currentStage = "CANCELED";
    stageReason = "Item cancelado — sem obrigação operacional.";
  } else if (isStale) {
    currentStage = "CANCELED";
    stageReason = "Item stale — fora do Kanban ativo.";
  } else if (invoiceCoversObligation) {
    // NF-e válida cobrindo a obrigação é terminal, inclusive com status UNKNOWN.
    currentStage = "SHIPPED_COMPLETED";
    stageReason = stageReasonFor(currentStage, {
      completedWithoutProductionOrder:
        needsProduction && productionOrderQuantity.lt(activeObligationQuantity),
      fulfilledWithoutProduction: fulfilledWithoutProductionFlag,
    });
  } else if (documentCoversObligation) {
    // DS cobrindo a obrigação prevalece sobre PENDING/UNKNOWN e sobre residual de OP.
    currentStage = postProductionStage;
    stageReason = stageReasonFor(currentStage, {
      skippedProduction: skipProduction,
      fulfilledWithoutProduction: fulfilledWithoutProductionFlag,
    });
  } else if (
    (isUnknownCommercial || isPendingRelease) &&
    documentedQuantity.lte(0) &&
    invoicedQuantity.lte(0)
  ) {
    // Sem evidência operacional posterior — gate comercial (não inventa progresso).
    currentStage = "WAITING_RELEASE";
    stageReason = isUnknownCommercial
      ? SALES_ORDER_ITEM_FLOW_STAGE_REASON.UNKNOWN_STATUS_WITHOUT_DOWNSTREAM_EVIDENCE
      : "Item aguardando liberação comercial (status PENDING).";
  } else if (
    needsProduction &&
    productionCoverageTarget.gt(0) &&
    productionOrderQuantity.lt(productionCoverageTarget)
  ) {
    // Residual sem OP suficiente tem prioridade sobre DS parcial.
    currentStage = "WAITING_PRODUCTION_ORDER";
    stageReason =
      productionOrderQuantity.lte(0)
        ? SALES_ORDER_ITEM_FLOW_STAGE_REASON.PRODUCTION_ORDER_MISSING
        : SALES_ORDER_ITEM_FLOW_STAGE_REASON.PRODUCTION_ORDER_QUANTITY_INSUFFICIENT;
  } else if (hasPartialDownstreamDocument) {
    currentStage = "WAITING_OUTPUT_DOCUMENT";
    stageReason = stageReasonFor(currentStage, {
      skippedProduction: skipProduction,
      fulfilledWithoutProduction: fulfilledWithoutProductionFlag,
    });
  } else if (isUnknownCommercial) {
    currentStage = "WAITING_RELEASE";
    stageReason =
      SALES_ORDER_ITEM_FLOW_STAGE_REASON.UNKNOWN_STATUS_WITHOUT_DOWNSTREAM_EVIDENCE;
  } else if (isPendingRelease) {
    currentStage = "WAITING_RELEASE";
    stageReason = "Item aguardando liberação comercial (status PENDING).";
  } else if (needsProduction && productionCoverageTarget.gt(0)) {
    if (
      producedQuantity != null &&
      producedQuantity.lt(productionCoverageTarget)
    ) {
      currentStage = "IN_PRODUCTION";
      stageReason = SALES_ORDER_ITEM_FLOW_STAGE_REASON.PRODUCED_QUANTITY_PARTIAL;
    } else if (productionExecutionSatisfied) {
      currentStage = postProductionStage;
      stageReason = stageReasonFor(currentStage, {
        closedProductionSatisfied: closedProductionOrderQuantity.gte(
          productionCoverageTarget
        ),
        producedSatisfied:
          producedQuantity != null &&
          producedQuantity.gte(productionCoverageTarget),
      });
    } else {
      // Planejamento suficiente (Liberada/Requisitada/desconhecido) sem execução.
      currentStage = "WAITING_PRODUCTION_ORDER";
      stageReason = awaitingProductionReason(
        productionBuckets.dominantAwaitingStatus
      );
    }
  } else {
    currentStage = postProductionStage;
    stageReason = stageReasonFor(currentStage, {
      skippedProduction: skipProduction,
      fulfilledWithoutProduction: fulfilledWithoutProductionFlag,
    });
  }

  const isOverdue =
    !isCanceled &&
    !isStale &&
    currentStage !== "SHIPPED_COMPLETED" &&
    promisedDate != null &&
    !Number.isNaN(promisedDate.getTime()) &&
    !Number.isNaN(referenceDate.getTime()) &&
    promisedDate.getTime() < referenceDate.getTime();

  const progress: SalesOrderItemFlowProgress = {
    productionOrder: progressPct(productionOrderQuantity, shipTargetQuantity),
    produced:
      producedQuantity == null
        ? null
        : progressPct(producedQuantity, shipTargetQuantity),
    documented: progressPct(documentedQuantity, shipTargetQuantity),
    invoiced: progressPct(invoicedQuantity, shipTargetQuantity),
    shipped: progressPct(shippedQuantity, shipTargetQuantity),
  };

  return {
    salesOrderItemId: input.salesOrderItemId,
    requiresProduction,
    productionRequirement,
    fulfillment,
    orderedQuantity,
    productionOrderQuantity,
    producedQuantity,
    documentedQuantity,
    invoicedQuantity,
    shippedQuantity,
    activeRemainingQuantity,
    cutQuantity,
    canceledQuantity,
    activeObligationQuantity,
    remainingFulfillmentQuantity,
    shipTargetQuantity,
    fulfilledWithoutProduction:
      requiresProduction === true &&
      remainingFulfillmentQuantity.lte(0) &&
      activeObligationQuantity.gt(0) &&
      productionOrderQuantity.lt(activeObligationQuantity),
    currentStage,
    stageReason,
    nextAction: SALES_ORDER_FLOW_STAGE_NEXT_ACTION[currentStage],
    responsibleArea: SALES_ORDER_FLOW_STAGE_RESPONSIBLE_AREA[currentStage],
    promisedDeliveryAt,
    isOverdue,
    progress,
    inconsistencies,
    isActiveForKanban: !isCanceled && !isStale,
  };
}

function resolvePostProductionStage(input: {
  shipTargetQuantity: QtyDecimal;
  documentedQuantity: QtyDecimal;
  shippedQuantity: QtyDecimal;
}): SalesOrderItemFlowStage {
  if (input.shipTargetQuantity.lte(0)) {
    // Corte total (fulfilled=0) ou sem obrigação → concluído operacionalmente
    return "SHIPPED_COMPLETED";
  }
  if (input.documentedQuantity.lt(input.shipTargetQuantity)) {
    return "WAITING_OUTPUT_DOCUMENT";
  }
  if (input.shippedQuantity.lt(input.shipTargetQuantity)) {
    return "WAITING_NFE";
  }
  return "SHIPPED_COMPLETED";
}

function awaitingProductionReason(
  dominant: NomusProductionOrderStatusNormalized | null
): string {
  switch (dominant) {
    case "RELEASED":
      return SALES_ORDER_ITEM_FLOW_STAGE_REASON.PRODUCTION_ORDER_RELEASED_AWAITING_EXECUTION;
    case "REQUISITIONED_PARTIAL":
    case "REQUISITIONED_TOTAL":
      return SALES_ORDER_ITEM_FLOW_STAGE_REASON.PRODUCTION_ORDER_REQUISITIONED_AWAITING_EXECUTION_EVIDENCE;
    default:
      return SALES_ORDER_ITEM_FLOW_STAGE_REASON.PRODUCTION_ORDER_AWAITING_EXECUTION_EVIDENCE;
  }
}

function stageReasonFor(
  stage: SalesOrderItemFlowStage,
  flags: {
    skippedProduction?: boolean;
    completedWithoutProductionOrder?: boolean;
    fulfilledWithoutProduction?: boolean;
    closedProductionSatisfied?: boolean;
    producedSatisfied?: boolean;
  }
): string {
  switch (stage) {
    case "WAITING_OUTPUT_DOCUMENT":
      if (flags.fulfilledWithoutProduction) {
        return "Atendido pelo estoque / sem necessidade de OP; falta Documento de Saída (sem afirmar movimento de estoque).";
      }
      if (flags.closedProductionSatisfied) {
        return SALES_ORDER_ITEM_FLOW_STAGE_REASON.PRODUCTION_ORDER_CLOSED_AWAITING_OUTPUT_DOCUMENT;
      }
      if (flags.producedSatisfied) {
        return "Produção real coberta; falta Documento de Saída.";
      }
      if (flags.skippedProduction) {
        return "Produção não exigida/indefinida; falta cobertura documental suficiente.";
      }
      return SALES_ORDER_ITEM_FLOW_STAGE_REASON.PARTIALLY_DOCUMENTED_AWAITING_REMAINING_OUTPUT;
    case "WAITING_NFE":
      if (flags.fulfilledWithoutProduction) {
        return "Atendido pelo estoque / sem necessidade de OP; documento presente, falta NF-e válida.";
      }
      return SALES_ORDER_ITEM_FLOW_STAGE_REASON.DOCUMENTED_AWAITING_NFE;
    case "SHIPPED_COMPLETED":
      if (flags.completedWithoutProductionOrder || flags.fulfilledWithoutProduction) {
        return "Obrigação coberta por NF-e válida; ausência histórica de OP não reabre obrigação de produção (Atendido pelo estoque / sem necessidade de OP).";
      }
      return SALES_ORDER_ITEM_FLOW_STAGE_REASON.INVOICED_QUANTITY_COMPLETED;
    default:
      return `Estágio ${stage}.`;
  }
}

/**
 * Adapta um item do pack OP-49 para o motor OP-50.
 * KAN-LINK-07: consome exclusivamente o grafo canônico de evidências.
 */
export function resolveSalesOrderItemFlowFromEvidence(
  pack: SalesOrderFlowEvidencePack,
  salesOrderItemId: string,
  options?: { referenceDate?: Date | string | null }
): ResolveSalesOrderItemFlowResult | null {
  const item = pack.items.find((i) => i.id === salesOrderItemId);
  if (!item) return null;

  const graph = getSalesOrderOperationalEvidenceGraphFromPack(pack);
  const {
    documentAllocations,
    nfeAllocations,
    productionLinks: productionOrderLinks,
  } = adaptOperationalEvidenceItemToMotorAllocations(graph, item.id);

  return resolveSalesOrderItemFlow({
    salesOrderItemId: item.id,
    status: item.nomusItemStatusRaw,
    statusNormalized: item.nomusItemStatusNormalized,
    statusRaw: item.nomusItemStatusRaw,
    nomusIsCanceled: item.nomusIsCanceled,
    nomusIsCut: item.nomusIsCut,
    nomusIsStale: item.nomusIsStale,
    orderedQuantity: item.quantity,
    fulfilledQuantity: item.nomusQuantityFulfilled,
    producedQuantity: null,
    productionOrderLinks,
    documentAllocations,
    nfeAllocations,
    promisedDeliveryAt: pack.order.expectedDeliveryDate,
    referenceDate: options?.referenceDate ?? pack.meta.loadedAt,
    productType: item.productType as "PRODUCT" | "COMPONENT" | "MATERIAL" | null,
    costingMode: item.productCostingMode,
    productCommercialClass: item.productCommercialClass,
    hasProductRouting: item.hasProductRouting,
    hasProductBom: item.hasProductBom,
  });
}
