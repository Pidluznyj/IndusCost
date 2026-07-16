/**
 * Loader read-only das evidências oficiais para o resolver TRIB-03.
 * Não consulta Nomus HTTP e não cria SalesOrderNfeLink.
 */

import type { PrismaClient } from "@prisma/client";
import {
  extractOfficialItemNfeExternalId,
  resolveSalesOrderRelatedNfes,
  type SalesOrderRelatedNfeForeignLink,
  type SalesOrderRelatedNfeItemRefEvidence,
  type SalesOrderRelatedNfeLinkEvidence,
  type SalesOrderRelatedNfeO2cEvidence,
  type SalesOrderRelatedNfeResolveResult,
  type SalesOrderRelatedNfeStatusHint,
  type SalesOrderRelatedNfeStockDocumentEvidence,
} from "./salesOrderRelatedNfeResolver.js";

type PrismaLike = Pick<
  PrismaClient,
  "salesOrderNfeLink" | "orderToCashAuditFact" | "nomusStockDocument" | "nomusNfe" | "salesOrderItem"
>;

function positiveInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.trunc(value);
  }
  return null;
}

export type LoadSalesOrderRelatedNfesOptions = {
  /** Quando informado, restringe fatos O2C ao run (mesmo critério do audit 360º). */
  runId?: string | null;
};

/**
 * Carrega evidências oficiais do pedido e resolve NF-es relacionadas.
 */
export async function loadSalesOrderRelatedNfes(
  prisma: PrismaLike,
  salesOrderId: string,
  options: LoadSalesOrderRelatedNfesOptions = {}
): Promise<SalesOrderRelatedNfeResolveResult> {
  const runId = options.runId?.trim() || null;

  const [links, o2cRows, items] = await Promise.all([
    prisma.salesOrderNfeLink.findMany({
      where: { salesOrderId },
      select: {
        id: true,
        nfeExternalId: true,
        nfeNumber: true,
        nfeKey: true,
        nfeStatus: true,
        presentInLastPayload: true,
      },
    }),
    prisma.orderToCashAuditFact.findMany({
      where: runId ? { salesOrderId, runId } : { salesOrderId },
      select: {
        nfeExternalId: true,
        nfeNumber: true,
        nfeKey: true,
        stockDocumentExternalId: true,
        stockDocumentIdNfe: true,
        salesOrderItemId: true,
        nfeItemMatchedOrderItem: true,
      },
    }),
    prisma.salesOrderItem.findMany({
      where: { salesOrderId },
      select: { id: true, nomusRawItem: true },
    }),
  ]);

  const linkEvidence: SalesOrderRelatedNfeLinkEvidence[] = links.map((link) => ({
    nfeExternalId: link.nfeExternalId,
    nfeNumber: link.nfeNumber,
    nfeKey: link.nfeKey,
    nfeStatus: link.nfeStatus,
    presentInLastPayload: link.presentInLastPayload,
    linkId: link.id,
  }));

  const o2cEvidence: SalesOrderRelatedNfeO2cEvidence[] = o2cRows.map((row) => ({
    nfeExternalId: row.nfeExternalId,
    nfeNumber: row.nfeNumber,
    nfeKey: row.nfeKey,
    stockDocumentExternalId: row.stockDocumentExternalId,
    stockDocumentIdNfe: row.stockDocumentIdNfe,
    salesOrderItemId: row.salesOrderItemId,
    nfeItemMatchedOrderItem: row.nfeItemMatchedOrderItem,
  }));

  const stockExternalIds = [
    ...new Set(
      o2cRows
        .map((row) => positiveInt(row.stockDocumentExternalId))
        .filter((id): id is number => id != null)
    ),
  ];

  const stockDocuments: SalesOrderRelatedNfeStockDocumentEvidence[] =
    stockExternalIds.length > 0
      ? (
          await prisma.nomusStockDocument.findMany({
            where: { externalId: { in: stockExternalIds } },
            select: { externalId: true, idNfe: true },
          })
        ).map((doc) => ({
          stockDocumentExternalId: doc.externalId,
          idNfe: doc.idNfe,
        }))
      : [];

  const itemRefs: SalesOrderRelatedNfeItemRefEvidence[] = [];
  for (const item of items) {
    const nfeExternalId = extractOfficialItemNfeExternalId(item.nomusRawItem);
    if (nfeExternalId == null) continue;
    itemRefs.push({
      salesOrderItemId: item.id,
      nfeExternalId,
    });
  }

  const candidateIds = new Set<number>();
  for (const link of linkEvidence) {
    const id = positiveInt(link.nfeExternalId);
    if (id != null) candidateIds.add(id);
  }
  for (const fact of o2cEvidence) {
    const a = positiveInt(fact.nfeExternalId);
    const b = positiveInt(fact.stockDocumentIdNfe);
    if (a != null) candidateIds.add(a);
    if (b != null) candidateIds.add(b);
  }
  for (const doc of stockDocuments) {
    const id = positiveInt(doc.idNfe);
    if (id != null) candidateIds.add(id);
  }
  for (const ref of itemRefs) {
    candidateIds.add(ref.nfeExternalId);
  }

  const ids = [...candidateIds];

  const [foreignLinksRaw, nfeRows] = await Promise.all([
    ids.length > 0
      ? prisma.salesOrderNfeLink.findMany({
          where: {
            nfeExternalId: { in: ids },
            salesOrderId: { not: salesOrderId },
          },
          select: {
            salesOrderId: true,
            orderCode: true,
            nfeExternalId: true,
          },
        })
      : Promise.resolve([]),
    ids.length > 0
      ? prisma.nomusNfe.findMany({
          where: { externalId: { in: ids } },
          select: { externalId: true, status: true },
        })
      : Promise.resolve([]),
  ]);

  const foreignLinks: SalesOrderRelatedNfeForeignLink[] = foreignLinksRaw.map(
    (row) => ({
      salesOrderId: row.salesOrderId,
      orderCode: row.orderCode,
      nfeExternalId: row.nfeExternalId,
    })
  );

  const nfeStatusHints: SalesOrderRelatedNfeStatusHint[] = nfeRows.map((row) => ({
    nfeExternalId: row.externalId,
    status: row.status,
  }));

  return resolveSalesOrderRelatedNfes({
    salesOrderId,
    links: linkEvidence,
    o2cFacts: o2cEvidence,
    stockDocuments,
    itemRefs,
    foreignLinks,
    nfeStatusHints,
  });
}
