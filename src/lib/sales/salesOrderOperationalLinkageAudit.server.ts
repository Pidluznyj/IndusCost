/**
 * KAN-LINK-03 — Loader Prisma read-only da auditoria de vínculos operacionais.
 * Sem writes, sem Nomus HTTP, sem recompute materializante.
 */

import type { PrismaClient } from "@prisma/client";
import { loadSalesOrderFlowEvidenceBatch } from "./salesOrderFlowEvidence.server.js";
import type { SalesOrderFlowEvidencePack } from "./salesOrderFlowEvidence.js";
import { resolveSalesOrderItemFlowFromEvidence } from "./salesOrderItemFlowEngine.js";
import { resolveSalesOrderFlow } from "./salesOrderFlowEngine.js";
import { buildSalesOrderItemFlowAllocationsFromEvidence } from "./salesOrderItemFlowAllocations.js";
import { buildSalesOrderFlowCompletionContextFromPack } from "./salesOrderFlowCompletionDates.js";
import {
  findSalesOrderFlowSnapshotsByOrderIds,
  findSalesOrderItemFlowSnapshotsByOrderId,
  type SalesOrderFlowRepositoryDb,
} from "./salesOrderFlowRepository.server.js";
import {
  listSalesOrderFlowRebuildCandidates,
  type SalesOrderFlowRebuildListDb,
} from "./salesOrderFlowRebuild.server.js";
import type { SalesOrderFlowEvidencePrisma } from "./salesOrderFlowEvidence.server.js";
import {
  buildSalesOrderFlowFingerprint,
  buildSalesOrderItemFlowFingerprint,
} from "./salesOrderFlowFingerprint.js";
import {
  buildMassAuditSummary,
  buildOrderOperationalLinkageReport,
  classifyMassLinkageFindings,
  decStr,
  emptyMassCounts,
  isCriticalMassFindingKind,
  isValidUuid,
  looksLikeUuidCandidate,
  qtyNum,
  salesOrderAuditCodeCandidates,
  type MassLinkageFinding,
  type MassLinkageFindingKind,
  type OperationalLinkageOrderReport,
  type SalesOrderOperationalLinkageAuditCliArgs,
  type SalesOrderOperationalLinkageAuditReport,
} from "./salesOrderOperationalLinkageAudit.js";
import type { SalesOrderOperationalLinkSourceType } from "./salesOrderOperationalEvidenceContract.js";

export type SalesOrderOperationalLinkageAuditDb = SalesOrderFlowRebuildListDb &
  SalesOrderFlowEvidencePrisma &
  SalesOrderFlowRepositoryDb &
  Pick<PrismaClient, "salesOrderNfeLink" | "nomusNfe" | "nomusStockDocument" | "nomusStockDocumentItem">;

function uniqueNumbers(values: Array<number | null | undefined>): number[] {
  return [...new Set(values.filter((v): v is number => typeof v === "number"))];
}

async function findOrderIdByCode(
  db: Pick<PrismaClient, "salesOrder">,
  requestedOrder: string
): Promise<{ id: string; orderCode: string; externalSalesOrderId: number | null; status: string; totalNetValue: unknown } | null> {
  const candidates = salesOrderAuditCodeCandidates(requestedOrder);
  const row = await db.salesOrder.findFirst({
    where: {
      OR: candidates.flatMap((code) => [
        { orderCode: { equals: code, mode: "insensitive" as const } },
        { externalSalesOrderCode: { equals: code, mode: "insensitive" as const } },
      ]),
    },
    select: {
      id: true,
      orderCode: true,
      externalSalesOrderId: true,
      status: true,
      totalNetValue: true,
    },
  });
  return row;
}

/**
 * Candidatos DS/NF além do pack: só por IDs oficiais (NfeLink, numero do link, idNfe, O2C).
 * Não usa cliente/valor/data/produto como prova.
 */
async function loadOfficialCandidates(
  db: SalesOrderOperationalLinkageAuditDb,
  pack: SalesOrderFlowEvidencePack
): Promise<{
  nfeLinks: OperationalLinkageOrderReport["salesOrderNfeLinks"];
  candidateDocuments: OperationalLinkageOrderReport["candidateDocuments"];
  nfesExtra: Array<{
    externalId: number;
    numero: string | null;
    serie: string | null;
    status: number | null;
  }>;
}> {
  const nfeLinksRaw = await db.salesOrderNfeLink.findMany({
    where: { salesOrderId: pack.orderId },
    select: {
      id: true,
      nfeExternalId: true,
      nfeNumber: true,
      nfeSerie: true,
      nfeStatus: true,
      nomusNfeId: true,
    },
  });

  const linkExternalIds = uniqueNumbers(nfeLinksRaw.map((l) => l.nfeExternalId));
  const linkNumbers = [
    ...new Set(
      nfeLinksRaw
        .map((l) => (l.nfeNumber ?? "").trim())
        .filter((n) => n.length > 0)
    ),
  ];

  const nfesByNumber =
    linkNumbers.length > 0
      ? await db.nomusNfe.findMany({
          where: { numero: { in: linkNumbers } },
          select: {
            externalId: true,
            numero: true,
            serie: true,
            status: true,
          },
        })
      : [];

  const allNfeExternalIds = uniqueNumbers([
    ...linkExternalIds,
    ...pack.nfes.map((n) => n.externalId),
    ...nfesByNumber.map((n) => n.externalId),
    ...pack.allocations.map((a) => a.nfeExternalId),
  ]);

  const o2cDocIds = uniqueNumbers(
    pack.allocations.map((a) => a.stockDocumentExternalId)
  );
  const packDocIds = uniqueNumbers(pack.stockDocuments.map((d) => d.externalId));

  const stockDocsRaw =
    allNfeExternalIds.length > 0 || o2cDocIds.length > 0 || packDocIds.length > 0
      ? await db.nomusStockDocument.findMany({
          where: {
            OR: [
              ...(allNfeExternalIds.length > 0
                ? [{ idNfe: { in: allNfeExternalIds } }]
                : []),
              ...(o2cDocIds.length > 0
                ? [{ externalId: { in: o2cDocIds } }]
                : []),
              ...(packDocIds.length > 0
                ? [{ externalId: { in: packDocIds } }]
                : []),
            ],
          },
          select: {
            id: true,
            externalId: true,
            documentNumber: true,
            idNfe: true,
            isCancelled: true,
            totalValue: true,
            statusRaw: true,
          },
        })
      : [];

  const docMap = new Map(stockDocsRaw.map((d) => [d.externalId, d] as const));
  const docIds = [...docMap.values()].map((d) => d.id);
  const linesRaw =
    docIds.length > 0
      ? await db.nomusStockDocumentItem.findMany({
          where: { stockDocumentId: { in: docIds } },
          select: {
            id: true,
            stockDocumentId: true,
            externalProductId: true,
            quantity: true,
          },
        })
      : [];

  const packDocExternalIds = new Set(pack.stockDocuments.map((d) => d.externalId));
  const productToItem = new Map<number, string>();
  for (const item of pack.items) {
    if (item.externalProductId != null) {
      productToItem.set(item.externalProductId, item.id);
    }
  }

  const candidateDocuments: OperationalLinkageOrderReport["candidateDocuments"] =
    [...docMap.values()].map((doc) => {
      const usedByKanban = packDocExternalIds.has(doc.externalId);
      let discoveryPath = "UNKNOWN";
      if (o2cDocIds.includes(doc.externalId)) discoveryPath = "O2C_STOCK_DOCUMENT_EXTERNAL_ID";
      else if (doc.idNfe != null && linkExternalIds.includes(doc.idNfe)) {
        discoveryPath = "DS_ID_NFE_VIA_SALES_ORDER_NFE_LINK";
      } else if (doc.idNfe != null && nfesByNumber.some((n) => n.externalId === doc.idNfe)) {
        discoveryPath = "DS_ID_NFE_VIA_NFE_NUMBER_FROM_LINK";
      } else if (packDocExternalIds.has(doc.externalId)) {
        discoveryPath = "EVIDENCE_PACK";
      }

      let sourceType: SalesOrderOperationalLinkSourceType | null = null;
      if (usedByKanban && nfeLinksRaw.some((l) => l.nfeExternalId === doc.idNfe)) {
        sourceType = "SALES_ORDER_NFE_LINK";
      } else if (usedByKanban && doc.idNfe != null) {
        sourceType = "OUTPUT_DOCUMENT_REFERENCE";
      } else if (!usedByKanban && doc.idNfe != null) {
        sourceType = "NFE_REFERENCE";
      }

      const docLines = linesRaw.filter((l) => l.stockDocumentId === doc.id);
      return {
        stockDocumentExternalId: doc.externalId,
        documentNumber: doc.documentNumber,
        idNfe: doc.idNfe,
        isCancelled: doc.isCancelled,
        totalValue: decStr(doc.totalValue),
        statusRaw: doc.statusRaw,
        discoveryPath,
        usedByKanban,
        sourceType,
        lines: docLines.map((line) => {
          const matched =
            line.externalProductId != null
              ? productToItem.get(line.externalProductId) ?? null
              : null;
          return {
            stockDocumentItemId: line.id,
            externalProductId: line.externalProductId,
            quantity: decStr(line.quantity) ?? "0.00",
            matchedSalesOrderItemId: matched,
            matchReason:
              matched != null
                ? "EXTERNAL_PRODUCT_ID"
                : line.externalProductId == null
                  ? "MISSING_EXTERNAL_PRODUCT_ID"
                  : "NO_ITEM_WITH_PRODUCT",
          };
        }),
      };
    });

  return {
    nfeLinks: nfeLinksRaw,
    candidateDocuments,
    nfesExtra: nfesByNumber,
  };
}

function buildOrderSliceFromPack(input: {
  requestedOrder: string | null;
  pack: SalesOrderFlowEvidencePack;
  persistedStage: string | null;
  persistedFingerprint: string | null;
  itemPersistedStages: Map<string, string | null>;
  candidates: Awaited<ReturnType<typeof loadOfficialCandidates>>;
  referenceDate: Date;
}): OperationalLinkageOrderReport {
  const { pack, candidates } = input;
  const itemResults = pack.items
    .map((item) =>
      resolveSalesOrderItemFlowFromEvidence(pack, item.id, {
        referenceDate: pack.meta.loadedAt,
      })
    )
    .filter((r): r is NonNullable<typeof r> => r != null);

  const completionCtx = buildSalesOrderFlowCompletionContextFromPack(pack, {
    persistedCompletedAt: null,
  });
  const orderResult = resolveSalesOrderFlow(itemResults, {
    salesOrderId: pack.orderId,
    orderStatus: pack.order.status,
    promisedDeliveryAt: pack.order.expectedDeliveryDate,
    referenceDate: input.referenceDate,
    ...completionCtx,
  });

  const itemFp = itemResults.map((r) => buildSalesOrderItemFlowFingerprint(r));
  const calculatedFingerprint = buildSalesOrderFlowFingerprint(orderResult, itemFp);

  const resultByItem = new Map(itemResults.map((r) => [r.salesOrderItemId, r] as const));
  const nfeLinkIds = new Set(candidates.nfeLinks.map((l) => l.nfeExternalId));

  const items = pack.items.map((item) => {
    const resolved = resultByItem.get(item.id);
    const alloc = buildSalesOrderItemFlowAllocationsFromEvidence(pack, item);
    const documented = alloc.documentAllocations
      .filter((d) => d.isValid !== false && d.isCanceled !== true)
      .reduce((s, d) => s + qtyNum(d.quantity), 0);
    const invoiced = alloc.nfeAllocations
      .filter((n) => n.isCanceled !== true && n.isValidForBilling !== false)
      .reduce((s, n) => s + qtyNum(n.quantity), 0);

    const itemProdLinks = pack.productionLinks.filter(
      (l) => l.salesOrderItemId === item.id
    );

    return {
      salesOrderItemId: item.id,
      sequence: item.nomusItemSequence != null ? String(item.nomusItemSequence).padStart(5, "0") : null,
      sku: item.skuSnapshot,
      productName: item.productNameSnapshot,
      externalProductId: item.externalProductId,
      orderedQuantity: resolved?.orderedQuantity ?? item.quantity,
      cutQuantity: resolved?.cutQuantity ?? 0,
      canceledQuantity: resolved?.canceledQuantity ?? 0,
      fulfilledQuantity: item.nomusQuantityFulfilled,
      activeObligationQuantity: resolved?.activeObligationQuantity ?? item.quantity,
      documentedQuantity: documented,
      invoicedQuantity: invoiced,
      shippedQuantity: resolved?.shippedQuantity ?? invoiced,
      productionCoveredQuantity: resolved?.productionOrderQuantity ?? 0,
      calculatedStage: resolved?.currentStage ?? null,
      persistedStage: input.itemPersistedStages.get(item.id) ?? null,
      productionLinks: itemProdLinks.map((l) => ({
        productionOrderExternalId: l.productionOrderExternalId,
        linkedQuantity: decStr(l.linkedQuantity),
        isCurrent: l.isCurrent !== false,
        sourceType: "PRODUCTION_ORDER_REFERENCE" as const,
        usedByKanban: l.isCurrent !== false,
      })),
      documents: alloc.documentAllocations.map((d) => {
        const ext = Number(String(d.allocationKey).replace(/\D/g, "")) || null;
        const doc =
          pack.stockDocuments.find((s) =>
            d.allocationKey.includes(String(s.externalId))
          ) ?? null;
        return {
          stockDocumentExternalId: doc?.externalId ?? ext,
          quantity: decStr(d.quantity) ?? "0.00",
          sourceType: (doc?.idNfe != null && nfeLinkIds.has(doc.idNfe)
            ? "SALES_ORDER_NFE_LINK"
            : "OUTPUT_DOCUMENT_REFERENCE") as SalesOrderOperationalLinkSourceType,
          usedByKanban: d.isValid !== false && d.isCanceled !== true,
          nfeExternalId: doc?.idNfe ?? null,
        };
      }),
      nfes: alloc.nfeAllocations.map((n) => ({
        nfeExternalId: n.nfeExternalId,
        quantity: decStr(n.quantity) ?? "0.00",
        status:
          pack.nfes.find((x) => x.externalId === n.nfeExternalId)?.statusNormalized
            .statusNormalized ?? null,
        sourceType: (nfeLinkIds.has(n.nfeExternalId)
          ? "SALES_ORDER_NFE_LINK"
          : "NFE_REFERENCE") as SalesOrderOperationalLinkSourceType,
        usedByKanban: n.isCanceled !== true && n.isValidForBilling !== false,
      })),
    };
  });

  const packNfeIds = new Set(pack.nfes.map((n) => n.externalId));
  const nfesMerged = new Map<
    number,
    OperationalLinkageOrderReport["nfes"][number]
  >();
  for (const nfe of pack.nfes) {
    nfesMerged.set(nfe.externalId, {
      nfeExternalId: nfe.externalId,
      numero: nfe.numero,
      serie: nfe.serie,
      statusNormalized: nfe.statusNormalized.statusNormalized,
      isCanceled: nfe.isCanceled,
      isValidForBilling: nfe.isValidForBilling,
      usedByKanban: true,
      hasSalesOrderNfeLink: nfeLinkIds.has(nfe.externalId),
    });
  }
  for (const extra of candidates.nfesExtra) {
    if (nfesMerged.has(extra.externalId)) continue;
    nfesMerged.set(extra.externalId, {
      nfeExternalId: extra.externalId,
      numero: extra.numero,
      serie: extra.serie,
      statusNormalized: extra.status != null ? String(extra.status) : null,
      isCanceled: false,
      isValidForBilling: false,
      usedByKanban: packNfeIds.has(extra.externalId),
      hasSalesOrderNfeLink: nfeLinkIds.has(extra.externalId),
    });
  }

  const ambiguous =
    candidates.nfesExtra.length > 1 &&
    new Set(candidates.nfesExtra.map((n) => n.numero)).size <
      candidates.nfesExtra.length;

  return buildOrderOperationalLinkageReport({
    requestedOrder: input.requestedOrder,
    order: {
      salesOrderId: pack.orderId,
      orderCode: pack.order.orderCode,
      externalSalesOrderId: pack.order.externalSalesOrderId ?? null,
      status: pack.order.status,
      totalNetValue: pack.order.totalNetValue,
    },
    items,
    candidateProductionOrders: pack.productionLinks
      .filter((l) => l.productionOrderExternalId != null)
      .map((l) => ({
        productionOrderExternalId: l.productionOrderExternalId!,
        linkedQuantity: decStr(l.linkedQuantity),
        isCurrent: l.isCurrent !== false,
        salesOrderItemId: l.salesOrderItemId,
        sourceType: "PRODUCTION_ORDER_REFERENCE" as const,
        usedByKanban: l.isCurrent !== false,
      })),
    candidateDocuments: candidates.candidateDocuments,
    salesOrderNfeLinks: candidates.nfeLinks,
    nfes: [...nfesMerged.values()],
    calculatedStage: orderResult.currentStage,
    persistedStage: input.persistedStage,
    calculatedFingerprint,
    persistedFingerprint: input.persistedFingerprint,
    extraObservations: ambiguous
      ? [
          {
            kind: "AMBIGUOUS_LINK",
            code: "AMBIGUOUS_NFE_NUMBER",
            detail: "Mais de uma NF-e para o mesmo número do SalesOrderNfeLink.",
            salesOrderItemId: null,
            entityType: "NFE",
            entityId: null,
            sourceType: "AMBIGUOUS",
          },
        ]
      : [],
  });
}

export async function loadSalesOrderOperationalLinkageOrderAudit(
  db: SalesOrderOperationalLinkageAuditDb,
  requestedOrder: string,
  referenceDate: Date = new Date()
): Promise<OperationalLinkageOrderReport> {
  const order = await findOrderIdByCode(db, requestedOrder);
  if (!order) {
    return buildOrderOperationalLinkageReport({
      requestedOrder,
      order: null,
      items: [],
      candidateProductionOrders: [],
      candidateDocuments: [],
      salesOrderNfeLinks: [],
      nfes: [],
      calculatedStage: null,
      persistedStage: null,
      calculatedFingerprint: null,
      persistedFingerprint: null,
    });
  }

  const evidenceMap = await loadSalesOrderFlowEvidenceBatch(db, [order.id]);
  const pack = evidenceMap.get(order.id);
  if (!pack) {
    return buildOrderOperationalLinkageReport({
      requestedOrder,
      order: null,
      items: [],
      candidateProductionOrders: [],
      candidateDocuments: [],
      salesOrderNfeLinks: [],
      nfes: [],
      calculatedStage: null,
      persistedStage: null,
      calculatedFingerprint: null,
      persistedFingerprint: null,
      extraWarnings: ["Pedido existe mas pack de evidências veio vazio."],
    });
  }

  const [snapshots, itemSnaps] = await Promise.all([
    findSalesOrderFlowSnapshotsByOrderIds(db, [order.id]),
    findSalesOrderItemFlowSnapshotsByOrderId(db, order.id),
  ]);
  const snap = snapshots.get(order.id) ?? null;
  const itemPersistedStages = new Map(
    itemSnaps.map((r) => [r.salesOrderItemId, r.currentStage] as const)
  );

  const candidates = await loadOfficialCandidates(db, pack);
  return buildOrderSliceFromPack({
    requestedOrder,
    pack,
    persistedStage: snap?.currentStage ?? null,
    persistedFingerprint: snap?.fingerprint ?? null,
    itemPersistedStages,
    candidates,
    referenceDate,
  });
}

function summarizeOrderForMass(
  orderReport: OperationalLinkageOrderReport
): MassLinkageFinding[] {
  if (!orderReport.orderFound || !orderReport.salesOrderId || !orderReport.orderCode) {
    return [];
  }
  const ambiguousLinkCount = orderReport.observations.filter(
    (o) => o.kind === "AMBIGUOUS_LINK"
  ).length;
  const orphanLinkCount = orderReport.salesOrderNfeLinks.filter((l) => {
    return !orderReport.nfes.some((n) => n.nfeExternalId === l.nfeExternalId);
  }).length;
  const externalIds = orderReport.candidateDocuments.map((d) => d.stockDocumentExternalId);
  const duplicateExternalIdCount =
    externalIds.length - new Set(externalIds).size;
  const invalidUuidCount = orderReport.observations.filter(
    (o) => o.code === "INVALID_UUID_FIELD"
  ).length;

  return classifyMassLinkageFindings({
    salesOrderId: orderReport.salesOrderId,
    orderCode: orderReport.orderCode,
    calculatedStage: orderReport.calculatedStage,
    persistedStage: orderReport.persistedStage,
    hasValidDocumentInPack: orderReport.linkedDocuments.length > 0,
    hasValidNfeInPack: orderReport.nfes.some(
      (n) => n.usedByKanban && n.isValidForBilling && !n.isCanceled
    ),
    hasSalesOrderNfeLink: orderReport.salesOrderNfeLinks.length > 0,
    hasValidNfeCandidateWithoutLink: orderReport.observations.some(
      (o) => o.code === "NFE_VALID_WITHOUT_LINK"
    ),
    hasUnusedValidDocumentCandidate: orderReport.observations.some(
      (o) => o.code === "DS_VALID_NOT_RECOGNIZED"
    ),
    hasCurrentProductionLink: orderReport.linkedProductionOrders.length > 0,
    hasProductionCandidateWithoutLink: false,
    documentedExceedsObligation: orderReport.observations.some(
      (o) => o.code === "DOCUMENTED_QTY_EXCEEDS_OBLIGATION"
    ),
    documentOrderLevelOnly: orderReport.observations.some(
      (o) => o.code === "DOC_LINKED_ORDER_LEVEL_ONLY"
    ),
    ambiguousLinkCount,
    orphanLinkCount,
    duplicateExternalIdCount,
    invalidUuidCount,
  });
}

export async function runSalesOrderOperationalLinkageAudit(
  db: SalesOrderOperationalLinkageAuditDb,
  args: SalesOrderOperationalLinkageAuditCliArgs,
  referenceDate: Date = new Date()
): Promise<SalesOrderOperationalLinkageAuditReport> {
  if (args.mode === "ORDER") {
    const orderReport = await loadSalesOrderOperationalLinkageOrderAudit(
      db,
      args.order!,
      referenceDate
    );
    return {
      ok: true,
      mode: "READ_ONLY",
      auditMode: "ORDER",
      generatedAt: referenceDate.toISOString(),
      guarantees: {
        databaseWrites: false,
        nomusCalls: false,
        passwordExposed: false,
        writesOnlyAuditOutputFiles: true,
      },
      filters: {
        order: args.order,
        limit: args.limit,
        outputDir: args.outputDir,
        emitJson: args.emitJson,
        emitMarkdown: args.emitMarkdown,
      },
      orderReport,
      mass: null,
      summary: orderReport.orderFound
        ? `Pedido ${orderReport.orderCode}: críticos=${orderReport.criticalDivergenceCount}; DS candidatos=${orderReport.candidateDocuments.length}; links NF=${orderReport.salesOrderNfeLinks.length}; calc=${orderReport.calculatedStage}; snap=${orderReport.persistedStage}`
        : `Pedido não encontrado: ${args.order}`,
    };
  }

  const countsByKind = emptyMassCounts();
  const findings: MassLinkageFinding[] = [];
  let ordersScanned = 0;
  let criticalCount = 0;
  let cursorAfterId: string | null = null;
  const maxOrders = args.limit ?? Number.POSITIVE_INFINITY;
  const includeCompleted = args.mode === "ALL";

  while (ordersScanned < maxOrders) {
    const take = Math.min(50, maxOrders - ordersScanned);
    if (take <= 0) break;
    const batch = await listSalesOrderFlowRebuildCandidates(
      db,
      {
        mode: "preview",
        orderCode: null,
        fromDate: null,
        toDate: null,
        batchSize: take,
        includeCompleted,
        resumeFrom: null,
        resumeFromCheckpoint: false,
        checkpointFile: "",
        lockFile: "",
        maxBatches: null,
      },
      cursorAfterId
    );
    if (batch.length === 0) break;

    const orderIds = batch.map((c) => c.id);
    const [evidenceById, snapshotsById] = await Promise.all([
      loadSalesOrderFlowEvidenceBatch(db, orderIds),
      findSalesOrderFlowSnapshotsByOrderIds(db, orderIds),
    ]);

    for (const candidate of batch) {
      cursorAfterId = candidate.id;
      const pack = evidenceById.get(candidate.id);
      if (!pack) continue;
      const snap = snapshotsById.get(candidate.id) ?? null;
      const candidates = await loadOfficialCandidates(db, pack);
      const orderReport = buildOrderSliceFromPack({
        requestedOrder: pack.order.orderCode,
        pack,
        persistedStage: snap?.currentStage ?? null,
        persistedFingerprint: snap?.fingerprint ?? null,
        itemPersistedStages: new Map(),
        candidates,
        referenceDate,
      });
      const orderFindings = summarizeOrderForMass(orderReport);
      for (const f of orderFindings) {
        countsByKind[f.kind] += 1;
        findings.push(f);
        if (isCriticalMassFindingKind(f.kind) || f.critical) {
          criticalCount += 1;
        }
      }
      ordersScanned += 1;
    }
  }

  // Tipagem: garantir todas as chaves no contador
  void (Object.keys(countsByKind) as MassLinkageFindingKind[]);

  return {
    ok: true,
    mode: "READ_ONLY",
    auditMode: args.mode,
    generatedAt: referenceDate.toISOString(),
    guarantees: {
      databaseWrites: false,
      nomusCalls: false,
      passwordExposed: false,
      writesOnlyAuditOutputFiles: true,
    },
    filters: {
      order: args.order,
      limit: args.limit,
      outputDir: args.outputDir,
      emitJson: args.emitJson,
      emitMarkdown: args.emitMarkdown,
    },
    orderReport: null,
    mass: {
      ordersScanned,
      criticalCount,
      findings,
      countsByKind,
    },
    summary: buildMassAuditSummary({
      ordersScanned,
      criticalCount,
      countsByKind,
    }),
  };
}

export { looksLikeUuidCandidate, isValidUuid };
