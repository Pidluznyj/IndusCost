/**
 * KAN-LINK-08 — Projeção read-only do grafo canônico para o Kanban.
 * Puro: sem I/O. Frontend só renderiza estes campos (não recalcula estágio).
 */

import type { SalesOrderFlowEvidencePack } from "./salesOrderFlowEvidence.js";
import type { SalesOrderOperationalEvidenceGraph } from "./salesOrderOperationalEvidenceContract.js";
import { getSalesOrderOperationalEvidenceGraphFromPack } from "./salesOrderOperationalEvidenceFromPack.js";
import { SALES_ORDER_FLOW_COMPUTATION_VERSION } from "./salesOrderFlowComputationVersion.js";
import type { SalesOrderFlowBadge } from "./salesOrderFlowEngine.js";
import {
  SALES_ORDER_FLOW_DIAGNOSTIC_BADGE_LABELS,
  SALES_ORDER_FLOW_DIAGNOSTIC_BADGES,
  type SalesOrderFlowDiagnosticBadge,
  type SalesOrderFlowOperationalDiagnosticEvidenceLine,
  type SalesOrderFlowOperationalDiagnosticItem,
  type SalesOrderFlowOperationalDiagnostics,
  type SalesOrderFlowOperationalDiagnosticTotals,
} from "./salesOrderFlowOperationalDiagnostics.shared.js";

export {
  SALES_ORDER_FLOW_DIAGNOSTIC_BADGE_LABELS,
  SALES_ORDER_FLOW_DIAGNOSTIC_BADGES,
  type SalesOrderFlowDiagnosticBadge,
  type SalesOrderFlowOperationalDiagnosticEvidenceLine,
  type SalesOrderFlowOperationalDiagnosticItem,
  type SalesOrderFlowOperationalDiagnostics,
  type SalesOrderFlowOperationalDiagnosticTotals,
};

function sourceTypeLabel(sourceType: string | null | undefined): string | null {
  switch (sourceType) {
    case "DIRECT_EXTERNAL_ID":
      return "ID externo oficial";
    case "DIRECT_ORDER_REFERENCE":
      return "Referência oficial do Pedido de Venda";
    case "DIRECT_ORDER_ITEM_REFERENCE":
      return "Referência oficial do Pedido de Venda no item do documento";
    case "SALES_ORDER_NFE_LINK":
      return "Vínculo persistido Pedido ↔ NF-e";
    case "OUTPUT_DOCUMENT_REFERENCE":
      return "Cadeia Documento de Saída → Pedido";
    case "NFE_REFERENCE":
      return "Cadeia NF-e → Pedido";
    case "PRODUCTION_ORDER_REFERENCE":
      return "Referência oficial da Ordem de Produção";
    case "PRODUCTION_LABEL_REFERENCE":
      return "Etiqueta/identificação da OP";
    case "DESCRIPTION_HINT":
      return "Hint textual controlado";
    case "AMBIGUOUS":
      return "Vínculo ambíguo";
    case "UNRESOLVED":
      return "Sem vínculo resolvido";
    default:
      return sourceType ?? null;
  }
}

function formatQty(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

/**
 * Deriva badges diagnósticos a partir do grafo (para snapshot/listagem).
 */
export function collectOperationalDiagnosticBadges(
  graph: SalesOrderOperationalEvidenceGraph,
  options?: {
    snapshotComputationVersion?: string | null;
    hasStockDocumentsWithoutCoverage?: boolean;
    hasNfesWithoutItemLink?: boolean;
  }
): SalesOrderFlowDiagnosticBadge[] {
  const badges = new Set<SalesOrderFlowDiagnosticBadge>();
  let anyOp = false;
  let anyOpPartial = false;
  let anyDs = false;
  let anyDsPartial = false;
  let anyNfeAuth = false;
  let anyNfeCancel = false;
  let anyShipComplete = false;
  let anyStockFulfilled = false;

  for (const item of graph.items) {
    const r = item.reconciliation;
    if (r.linkStatus === "AMBIGUOUS") badges.add("AMBIGUOUS_LINK");
    if (r.linkStatus === "UNRESOLVED" && r.remainingFulfillment > 1e-9) {
      badges.add("ITEM_UNRESOLVED");
    }
    if (
      r.productionCoverage === "PARTIAL" ||
      r.documentedCoverage === "PARTIAL" ||
      r.invoicedCoverage === "PARTIAL"
    ) {
      badges.add("PARTIAL_COVERAGE");
    }
    if (
      r.productionCoverage === "EXCESS" ||
      r.documentedCoverage === "EXCESS" ||
      r.invoicedCoverage === "EXCESS"
    ) {
      badges.add("EXCESS_COVERAGE");
    }
    if (r.productionOrderQuantity > 1e-9) anyOp = true;
    if (r.productionCoverage === "PARTIAL") anyOpPartial = true;
    if (r.documentedQuantity > 1e-9) anyDs = true;
    if (r.documentedCoverage === "PARTIAL") anyDsPartial = true;
    if (r.invoicedQuantity > 1e-9) anyNfeAuth = true;
    if (
      r.shippedCoverage === "SUFFICIENT" ||
      r.shippedCoverage === "EXCESS"
    ) {
      anyShipComplete = true;
    }
    if (r.coverageStatus === "FULFILLED_WITHOUT_PRODUCTION") {
      anyStockFulfilled = true;
    }
    if (itemNeedsOpUnlinkedBadge(r)) {
      badges.add("OP_UNLINKED");
    }
    for (const n of item.nfes) {
      if (n.validity === "CANCELLED") anyNfeCancel = true;
    }
  }

  if (anyOp) badges.add("OP_LINKED");
  if (anyOpPartial) badges.add("OP_PARTIAL");
  if (anyDs) badges.add("DS_LINKED");
  if (anyDsPartial) badges.add("DS_PARTIAL");
  if (anyNfeAuth) badges.add("NFE_AUTHORIZED");
  if (anyNfeCancel) badges.add("NFE_CANCELLED");
  if (anyShipComplete) badges.add("SHIPMENT_COMPLETE");
  if (anyStockFulfilled) badges.add("STOCK_FULFILLED");

  if (options?.hasStockDocumentsWithoutCoverage) badges.add("DS_UNRECOGNIZED");
  if (options?.hasNfesWithoutItemLink) badges.add("NFE_UNLINKED");

  const snapVer = options?.snapshotComputationVersion ?? null;
  if (
    snapVer != null &&
    snapVer.trim() !== "" &&
    snapVer !== SALES_ORDER_FLOW_COMPUTATION_VERSION
  ) {
    badges.add("SNAPSHOT_DIVERGENT");
  }

  return [...badges];
}

function itemNeedsOpUnlinkedBadge(
  r: SalesOrderOperationalEvidenceGraph["items"][number]["reconciliation"]
): boolean {
  return (
    r.productionCoverage === "NONE" &&
    r.remainingFulfillment > 1e-9 &&
    r.coverageStatus === "AWAITING_PRODUCTION"
  );
}

/**
 * Monta o painel “Por que está nesta coluna?” a partir do grafo.
 */
export function buildSalesOrderFlowOperationalDiagnostics(input: {
  graph: SalesOrderOperationalEvidenceGraph;
  pack: SalesOrderFlowEvidencePack;
  stageLabel: string | null;
  stageReason: string | null;
  bottleneckSalesOrderItemId: string | null;
  bottleneckReason: string | null;
  nextAction: string | null;
  responsibleArea: string | null;
  computedAt: string | null;
  computationVersion: string | null;
}): SalesOrderFlowOperationalDiagnostics {
  const { graph, pack } = input;
  const itemById = new Map(pack.items.map((i) => [i.id, i] as const));

  const items: SalesOrderFlowOperationalDiagnosticItem[] = graph.items.map(
    (item) => {
      const packItem = itemById.get(item.salesOrderItemId);
      const r = item.reconciliation;
      return {
        salesOrderItemId: item.salesOrderItemId,
        sequence: packItem?.nomusItemSequence ?? null,
        productLabel:
          packItem?.productNameSnapshot?.trim() ||
          packItem?.skuSnapshot?.trim() ||
          null,
        linkStatus: r.linkStatus,
        coverageStatus: r.coverageStatus,
        activeObligation: r.activeObligation,
        fulfilledQuantity: r.fulfilledQuantity,
        remainingFulfillment: r.remainingFulfillment,
        cutQuantity: item.obligation.cutQuantity,
        canceledQuantity: item.obligation.canceledQuantity,
        productionOrderQuantity: r.productionOrderQuantity,
        productionCoverage: r.productionCoverage,
        documentedQuantity: r.documentedQuantity,
        documentedCoverage: r.documentedCoverage,
        invoicedQuantity: r.invoicedQuantity,
        invoicedCoverage: r.invoicedCoverage,
        shippedQuantity: r.shippedQuantity,
        shippedCoverage: r.shippedCoverage,
        sourceSummary: r.sourceSummary,
        warnings: r.warnings,
      };
    }
  );

  const evidencesFound: SalesOrderFlowOperationalDiagnosticEvidenceLine[] = [];
  const evidencesMissing: SalesOrderFlowOperationalDiagnosticEvidenceLine[] = [];

  // OPs
  const opAdvancing = graph.items.flatMap((i) =>
    i.production.filter((p) => p.advancesKanban)
  );
  if (opAdvancing.length > 0) {
    for (const op of opAdvancing) {
      evidencesFound.push({
        kind: "PRODUCTION_ORDER",
        label: `Ordem de Produção ${op.productionOrderExternalId ?? ""}`.trim(),
        detail: `Cobertura ${formatQty(op.linkedQuantity)}`,
        quantity: op.linkedQuantity,
        present: true,
        sourceLabel: sourceTypeLabel(op.link.sourceType),
      });
    }
  } else if (
    items.some(
      (i) => i.remainingFulfillment > 1e-9 && i.productionCoverage === "NONE"
    )
  ) {
    evidencesMissing.push({
      kind: "PRODUCTION_ORDER",
      label: "Ordem de Produção",
      detail: "Nenhuma OP vinculada cobrindo o residual",
      quantity: null,
      present: false,
      sourceLabel: null,
    });
  }

  // DS
  const docsAdvancing = graph.items.flatMap((i) =>
    i.documents.filter((d) => d.advancesKanban)
  );
  if (docsAdvancing.length > 0) {
    const byExt = new Map<number, { qty: number; source: string | null }>();
    for (const d of docsAdvancing) {
      const key = d.outputDocumentExternalId ?? -1;
      const prev = byExt.get(key) ?? { qty: 0, source: null };
      byExt.set(key, {
        qty: prev.qty + d.quantity,
        source: sourceTypeLabel(d.link.sourceType) ?? prev.source,
      });
    }
    for (const [extId, row] of byExt) {
      evidencesFound.push({
        kind: "OUTPUT_DOCUMENT",
        label:
          extId > 0
            ? `Documento de Saída reconhecido: ${extId}`
            : "Documento de Saída reconhecido",
        detail: `Cobertura ${formatQty(row.qty)}`,
        quantity: row.qty,
        present: true,
        sourceLabel: row.source,
      });
    }
  } else if (
    items.some(
      (i) => i.activeObligation > 1e-9 && i.documentedCoverage === "NONE"
    )
  ) {
    evidencesMissing.push({
      kind: "OUTPUT_DOCUMENT",
      label: "Documento de Saída",
      detail: "Sem documento válido cobrindo a obrigação",
      quantity: null,
      present: false,
      sourceLabel: null,
    });
  }

  // NF
  const nfesAdvancing = graph.items.flatMap((i) =>
    i.nfes.filter((n) => n.advancesKanban)
  );
  if (nfesAdvancing.length > 0) {
    const seen = new Set<number>();
    for (const n of nfesAdvancing) {
      if (n.nfeExternalId == null || seen.has(n.nfeExternalId)) continue;
      seen.add(n.nfeExternalId);
      const packNfe = pack.nfes.find((p) => p.externalId === n.nfeExternalId);
      const numero = packNfe?.numero?.trim() || String(n.nfeExternalId);
      const serie = packNfe?.serie?.trim();
      evidencesFound.push({
        kind: "NFE",
        label: `NF-e: ${serie ? `${numero}/${serie}` : numero} — autorizada`,
        detail: `Cobertura ${formatQty(n.quantity)}`,
        quantity: n.quantity,
        present: true,
        sourceLabel: sourceTypeLabel(n.link.sourceType),
      });
    }
  } else if (
    items.some(
      (i) =>
        i.activeObligation > 1e-9 &&
        i.documentedQuantity > 1e-9 &&
        i.invoicedCoverage === "NONE"
    )
  ) {
    evidencesMissing.push({
      kind: "NFE",
      label: "NF-e",
      detail: "Documento presente; falta NF-e autorizada",
      quantity: null,
      present: false,
      sourceLabel: null,
    });
  }

  // Cobertura por item (resumo amigável quando há DS)
  const coverageLines = items
    .filter((i) => i.documentedQuantity > 1e-9)
    .map((i) => {
      const seq = i.sequence ? `Item ${i.sequence}` : "Item";
      return `${seq} — ${formatQty(i.documentedQuantity)}`;
    });
  if (coverageLines.length > 0) {
    evidencesFound.push({
      kind: "OUTPUT_DOCUMENT",
      label: "Cobertura documental por item",
      detail: coverageLines.join(" · "),
      quantity: null,
      present: true,
      sourceLabel: null,
    });
  }

  const bottleneckItem = input.bottleneckSalesOrderItemId
    ? items.find((i) => i.salesOrderItemId === input.bottleneckSalesOrderItemId)
    : null;
  const bottleneckItemLabel = bottleneckItem
    ? [
        bottleneckItem.sequence ? `Item ${bottleneckItem.sequence}` : null,
        bottleneckItem.productLabel,
      ]
        .filter(Boolean)
        .join(" · ") || "Item gargalo"
    : null;

  const itemLabelById = new Map(
    items.map((i) => [
      i.salesOrderItemId,
      [i.sequence ? `Item ${i.sequence}` : null, i.productLabel]
        .filter(Boolean)
        .join(" · ") || "Item",
    ] as const)
  );
  const humanizeWarning = (warning: string): string =>
    warning.replace(
      /\[item:([^\]]+)\]/g,
      (_m, id: string) => `[${itemLabelById.get(id) ?? "Item"}]`
    );
  const warnings = [
    ...new Set([
      ...graph.reconciliation.warnings.map(humanizeWarning),
      ...items.flatMap((i) => i.warnings.map(humanizeWarning)),
    ]),
  ];

  const documentedTotal = items.reduce((s, i) => s + i.documentedQuantity, 0);
  const hasStockDocumentsWithoutCoverage =
    pack.stockDocuments.some((d) => !d.isCancelled) && documentedTotal <= 1e-9;

  const linkedNfeIds = new Set(
    nfesAdvancing
      .map((n) => n.nfeExternalId)
      .filter((id): id is number => id != null)
  );
  const hasNfesWithoutItemLink = pack.nfes.some(
    (n) =>
      n.isValidForBilling &&
      !n.isCanceled &&
      !linkedNfeIds.has(n.externalId)
  );

  const badges = collectOperationalDiagnosticBadges(graph, {
    snapshotComputationVersion: input.computationVersion,
    hasStockDocumentsWithoutCoverage,
    hasNfesWithoutItemLink,
  });

  const snapshotDivergent =
    badges.includes("SNAPSHOT_DIVERGENT") ||
    (input.computationVersion != null &&
      input.computationVersion !== SALES_ORDER_FLOW_COMPUTATION_VERSION);

  const totals: SalesOrderFlowOperationalDiagnosticTotals = {
    activeObligation: items.reduce((s, i) => s + i.activeObligation, 0),
    fulfilledQuantity: items.reduce((s, i) => s + i.fulfilledQuantity, 0),
    remainingFulfillment: items.reduce((s, i) => s + i.remainingFulfillment, 0),
    cutQuantity: items.reduce((s, i) => s + i.cutQuantity, 0),
    canceledQuantity: items.reduce((s, i) => s + i.canceledQuantity, 0),
    productionOrderQuantity: items.reduce(
      (s, i) => s + i.productionOrderQuantity,
      0
    ),
    documentedQuantity: items.reduce((s, i) => s + i.documentedQuantity, 0),
    invoicedQuantity: items.reduce((s, i) => s + i.invoicedQuantity, 0),
    shippedQuantity: items.reduce((s, i) => s + i.shippedQuantity, 0),
    linkedProductionOrderCount: new Set(
      opAdvancing
        .map((op) => op.productionOrderExternalId)
        .filter((id): id is number => id != null)
    ).size,
    linkedOutputDocumentCount: new Set(
      docsAdvancing
        .map((d) => d.outputDocumentExternalId)
        .filter((id): id is number => id != null)
    ).size,
    linkedNfeCount: new Set(
      nfesAdvancing
        .map((n) => n.nfeExternalId)
        .filter((id): id is number => id != null)
    ).size,
  };

  const productionOrderLabels = [
    ...new Set(
      opAdvancing
        .map((op) =>
          op.productionOrderExternalId != null
            ? String(op.productionOrderExternalId)
            : null
        )
        .filter((label): label is string => Boolean(label))
    ),
  ];
  const outputDocumentLabels = [
    ...new Set(
      docsAdvancing
        .map((d) =>
          d.outputDocumentExternalId != null
            ? String(d.outputDocumentExternalId)
            : null
        )
        .filter((label): label is string => Boolean(label))
    ),
  ];
  const nfeLabels = [
    ...new Set(
      evidencesFound
        .filter((line) => line.kind === "NFE" && line.present)
        .map((line) => line.label.replace(/^NF-e:\s*/, "").replace(/\s*—.*$/, ""))
    ),
  ];

  return {
    contractVersion: "sales-order-flow-operational-diagnostics/v1",
    title: "Por que está nesta coluna?",
    stageLabel: input.stageLabel,
    stageReason: input.stageReason,
    bottleneckItemLabel,
    bottleneckReason: input.bottleneckReason,
    nextAction: input.nextAction,
    responsibleArea: input.responsibleArea,
    pendingObligation: items.some((i) => i.remainingFulfillment > 1e-9),
    totals,
    productionOrderLabels,
    outputDocumentLabels,
    nfeLabels,
    evidencesFound,
    evidencesMissing,
    items,
    warnings,
    badges,
    computedAt: input.computedAt,
    computationVersion: input.computationVersion,
    expectedComputationVersion: SALES_ORDER_FLOW_COMPUTATION_VERSION,
    snapshotDivergent,
  };
}

export function buildSalesOrderFlowOperationalDiagnosticsFromPack(input: {
  pack: SalesOrderFlowEvidencePack;
  stageLabel: string | null;
  stageReason: string | null;
  bottleneckSalesOrderItemId: string | null;
  bottleneckReason: string | null;
  nextAction: string | null;
  responsibleArea: string | null;
  computedAt: string | null;
  computationVersion: string | null;
}): SalesOrderFlowOperationalDiagnostics {
  const graph = getSalesOrderOperationalEvidenceGraphFromPack(input.pack);
  return buildSalesOrderFlowOperationalDiagnostics({
    graph,
    pack: input.pack,
    stageLabel: input.stageLabel,
    stageReason: input.stageReason,
    bottleneckSalesOrderItemId: input.bottleneckSalesOrderItemId,
    bottleneckReason: input.bottleneckReason,
    nextAction: input.nextAction,
    responsibleArea: input.responsibleArea,
    computedAt: input.computedAt,
    computationVersion: input.computationVersion,
  });
}

/** Mescla badges do motor com badges diagnósticos (snapshot). */
export function mergeSalesOrderFlowBadgesWithDiagnostics(
  base: readonly SalesOrderFlowBadge[] | readonly string[],
  diagnostic: readonly SalesOrderFlowDiagnosticBadge[]
): string[] {
  return [...new Set([...base.map(String), ...diagnostic.map(String)])];
}
