/**
 * OP-50 — Motor puro do fluxo por item do Pedido de Venda.
 *
 * Fonte normativa: `docs/commercial/sales-order-flow/state-machine.md`
 * Evidências: contrato OP-49 (`salesOrderFlowEvidence.ts`)
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

function sumProductionOrderQty(
  links: readonly SalesOrderItemFlowProductionLinkInput[] | undefined,
  inconsistencies: SalesOrderItemFlowInconsistency[]
): QtyDecimal {
  let total = ZERO;
  for (const link of links ?? []) {
    if (link.isCurrent === false) continue;
    const q = qty(link.linkedQuantity);
    if (q == null) {
      pushInconsistency(
        inconsistencies,
        "OP_LINK_WITHOUT_QUANTITY",
        "Ordem de Produção vinculada sem quantidade informada."
      );
      continue;
    }
    total = total.add(max0(q));
  }
  return total;
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

  const productionOrderQuantity = sumProductionOrderQty(
    input.productionOrderLinks,
    inconsistencies
  );

  const hasOfficialOpLink = (input.productionOrderLinks ?? []).some(
    (l) => l.isCurrent !== false
  );

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
      "Quantidade produzida ainda não confirmada; usando a Ordem de Produção como referência."
    );
  }

  // Quantidades de corte / cancelamento
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
  } else if (
    input.nomusIsCut === true &&
    fulfillment.classification !== "FULFILLED_WITH_CUT"
  ) {
    pushInconsistency(
      inconsistencies,
      "CUT_WITHOUT_OFFICIAL_STATUS",
      "Flag de corte sem status oficial FULFILLED_WITH_CUT."
    );
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
      "NF-e válida sem data de envio registrada; considerando o faturamento como envio."
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
      "Item desatualizado presente no pedido."
    );
  }

  // Excesso = cobertura acima do alvo (cap de progresso em 100%, excesso vira inconsistência).
  if (shipTargetQuantity.gt(0)) {
    if (productionOrderQuantity.gt(shipTargetQuantity)) {
      pushInconsistency(
        inconsistencies,
        "EXCESS_COVERAGE",
        "Quantidade da Ordem de Produção é maior que a quantidade ainda devida do item."
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
  const isPendingRelease =
    fulfillment.evidence.statusNormalized === "PENDING" ||
    (fulfillment.classification === "NOT_FULFILLED" &&
      fulfillment.evidence.statusNormalized === "PENDING");

  if (isCanceled) {
    currentStage = "CANCELED";
    stageReason = "Item cancelado — sem pendência operacional.";
  } else if (isStale) {
    currentStage = "CANCELED";
    stageReason = "Item desatualizado no Nomus — fora do fluxo ativo.";
  } else if (
    fulfillment.classification === "UNKNOWN" &&
    fulfillment.evidence.statusNormalized !== "RELEASED" &&
    fulfillment.evidence.statusNormalized !== "PARTIAL" &&
    fulfillment.evidence.statusNormalized !== "FULFILLED" &&
    fulfillment.evidence.statusNormalized !== "FULFILLED_WITH_CUT"
  ) {
    currentStage = "WAITING_RELEASE";
    stageReason =
      "Situação do item ainda não está clara — mantém aguardando liberação comercial.";
  } else if (isPendingRelease) {
    currentStage = "WAITING_RELEASE";
    stageReason = "Item aguardando liberação comercial.";
  } else {
    // Liberado ou além — evidência terminal de envio/conclusão prevalece
    // sobre ausência histórica de OP (regressão PD 02596 / OP-03).
    // OP-06: WAITING_PRODUCTION_ORDER só sobre remainingFulfillment > 0.
    const needsProduction = requiresProduction === true;
    const skipProduction =
      requiresProduction === false || requiresProduction === null;

    const postProductionStage = resolvePostProductionStage({
      shipTargetQuantity,
      documentedQuantity,
      shippedQuantity,
      fulfillmentClassification: fulfillment.classification,
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
        "Atendido pelo estoque (sem Ordem de Produção)."
      );
    }

    if (postProductionStage === "SHIPPED_COMPLETED") {
      currentStage = "SHIPPED_COMPLETED";
      stageReason = stageReasonFor(currentStage, {
        usedProductionProxy:
          needsProduction &&
          (producedQuantity == null ||
            productionOrderQuantity.lt(activeObligationQuantity)),
        completedWithoutProductionOrder:
          needsProduction && productionOrderQuantity.lt(activeObligationQuantity),
        fulfilledWithoutProduction: fulfilledWithoutProductionFlag,
      });
    } else if (needsProduction && productionCoverageTarget.gt(0)) {
      if (productionOrderQuantity.lt(productionCoverageTarget)) {
        currentStage = "WAITING_PRODUCTION_ORDER";
        stageReason = productionOrderQuantity.lte(0)
          ? "Ainda falta produzir e não há Ordem de Produção válida vinculada."
          : "A Ordem de Produção parcial ainda não cobre o que falta produzir (não é ausência total de OP).";
      } else if (
        producedQuantity != null &&
        producedQuantity.lt(productionCoverageTarget)
      ) {
        currentStage = "IN_PRODUCTION";
        stageReason =
          "A Ordem de Produção já cobre o planejamento, mas a quantidade produzida ainda é insuficiente.";
      } else {
        currentStage = postProductionStage;
        stageReason = stageReasonFor(currentStage, {
          usedProductionProxy: producedQuantity == null && hasOfficialOpLink,
        });
      }
    } else {
      if (skipProduction && requiresProduction === null) {
        // UNKNOWN produção: não forçar coluna OP
      }
      currentStage = postProductionStage;
      stageReason = stageReasonFor(currentStage, {
        skippedProduction: skipProduction,
        fulfilledWithoutProduction: fulfilledWithoutProductionFlag,
      });
    }

    // UNKNOWN nunca conclui como enviado
    if (
      fulfillment.classification === "UNKNOWN" &&
      currentStage === "SHIPPED_COMPLETED"
    ) {
      currentStage = "WAITING_NFE";
      stageReason =
        "Situação do item ainda não está clara — mantém aguardando NF-e.";
    }
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
  fulfillmentClassification: string;
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

function stageReasonFor(
  stage: SalesOrderItemFlowStage,
  flags: {
    usedProductionProxy?: boolean;
    skippedProduction?: boolean;
    completedWithoutProductionOrder?: boolean;
    fulfilledWithoutProduction?: boolean;
  }
): string {
  switch (stage) {
    case "WAITING_OUTPUT_DOCUMENT":
      if (flags.fulfilledWithoutProduction) {
        return "Atendido pelo estoque (sem Ordem de Produção); falta Documento de Saída.";
      }
      return flags.skippedProduction
        ? "Produção não necessária ou ainda indefinida; falta Documento de Saída suficiente."
        : "Produção coberta; falta Documento de Saída.";
    case "WAITING_NFE":
      if (flags.fulfilledWithoutProduction) {
        return "Atendido pelo estoque (sem Ordem de Produção); documento presente, falta NF-e válida.";
      }
      return "Documento de Saída presente; falta NF-e válida.";
    case "SHIPPED_COMPLETED":
      if (flags.completedWithoutProductionOrder || flags.fulfilledWithoutProduction) {
        return "Pedido já faturado/enviado com NF-e válida. Não havia Ordem de Produção — foi atendido pelo estoque (não reabre produção).";
      }
      return flags.usedProductionProxy
        ? "NF-e válida cobre o pedido; a Ordem de Produção foi usada como referência de produção."
        : "Pedido coberto por NF-e válida (enviado / concluído).";
    default:
      return "Etapa do fluxo ainda em análise.";
  }
}

/**
 * Adapta um item do pack OP-49 para o motor OP-50.
 */
export function resolveSalesOrderItemFlowFromEvidence(
  pack: SalesOrderFlowEvidencePack,
  salesOrderItemId: string,
  options?: { referenceDate?: Date | string | null }
): ResolveSalesOrderItemFlowResult | null {
  const item = pack.items.find((i) => i.id === salesOrderItemId);
  if (!item) return null;

  const links = pack.productionLinks.filter(
    (l) =>
      l.salesOrderItemId === item.id ||
      (item.nomusItemExternalId != null &&
        l.externalSalesOrderItemId === item.nomusItemExternalId)
  );

  const allocations = pack.allocations.filter(
    (a) => a.salesOrderItemId === item.id
  );

  const canceledDocIds = new Set(
    pack.stockDocuments
      .filter((d) => {
        if (d.isCancelled === true) return true;
        const raw = (d.statusRaw ?? "").toLowerCase();
        return raw.includes("cancel");
      })
      .map((d) => d.externalId)
  );

  const documentAllocations: SalesOrderItemFlowDocumentAllocationInput[] =
    allocations
      .filter((a) => a.stockDocumentExternalId != null)
      .map((a) => ({
        allocationKey: a.auditKey,
        quantity: a.quantityUsedForOrder ?? 0,
        isCanceled: canceledDocIds.has(a.stockDocumentExternalId!),
        isValid: !canceledDocIds.has(a.stockDocumentExternalId!),
      }));

  const nfeById = new Map(pack.nfes.map((n) => [n.externalId, n]));
  const nfeAllocations: SalesOrderItemFlowNfeAllocationInput[] = [];
  const seenNfe = new Set<number>();
  for (const a of allocations) {
    if (a.nfeExternalId == null || seenNfe.has(a.nfeExternalId)) continue;
    const nfe = nfeById.get(a.nfeExternalId);
    const qtyRaw = a.quantityUsedForOrder;
    const qtyPositive =
      qtyRaw != null && Number(qtyRaw) > 0;
    const canceled = nfe?.isCanceled === true;
    // Qty 0/nula em NF não-cancelada: não “envenena” seenNfe — deixa o
    // fallback validNfes cobrir com a qty do item (PD 02586: 7142 autorizada).
    if (!qtyPositive && !canceled) continue;

    seenNfe.add(a.nfeExternalId);
    const hasDocument = pack.stockDocuments.some(
      (d) => d.idNfe === a.nfeExternalId && d.isCancelled !== true
    );
    nfeAllocations.push({
      nfeExternalId: a.nfeExternalId,
      quantity: qtyRaw,
      isCanceled: canceled,
      isValidForBilling: nfe?.isValidForBilling !== false && !canceled,
      hasDocument,
      hasShipDate: false,
    });
  }
  for (const nfe of pack.validNfes) {
    if (seenNfe.has(nfe.externalId)) continue;
    const linkedToOrder =
      nfe.linkedSalesOrderIds.includes(pack.orderId) ||
      pack.stockDocuments.some(
        (d) => d.idNfe === nfe.externalId && d.isCancelled !== true
      );
    if (!linkedToOrder) continue;
    seenNfe.add(nfe.externalId);
    nfeAllocations.push({
      nfeExternalId: nfe.externalId,
      quantity: item.quantity,
      isCanceled: false,
      isValidForBilling: true,
      hasDocument: pack.stockDocuments.some(
        (d) => d.idNfe === nfe.externalId && d.isCancelled !== true
      ),
      hasShipDate: false,
    });
  }

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
    productionOrderLinks: links.map((l) => ({
      linkedQuantity: l.linkedQuantity,
      isCurrent: l.isCurrent,
    })),
    documentAllocations,
    nfeAllocations,
    promisedDeliveryAt: pack.order.expectedDeliveryDate,
    referenceDate: options?.referenceDate ?? pack.meta.loadedAt,
    productType: item.productType as "PRODUCT" | "COMPONENT" | "MATERIAL" | null,
    costingMode: item.productCostingMode,
    hasProductRouting: item.hasProductRouting,
    hasProductBom: item.hasProductBom,
  });
}
