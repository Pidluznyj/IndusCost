/**
 * TRIB-07 — loader Prisma estritamente read-only.
 * Somente findFirst/findMany com select explícito e limites.
 */

import type { PrismaClient } from "@prisma/client";
import {
  SALES_ORDER_TAXES_AUDIT_MAX_ROWS,
  buildSalesOrderTaxesAuditReport,
  salesOrderAuditCodeCandidates,
  type SalesOrderTaxesAuditReport,
} from "./salesOrderTaxesAudit.js";
import { extractOfficialItemNfeExternalId } from "./salesOrderRelatedNfeResolver.js";

export async function loadSalesOrderTaxesAudit(
  prisma: PrismaClient,
  requestedOrder: string
): Promise<SalesOrderTaxesAuditReport> {
  const candidates = salesOrderAuditCodeCandidates(requestedOrder);
  const order = await prisma.salesOrder.findFirst({
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
      externalSalesOrderCode: true,
    },
  });

  if (!order) {
    return buildSalesOrderTaxesAuditReport({
      requestedOrder,
      order: null,
      links: [],
      o2cFacts: [],
      stockDocuments: [],
      items: [],
      foreignLinks: [],
      nfes: [],
    });
  }

  const [links, o2cFacts, items] = await Promise.all([
    prisma.salesOrderNfeLink.findMany({
      where: { salesOrderId: order.id },
      select: {
        id: true,
        salesOrderId: true,
        orderCode: true,
        nfeExternalId: true,
        nfeNumber: true,
        nfeKey: true,
        nfeStatus: true,
        presentInLastPayload: true,
      },
      orderBy: { nfeExternalId: "asc" },
      take: SALES_ORDER_TAXES_AUDIT_MAX_ROWS,
    }),
    prisma.orderToCashAuditFact.findMany({
      where: { salesOrderId: order.id },
      select: {
        nfeExternalId: true,
        nfeNumber: true,
        nfeKey: true,
        stockDocumentExternalId: true,
        stockDocumentIdNfe: true,
        stockDocumentType: true,
        stockDocumentDate: true,
        salesOrderItemId: true,
        nfeItemMatchedOrderItem: true,
      },
      orderBy: { createdAt: "desc" },
      take: SALES_ORDER_TAXES_AUDIT_MAX_ROWS,
    }),
    prisma.salesOrderItem.findMany({
      where: { salesOrderId: order.id },
      select: { id: true, nomusRawItem: true },
      orderBy: { id: "asc" },
      take: SALES_ORDER_TAXES_AUDIT_MAX_ROWS,
    }),
  ]);

  const stockDocumentExternalIds = [
    ...new Set(
      o2cFacts
        .map((fact) => fact.stockDocumentExternalId)
        .filter((id): id is number => id != null && id > 0)
    ),
  ];
  const stockDocuments =
    stockDocumentExternalIds.length > 0
      ? await prisma.nomusStockDocument.findMany({
          where: { externalId: { in: stockDocumentExternalIds } },
          select: {
            id: true,
            externalId: true,
            idNfe: true,
            tipoDocumentoEstoque: true,
            dataDocumento: true,
          },
          orderBy: { externalId: "asc" },
          take: SALES_ORDER_TAXES_AUDIT_MAX_ROWS,
        })
      : [];

  const candidateNfeIds = new Set<number>();
  for (const link of links) candidateNfeIds.add(link.nfeExternalId);
  for (const fact of o2cFacts) {
    if (fact.nfeExternalId != null && fact.nfeExternalId > 0) {
      candidateNfeIds.add(fact.nfeExternalId);
    }
    if (fact.stockDocumentIdNfe != null && fact.stockDocumentIdNfe > 0) {
      candidateNfeIds.add(fact.stockDocumentIdNfe);
    }
  }
  for (const doc of stockDocuments) {
    if (doc.idNfe != null && doc.idNfe > 0) candidateNfeIds.add(doc.idNfe);
  }
  for (const item of items) {
    const nfeId = extractOfficialItemNfeExternalId(item.nomusRawItem);
    if (nfeId != null) candidateNfeIds.add(nfeId);
  }

  const ids = [...candidateNfeIds].slice(0, SALES_ORDER_TAXES_AUDIT_MAX_ROWS);
  const [foreignLinks, nfes] = await Promise.all([
    ids.length > 0
      ? prisma.salesOrderNfeLink.findMany({
          where: {
            nfeExternalId: { in: ids },
            salesOrderId: { not: order.id },
          },
          select: {
            salesOrderId: true,
            orderCode: true,
            nfeExternalId: true,
          },
          orderBy: { nfeExternalId: "asc" },
          take: SALES_ORDER_TAXES_AUDIT_MAX_ROWS,
        })
      : Promise.resolve([]),
    ids.length > 0
      ? prisma.nomusNfe.findMany({
          where: { externalId: { in: ids } },
          select: {
            id: true,
            externalId: true,
            numero: true,
            serie: true,
            chave: true,
            status: true,
            fiscalSummary: {
              select: {
                source: true,
                parserVersion: true,
                parsedAt: true,
                isCancelled: true,
                finalidade: true,
                vProd: true,
                vDesc: true,
                vFrete: true,
                vSeg: true,
                vOutro: true,
                vII: true,
                vIPI: true,
                vIPIDevol: true,
                vBC: true,
                vICMS: true,
                vICMSDeson: true,
                vBCST: true,
                vST: true,
                vFCP: true,
                vFCPST: true,
                vFCPSTRet: true,
                vPIS: true,
                vCOFINS: true,
                vISS: true,
                vTotTrib: true,
                vNF: true,
                highlightedResidual: true,
                qualityAlert: true,
                taxLines: {
                  where: { scope: "HEADER" },
                  select: {
                    taxType: true,
                    scope: true,
                    amount: true,
                    baseAmount: true,
                    rate: true,
                  },
                  orderBy: { taxType: "asc" },
                  take: SALES_ORDER_TAXES_AUDIT_MAX_ROWS,
                },
              },
            },
          },
          orderBy: { externalId: "asc" },
          take: SALES_ORDER_TAXES_AUDIT_MAX_ROWS,
        })
      : Promise.resolve([]),
  ]);

  return buildSalesOrderTaxesAuditReport({
    requestedOrder,
    order,
    links,
    o2cFacts,
    stockDocuments,
    items,
    foreignLinks,
    nfes,
  });
}
