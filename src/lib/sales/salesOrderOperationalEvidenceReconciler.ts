/**
 * KAN-LINK-06 — Reconciliação operacional Pedido → OP → DS → NF-e → envio.
 *
 * Puro (sem I/O). Unifica evidências sem exigir cadeia artificial.
 * Evidência posterior prevalece sobre falta de elo intermediário.
 * DS e NF pareados não contam duas vezes na cobertura de cadeia.
 */

import {
  assessOperationalCoverageLevel,
  canOperationalLinkAdvanceKanban,
  type SalesOrderOperationalCoverageLevel,
  type SalesOrderOperationalDocumentCoverage,
  type SalesOrderOperationalEvidenceGraph,
  type SalesOrderOperationalItemCoverageStatus,
  type SalesOrderOperationalItemEvidence,
  type SalesOrderOperationalItemLinkStatus,
  type SalesOrderOperationalItemReconciliation,
  type SalesOrderOperationalNfeCoverage,
  type SalesOrderOperationalOrderReconciliation,
  type SalesOrderOperationalProductionCoverage,
  type SalesOrderOperationalTimelineEvent,
  type SalesOrderOperationalUnitConversion,
} from "./salesOrderOperationalEvidenceContract.js";

const EPS = 1e-9;

export type OperationalEvidenceUnitHint = {
  officialUnitCode: string | null;
  evidence?: Array<{
    entityType: "OP" | "DS" | "NFE";
    entityId: string | null;
    unitCode: string | null;
    quantity: number;
    /** Fator comprovado: qtyOficial = qtyEvidencia * factor. */
    conversionFactorToOfficial?: number | null;
  }>;
};

export type ReconcileSalesOrderOperationalEvidenceOptions = {
  /** Exigência de produção por item (default: true se residual > 0). */
  requiresProductionByItem?: Record<string, boolean | null>;
  /** Unidade oficial / conversões comprovadas por item. */
  unitHintsByItem?: Record<string, OperationalEvidenceUnitHint>;
};

function sumQty(values: readonly number[]): number {
  return values.reduce((s, q) => s + (Number.isFinite(q) ? Math.max(0, q) : 0), 0);
}

function normalizeUnitCode(value: string | null | undefined): string | null {
  if (value == null) return null;
  const t = value.trim().toUpperCase();
  return t.length > 0 ? t : null;
}

/**
 * Normaliza quantidade para a unidade oficial do item.
 * Sem fator comprovado e unidades distintas → inconsistência (não inventa).
 */
export function normalizeQuantityToOfficialUnit(input: {
  quantity: number;
  evidenceUnitCode: string | null | undefined;
  officialUnitCode: string | null | undefined;
  conversionFactorToOfficial?: number | null;
}): {
  quantity: number | null;
  status: SalesOrderOperationalUnitConversion["status"];
  detail: string | null;
} {
  const qty = Number.isFinite(input.quantity) ? input.quantity : null;
  if (qty == null) {
    return { quantity: null, status: "UNKNOWN", detail: "Quantidade inválida." };
  }
  const official = normalizeUnitCode(input.officialUnitCode);
  const evidence = normalizeUnitCode(input.evidenceUnitCode);
  const factor = input.conversionFactorToOfficial;

  if (official == null && evidence == null) {
    return { quantity: qty, status: "UNKNOWN", detail: null };
  }
  if (official != null && (evidence == null || evidence === official)) {
    return { quantity: qty, status: "NATIVE", detail: null };
  }
  if (
    official != null &&
    evidence != null &&
    evidence !== official &&
    factor != null &&
    Number.isFinite(factor) &&
    factor > 0
  ) {
    return {
      quantity: qty * factor,
      status: "CONVERTED",
      detail: `${evidence}→${official} × ${factor}`,
    };
  }
  if (official != null && evidence != null && evidence !== official) {
    return {
      quantity: null,
      status: "INCONSISTENT",
      detail: `Unidade ${evidence} ≠ oficial ${official} sem fator comprovado.`,
    };
  }
  return { quantity: qty, status: "UNKNOWN", detail: null };
}

/**
 * DS∪NF sem dupla contagem: pares DS↔idNfe contam max(doc, nfe) uma vez;
 * órfãos entram integralmente.
 */
export function computeChainCoveredQuantityWithoutDoubleCount(input: {
  documents: readonly SalesOrderOperationalDocumentCoverage[];
  nfes: readonly SalesOrderOperationalNfeCoverage[];
}): {
  chainCoveredQuantity: number;
  pairedQuantity: number;
  orphanDocumentQuantity: number;
  orphanNfeQuantity: number;
  wouldDoubleCountIfSummed: number;
} {
  const advancingDocs = input.documents.filter((d) => d.advancesKanban);
  const advancingNfes = input.nfes.filter((n) => n.advancesKanban);

  const documentedSum = sumQty(advancingDocs.map((d) => d.quantity));
  const invoicedSum = sumQty(advancingNfes.map((n) => n.quantity));

  const docsByNfe = new Map<number, number>();
  let orphanDocumentQuantity = 0;
  for (const d of advancingDocs) {
    if (d.nfeExternalId != null) {
      docsByNfe.set(
        d.nfeExternalId,
        (docsByNfe.get(d.nfeExternalId) ?? 0) + d.quantity
      );
    } else {
      orphanDocumentQuantity += d.quantity;
    }
  }

  const nfeIds = new Set(
    advancingNfes
      .map((n) => n.nfeExternalId)
      .filter((id): id is number => id != null)
  );

  let pairedQuantity = 0;
  let orphanNfeQuantity = 0;
  const consumedNfe = new Set<number>();

  for (const n of advancingNfes) {
    if (n.nfeExternalId == null) {
      orphanNfeQuantity += n.quantity;
      continue;
    }
    const docQty = docsByNfe.get(n.nfeExternalId) ?? 0;
    if (docQty > EPS) {
      pairedQuantity += Math.max(docQty, n.quantity);
      consumedNfe.add(n.nfeExternalId);
    } else {
      orphanNfeQuantity += n.quantity;
    }
  }

  // DS apontando NF que não avança (ou ausente no item) → órfão documental.
  for (const [nfeId, docQty] of docsByNfe) {
    if (!consumedNfe.has(nfeId) && !nfeIds.has(nfeId)) {
      orphanDocumentQuantity += docQty;
    } else if (!consumedNfe.has(nfeId) && nfeIds.has(nfeId)) {
      // NF presente mas qty 0 — já coberto; se doc ficou sem consumo, conta doc.
      pairedQuantity += docQty;
    }
  }

  const chainCoveredQuantity =
    pairedQuantity + orphanDocumentQuantity + orphanNfeQuantity;
  const naiveSum = documentedSum + invoicedSum;

  return {
    chainCoveredQuantity,
    pairedQuantity,
    orphanDocumentQuantity,
    orphanNfeQuantity,
    wouldDoubleCountIfSummed: Math.max(0, naiveSum - chainCoveredQuantity),
  };
}

function resolveUnitConversion(
  hint: OperationalEvidenceUnitHint | undefined
): SalesOrderOperationalUnitConversion {
  if (!hint) {
    return { officialUnitCode: null, status: "UNKNOWN", detail: null };
  }
  const official = normalizeUnitCode(hint.officialUnitCode);
  const evidence = hint.evidence ?? [];
  if (evidence.length === 0) {
    return {
      officialUnitCode: official,
      status: official ? "NATIVE" : "UNKNOWN",
      detail: null,
    };
  }

  let anyConverted = false;
  let anyInconsistent = false;
  const details: string[] = [];

  for (const row of evidence) {
    const norm = normalizeQuantityToOfficialUnit({
      quantity: row.quantity,
      evidenceUnitCode: row.unitCode,
      officialUnitCode: official,
      conversionFactorToOfficial: row.conversionFactorToOfficial,
    });
    if (norm.status === "CONVERTED") anyConverted = true;
    if (norm.status === "INCONSISTENT") {
      anyInconsistent = true;
      if (norm.detail) details.push(norm.detail);
    }
  }

  if (anyInconsistent) {
    return {
      officialUnitCode: official,
      status: "INCONSISTENT",
      detail: details[0] ?? "Conversão de unidade impossível sem fator comprovado.",
    };
  }
  if (anyConverted) {
    return {
      officialUnitCode: official,
      status: "CONVERTED",
      detail: details[0] ?? "Quantidades convertidas para unidade oficial.",
    };
  }
  return {
    officialUnitCode: official,
    status: official ? "NATIVE" : "UNKNOWN",
    detail: null,
  };
}

function resolveLinkStatus(
  item: Omit<SalesOrderOperationalItemEvidence, "reconciliation">,
  remainingFulfillment: number,
  requiresProduction: boolean
): SalesOrderOperationalItemLinkStatus {
  const links = item.links;
  if (links.some((l) => l.sourceType === "AMBIGUOUS")) return "AMBIGUOUS";

  const advancing =
    item.production.some((p) => p.advancesKanban) ||
    item.documents.some((d) => d.advancesKanban) ||
    item.nfes.some((n) => n.advancesKanban);

  const orderLevelOnly =
    !advancing &&
    links.some(
      (l) =>
        l.salesOrderItemId == null &&
        canOperationalLinkAdvanceKanban(l.sourceType)
    );

  if (orderLevelOnly) return "ORDER_LEVEL_ONLY";

  if (
    !requiresProduction &&
    remainingFulfillment <= EPS &&
    !advancing &&
    !links.some((l) => l.sourceType === "UNRESOLVED")
  ) {
    return "NOT_REQUIRED";
  }

  if (!advancing) {
    if (links.some((l) => l.sourceType === "UNRESOLVED") || links.length === 0) {
      return remainingFulfillment <= EPS ? "NOT_REQUIRED" : "UNRESOLVED";
    }
    return "UNRESOLVED";
  }

  const hasPartialStage =
    (item.coverage.documentedQuantity > EPS &&
      item.coverage.invoicedQuantity + EPS < item.obligation.activeObligationQuantity) ||
    (item.coverage.productionOrderQuantity > EPS &&
      item.coverage.productionOrderQuantity + EPS < remainingFulfillment &&
      remainingFulfillment > EPS);

  return hasPartialStage ? "PARTIAL" : "RESOLVED";
}

function resolveCoverageStatus(input: {
  activeObligation: number;
  remainingFulfillment: number;
  requiresProduction: boolean;
  productionOrderQuantity: number;
  documentedQuantity: number;
  invoicedQuantity: number;
  shippedQuantity: number;
  productionCoverage: SalesOrderOperationalCoverageLevel;
  documentedCoverage: SalesOrderOperationalCoverageLevel;
  invoicedCoverage: SalesOrderOperationalCoverageLevel;
  shippedCoverage: SalesOrderOperationalCoverageLevel;
  unitInconsistent: boolean;
  canceled: boolean;
}): SalesOrderOperationalItemCoverageStatus {
  if (input.canceled) return "CANCELED";
  if (input.unitInconsistent) return "INCONSISTENT";

  // Evidência posterior prevalece — inclusive parcial (não exige cadeia completa).
  if (input.shippedQuantity > EPS || input.invoicedQuantity > EPS) {
    if (
      input.shippedCoverage === "SUFFICIENT" ||
      input.shippedCoverage === "EXCESS" ||
      input.invoicedCoverage === "SUFFICIENT" ||
      input.invoicedCoverage === "EXCESS"
    ) {
      return "SHIPPED";
    }
    return "INVOICED";
  }
  if (input.documentedQuantity > EPS) {
    return "DOCUMENTED";
  }

  if (input.activeObligation <= EPS) return "CANCELED";

  if (input.remainingFulfillment <= EPS) {
    return "FULFILLED_WITHOUT_PRODUCTION";
  }

  if (input.requiresProduction && input.productionOrderQuantity <= EPS) {
    return "AWAITING_PRODUCTION";
  }

  if (
    input.productionOrderQuantity > EPS ||
    input.productionCoverage === "NOT_REQUIRED"
  ) {
    return "IN_PRODUCTION";
  }

  return "OPEN";
}

function buildTimeline(
  item: Omit<SalesOrderOperationalItemEvidence, "reconciliation">
): SalesOrderOperationalTimelineEvent[] {
  const events: SalesOrderOperationalTimelineEvent[] = [];

  if (item.obligation.cutQuantity > EPS) {
    events.push({
      at: null,
      kind: "CUT",
      label: "Corte oficial do item",
      quantity: item.obligation.cutQuantity,
      operational: true,
      sourceType: null,
      entityId: item.salesOrderItemId,
      entityExternalId: null,
    });
  }
  if (item.obligation.canceledQuantity > EPS) {
    events.push({
      at: null,
      kind: "CANCEL",
      label: "Cancelamento oficial do item",
      quantity: item.obligation.canceledQuantity,
      operational: false,
      sourceType: null,
      entityId: item.salesOrderItemId,
      entityExternalId: null,
    });
  }

  for (const p of item.production) {
    events.push({
      at: p.link.sourceUpdatedAt ?? p.link.syncedAt,
      kind: "PRODUCTION_ORDER",
      label: p.advancesKanban
        ? "OP vinculada (operacional)"
        : "OP histórica / não operacional",
      quantity: p.linkedQuantity,
      operational: p.advancesKanban,
      sourceType: p.link.sourceType,
      entityId: p.productionOrderId,
      entityExternalId: p.productionOrderExternalId,
    });
  }

  for (const d of item.documents) {
    const isReturn = d.validity === "RETURN";
    const isCancel = d.validity === "CANCELLED";
    events.push({
      at: d.link.sourceUpdatedAt ?? d.link.syncedAt,
      kind: isReturn ? "RETURN" : isCancel ? "CANCEL" : "OUTPUT_DOCUMENT",
      label: isReturn
        ? "Documento de devolução (histórico)"
        : isCancel
          ? "Documento cancelado/estornado (histórico)"
          : d.advancesKanban
            ? "Documento de saída válido"
            : `Documento ${d.validity} (não operacional)`,
      quantity: d.quantity,
      operational: d.advancesKanban,
      sourceType: d.link.sourceType,
      entityId: d.outputDocumentId,
      entityExternalId: d.outputDocumentExternalId,
    });
  }

  for (const n of item.nfes) {
    const isCancel =
      n.validity === "CANCELLED" ||
      n.validity === "VOIDED" ||
      n.validity === "REJECTED";
    events.push({
      at: n.link.sourceUpdatedAt ?? n.link.syncedAt,
      kind: isCancel ? "CANCEL" : "NFE",
      label: isCancel
        ? `NF-e ${n.validity} (histórico)`
        : n.advancesKanban
          ? "NF-e autorizada"
          : `NF-e ${n.validity} (não operacional)`,
      quantity: n.quantity,
      operational: n.advancesKanban,
      sourceType: n.link.sourceType,
      entityId: n.nfeId,
      entityExternalId: n.nfeExternalId,
    });
  }

  if (item.shipment.advancesKanban && item.shipment.quantity > EPS) {
    events.push({
      at: null,
      kind: "SHIPMENT",
      label:
        item.shipment.evidence === "EXPLICIT_SHIP_DATE"
          ? "Envio com data explícita"
          : "Envio por proxy de NF autorizada",
      quantity: item.shipment.quantity,
      operational: true,
      sourceType: null,
      entityId: item.salesOrderItemId,
      entityExternalId: null,
    });
  }

  return events.sort((a, b) => {
    if (a.at == null && b.at == null) return 0;
    if (a.at == null) return 1;
    if (b.at == null) return -1;
    return a.at.localeCompare(b.at);
  });
}

function buildSourceSummary(
  item: Omit<SalesOrderOperationalItemEvidence, "reconciliation">
): string[] {
  const parts: string[] = [];
  const opAdv = item.production.filter((p) => p.advancesKanban);
  const docAdv = item.documents.filter((d) => d.advancesKanban);
  const nfeAdv = item.nfes.filter((n) => n.advancesKanban);

  if (opAdv.length > 0) {
    parts.push(
      `OP×${opAdv.length} (${sumQty(opAdv.map((p) => p.linkedQuantity))})`
    );
  }
  if (docAdv.length > 0) {
    parts.push(
      `DS×${docAdv.length} (${sumQty(docAdv.map((d) => d.quantity))})`
    );
  }
  if (nfeAdv.length > 0) {
    parts.push(
      `NF×${nfeAdv.length} (${sumQty(nfeAdv.map((n) => n.quantity))})`
    );
  }
  if (item.shipment.advancesKanban) {
    parts.push(`ENVIO(${item.shipment.evidence})`);
  }
  for (const link of item.links) {
    if (
      link.sourceType === "AMBIGUOUS" ||
      link.sourceType === "UNRESOLVED" ||
      link.sourceType === "DESCRIPTION_HINT" ||
      link.sourceType === "PRODUCTION_LABEL_REFERENCE"
    ) {
      parts.push(`link:${link.sourceType}`);
    }
  }
  if (parts.length === 0) parts.push("sem-evidencia-operacional");
  return parts;
}

/**
 * Reconcilia um item do grafo de evidências.
 */
export function reconcileSalesOrderItemOperationalEvidence(
  item: Omit<SalesOrderOperationalItemEvidence, "reconciliation">,
  options?: {
    requiresProduction?: boolean | null;
    unitHint?: OperationalEvidenceUnitHint;
  }
): SalesOrderOperationalItemReconciliation {
  const ordered = Math.max(0, item.obligation.orderedQuantity);
  const cut = Math.max(0, item.obligation.cutQuantity);
  const canceledQty = Math.max(0, item.obligation.canceledQuantity);
  const activeObligation = Math.max(
    0,
    item.obligation.activeObligationQuantity > 0
      ? item.obligation.activeObligationQuantity
      : ordered - cut - canceledQty
  );
  const fulfilledQuantity = Math.max(0, item.obligation.fulfilledQuantity ?? 0);
  const remainingFulfillment = Math.max(
    0,
    activeObligation - fulfilledQuantity
  );

  const requiresProduction =
    options?.requiresProduction === false
      ? false
      : options?.requiresProduction === true
        ? true
        : remainingFulfillment > EPS;

  const unitConversion = resolveUnitConversion(options?.unitHint);
  const unitBlocks =
    unitConversion.status === "INCONSISTENT" &&
    (options?.unitHint?.evidence?.length ?? 0) > 0;

  // Quantidades operacionais: se unidade inconsistente, não conclui cobertura
  // (evidência permanece na timeline / unresolved).
  const productionOrderQuantity = unitBlocks
    ? 0
    : Math.max(0, item.coverage.productionOrderQuantity);
  const documentedQuantity = unitBlocks
    ? 0
    : Math.max(0, item.coverage.documentedQuantity);
  const invoicedQuantity = unitBlocks
    ? 0
    : Math.max(0, item.coverage.invoicedQuantity);
  const shippedQuantity = unitBlocks
    ? 0
    : Math.max(0, item.coverage.shippedQuantity);

  // OP cobre residual; documentação/faturamento/envio cobrem obrigação ativa.
  const productionCoverage = assessOperationalCoverageLevel({
    coveredQuantity: productionOrderQuantity,
    targetQuantity: remainingFulfillment,
    required: requiresProduction && remainingFulfillment > EPS,
  });
  const documentedCoverage = assessOperationalCoverageLevel({
    coveredQuantity: documentedQuantity,
    targetQuantity: activeObligation,
    required: activeObligation > EPS,
  });
  const invoicedCoverage = assessOperationalCoverageLevel({
    coveredQuantity: invoicedQuantity,
    targetQuantity: activeObligation,
    required: activeObligation > EPS,
  });
  const shippedCoverage = assessOperationalCoverageLevel({
    coveredQuantity: shippedQuantity,
    targetQuantity: activeObligation,
    required: activeObligation > EPS,
  });

  const chain = computeChainCoveredQuantityWithoutDoubleCount({
    documents: unitBlocks ? [] : item.documents,
    nfes: unitBlocks ? [] : item.nfes,
  });

  const warnings: string[] = [...item.shipment.warnings];
  const unresolvedEvidence: Array<{ code: string; detail: string }> = [
    ...item.inconsistencies,
  ];

  if (chain.wouldDoubleCountIfSummed > EPS) {
    warnings.push(
      `DS+NF pareados evitam dupla contagem de ${chain.wouldDoubleCountIfSummed} (cadeia=${chain.chainCoveredQuantity}).`
    );
  }

  if (documentedQuantity > EPS && productionOrderQuantity <= EPS) {
    warnings.push(
      "Documento/NF não prova OP; ausência de OP não invalida documentação."
    );
  }

  if (
    (invoicedCoverage === "SUFFICIENT" || invoicedCoverage === "EXCESS") &&
    productionCoverage === "NONE" &&
    requiresProduction
  ) {
    warnings.push(
      "NF/documentação posterior prevalece sobre ausência de OP intermediária."
    );
  }

  if (productionCoverage === "EXCESS") {
    unresolvedEvidence.push({
      code: "EXCESS_PRODUCTION_COVERAGE",
      detail: "Cobertura de OP excede o residual do item.",
    });
  }
  if (documentedCoverage === "EXCESS") {
    unresolvedEvidence.push({
      code: "EXCESS_DOCUMENT_COVERAGE",
      detail: "Cobertura documental excede a obrigação ativa.",
    });
  }
  if (invoicedCoverage === "EXCESS") {
    unresolvedEvidence.push({
      code: "EXCESS_INVOICE_COVERAGE",
      detail: "Cobertura fiscal excede a obrigação ativa.",
    });
  }

  if (unitConversion.status === "INCONSISTENT") {
    unresolvedEvidence.push({
      code: "UNIT_CONVERSION_INCONSISTENT",
      detail:
        unitConversion.detail ??
        "Conversão de unidade impossível; evidência visível sem conclusão indevida.",
    });
  }

  for (const d of item.documents) {
    if (!d.advancesKanban && d.quantity > EPS) {
      unresolvedEvidence.push({
        code: "NON_OPERATIONAL_DOCUMENT",
        detail: `DS ${d.outputDocumentExternalId ?? "?"} ${d.validity} preservado como histórico.`,
      });
    }
  }
  for (const n of item.nfes) {
    if (!n.advancesKanban && n.quantity > EPS) {
      unresolvedEvidence.push({
        code: "NON_OPERATIONAL_NFE",
        detail: `NF ${n.nfeExternalId ?? "?"} ${n.validity} preservada como histórico.`,
      });
    }
  }

  // Redução de obrigação após faturamento (corte/cancelamento).
  if (
    invoicedQuantity > EPS &&
    activeObligation + EPS < invoicedQuantity &&
    (cut > EPS || canceledQty > EPS)
  ) {
    warnings.push(
      "Obrigação ativa reduzida após faturamento (corte/cancelamento); excesso classificado, evidência fiscal preservada."
    );
  }

  const canceledItem =
    activeObligation <= EPS &&
    (canceledQty + EPS >= ordered || ordered <= EPS);

  const linkStatus = resolveLinkStatus(
    item,
    remainingFulfillment,
    requiresProduction
  );
  const coverageStatus = resolveCoverageStatus({
    activeObligation,
    remainingFulfillment,
    requiresProduction,
    productionOrderQuantity,
    documentedQuantity,
    invoicedQuantity,
    shippedQuantity,
    productionCoverage,
    documentedCoverage,
    invoicedCoverage,
    shippedCoverage,
    unitInconsistent: unitConversion.status === "INCONSISTENT",
    canceled: canceledItem,
  });

  return {
    salesOrderItemId: item.salesOrderItemId,
    linkStatus,
    coverageStatus,
    activeObligation,
    fulfilledQuantity,
    remainingFulfillment,
    productionOrderQuantity,
    productionCoverage,
    documentedQuantity,
    documentedCoverage,
    invoicedQuantity,
    invoicedCoverage,
    shippedQuantity,
    shippedCoverage,
    chainCoveredQuantity: chain.chainCoveredQuantity,
    sourceSummary: buildSourceSummary(item),
    warnings,
    unresolvedEvidence,
    operationalEvidenceTimeline: buildTimeline(item),
    unitConversion,
  };
}

/**
 * Reconcilia o grafo completo do pedido (por item).
 */
export function reconcileSalesOrderOperationalEvidence(
  graph: Omit<SalesOrderOperationalEvidenceGraph, "reconciliation"> & {
    items: Array<Omit<SalesOrderOperationalItemEvidence, "reconciliation">>;
    reconciliation?: SalesOrderOperationalOrderReconciliation;
  },
  options?: ReconcileSalesOrderOperationalEvidenceOptions
): SalesOrderOperationalOrderReconciliation {
  const items = graph.items.map((item) =>
    reconcileSalesOrderItemOperationalEvidence(item, {
      requiresProduction:
        options?.requiresProductionByItem?.[item.salesOrderItemId] ?? null,
      unitHint: options?.unitHintsByItem?.[item.salesOrderItemId],
    })
  );

  const warnings = [...graph.warnings];
  for (const item of items) {
    for (const w of item.warnings) {
      warnings.push(`[item:${item.salesOrderItemId}] ${w}`);
    }
  }

  // DS multi-pedido: arestas ambíguas no nível do pedido.
  for (const link of graph.orderLinks) {
    if (link.sourceType === "AMBIGUOUS") {
      warnings.push(
        `Vínculo ambíguo no pedido: ${link.reason} (DS/NF pode apontar a mais de um PV).`
      );
    }
  }

  return {
    contractVersion: "sales-order-operational-reconciliation/v1",
    salesOrderId: graph.salesOrderId,
    orderCode: graph.orderCode,
    externalSalesOrderId: graph.externalSalesOrderId,
    items,
    warnings,
  };
}

/** Anexa reconciliação a um grafo já montado (imutável). */
export function attachOperationalReconciliation(
  graph: Omit<SalesOrderOperationalEvidenceGraph, "reconciliation"> & {
    items: Array<Omit<SalesOrderOperationalItemEvidence, "reconciliation">>;
  },
  options?: ReconcileSalesOrderOperationalEvidenceOptions
): SalesOrderOperationalEvidenceGraph {
  const reconciliation = reconcileSalesOrderOperationalEvidence(graph, options);
  const byId = new Map(
    reconciliation.items.map((r) => [r.salesOrderItemId, r] as const)
  );
  return {
    ...graph,
    items: graph.items.map((item) => ({
      ...item,
      reconciliation: byId.get(item.salesOrderItemId)!,
    })),
    reconciliation,
  };
}

export type {
  SalesOrderOperationalItemReconciliation,
  SalesOrderOperationalOrderReconciliation,
  SalesOrderOperationalCoverageLevel,
  SalesOrderOperationalItemLinkStatus,
  SalesOrderOperationalItemCoverageStatus,
  SalesOrderOperationalTimelineEvent,
  SalesOrderOperationalProductionCoverage,
};
