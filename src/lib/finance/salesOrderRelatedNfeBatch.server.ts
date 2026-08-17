/**
 * FASE 2C — versão BATCH de `resolveRelatedNfesForOrderAudit`.
 *
 * O caminho atual gasta TRÊS consultas por pedido para descobrir as NFes
 * relacionadas:
 *   1. `NomusStockDocument` pelos documentos citados nos facts O2C (→ idNfe)
 *   2. `SalesOrderNfeLink` de OUTROS pedidos que citam as mesmas NFes (N:N)
 *   3. `NomusNfe` para o hint de status
 *
 * Com 80 pedidos por request do Fluxo de Caixa isso são 240 consultas. Aqui
 * são TRÊS, para o conjunto inteiro.
 *
 * A REGRA NÃO MUDA: o núcleo continua sendo a função pura
 * `resolveSalesOrderRelatedNfes`, chamada por pedido com exatamente as mesmas
 * evidências. O que mudou é de onde as evidências vêm — união carregada de uma
 * vez e recortada em memória por pedido, com o mesmo predicado:
 *
 *   - `stockDocuments` → só os documentos citados NAQUELE pedido
 *   - `foreignLinks`   → `nfeExternalId ∈ candidatos(pedido)` E
 *                        `salesOrderId != pedido`  (o `not` do where original)
 *   - `nfeStatusHints` → só as NFes candidatas daquele pedido
 *
 * NÃO corrige o caso 8572 (N:N por NfeLink). Reproduz o comportamento atual,
 * inclusive onde ele é imperfeito — correção é missão separada.
 *
 * As evidências de entrada (links, items, o2cFacts) chegam já carregadas: quem
 * chama faz UMA consulta de cada, compartilhada com os demais resolvers.
 */

import type { PrismaClient } from "@prisma/client";
import {
  extractOfficialItemNfeExternalId,
  resolveSalesOrderRelatedNfes,
  type SalesOrderRelatedNfeResolveResult,
} from "@/src/lib/sales-orders/salesOrderRelatedNfeResolver.js";

export type RelatedNfeBatchPrismaLike = Pick<
  PrismaClient,
  "nomusStockDocument" | "salesOrderNfeLink" | "nomusNfe"
>;

export type RelatedNfeBatchOrderInput = {
  salesOrderId: string;
  links: Array<{
    id: string;
    nfeExternalId: number;
    nfeNumber: string | null;
    nfeKey: string | null;
    nfeStatus: number | null;
    presentInLastPayload: boolean;
  }>;
  items: Array<{ id: string; nomusRawItem: unknown }>;
  o2cFacts: Array<{
    nfeExternalId: number | null;
    nfeNumber: string | null;
    nfeKey: string | null;
    stockDocumentExternalId: number | null;
    stockDocumentIdNfe: number | null;
    salesOrderItemId: string | null;
    nfeItemMatchedOrderItem: boolean | null;
  }>;
};

export async function resolveRelatedNfesForOrdersBatch(
  prisma: RelatedNfeBatchPrismaLike,
  orders: ReadonlyArray<RelatedNfeBatchOrderInput>
): Promise<Map<string, SalesOrderRelatedNfeResolveResult>> {
  const result = new Map<string, SalesOrderRelatedNfeResolveResult>();
  if (orders.length === 0) return result;

  /* -- 1. documentos de saída citados nos facts (união) ------------------ */
  const stockIdsByOrder = new Map<string, Set<number>>();
  const allStockExternalIds = new Set<number>();
  for (const order of orders) {
    const set = new Set<number>();
    for (const fact of order.o2cFacts) {
      const id = fact.stockDocumentExternalId;
      if (id != null && id > 0) {
        set.add(id);
        allStockExternalIds.add(id);
      }
    }
    stockIdsByOrder.set(order.salesOrderId, set);
  }

  const stockRows =
    allStockExternalIds.size > 0
      ? await prisma.nomusStockDocument.findMany({
          where: { externalId: { in: [...allStockExternalIds] } },
          select: { externalId: true, idNfe: true },
        })
      : [];
  const stockByExternalId = new Map(stockRows.map((d) => [d.externalId, d]));

  /* -- 2. candidatos e itemRefs por pedido (mesma ordem de inserção) ----- */
  const candidatesByOrder = new Map<string, Set<number>>();
  const itemRefsByOrder = new Map<
    string,
    Array<{ salesOrderItemId: string; nfeExternalId: number }>
  >();
  const stockDocsByOrder = new Map<
    string,
    Array<{ stockDocumentExternalId: number; idNfe: number | null }>
  >();
  const allCandidateIds = new Set<number>();

  for (const order of orders) {
    const stockDocs = [...(stockIdsByOrder.get(order.salesOrderId) ?? [])]
      .map((id) => stockByExternalId.get(id))
      .filter((d): d is NonNullable<typeof d> => d != null)
      .map((d) => ({ stockDocumentExternalId: d.externalId, idNfe: d.idNfe }));
    stockDocsByOrder.set(order.salesOrderId, stockDocs);

    const itemRefs: Array<{ salesOrderItemId: string; nfeExternalId: number }> =
      [];
    for (const item of order.items) {
      const nfeExternalId = extractOfficialItemNfeExternalId(item.nomusRawItem);
      if (nfeExternalId == null) continue;
      itemRefs.push({ salesOrderItemId: item.id, nfeExternalId });
    }
    itemRefsByOrder.set(order.salesOrderId, itemRefs);

    // Ordem de inserção idêntica à do resolver por pedido.
    const candidateIds = new Set<number>();
    for (const link of order.links) {
      if (link.nfeExternalId > 0) candidateIds.add(link.nfeExternalId);
    }
    for (const fact of order.o2cFacts) {
      if (fact.nfeExternalId != null && fact.nfeExternalId > 0) {
        candidateIds.add(fact.nfeExternalId);
      }
      if (fact.stockDocumentIdNfe != null && fact.stockDocumentIdNfe > 0) {
        candidateIds.add(fact.stockDocumentIdNfe);
      }
    }
    for (const doc of stockDocs) {
      if (doc.idNfe != null && doc.idNfe > 0) candidateIds.add(doc.idNfe);
    }
    for (const ref of itemRefs) candidateIds.add(ref.nfeExternalId);

    candidatesByOrder.set(order.salesOrderId, candidateIds);
    for (const id of candidateIds) allCandidateIds.add(id);
  }

  /* -- 3. links de outros pedidos (N:N) + hints de status ---------------- */
  const ids = [...allCandidateIds];
  const [allLinks, nfeRows] = await Promise.all([
    ids.length > 0
      ? prisma.salesOrderNfeLink.findMany({
          where: { nfeExternalId: { in: ids } },
          select: { salesOrderId: true, orderCode: true, nfeExternalId: true },
        })
      : Promise.resolve([]),
    ids.length > 0
      ? prisma.nomusNfe.findMany({
          where: { externalId: { in: ids } },
          select: { externalId: true, status: true },
        })
      : Promise.resolve([]),
  ]);

  /* -- 4. recorte por pedido + mesma função pura ------------------------- */
  for (const order of orders) {
    const candidateIds = candidatesByOrder.get(order.salesOrderId) ?? new Set();

    // `salesOrderId: { not: input.salesOrderId }` do where original.
    const foreignLinks =
      candidateIds.size > 0
        ? allLinks.filter(
            (l) =>
              candidateIds.has(l.nfeExternalId) &&
              l.salesOrderId !== order.salesOrderId
          )
        : [];

    const nfeStatusHints =
      candidateIds.size > 0
        ? nfeRows
            .filter((row) => candidateIds.has(row.externalId))
            .map((row) => ({
              nfeExternalId: row.externalId,
              status: row.status,
            }))
        : [];

    result.set(
      order.salesOrderId,
      resolveSalesOrderRelatedNfes({
        salesOrderId: order.salesOrderId,
        links: order.links.map((link) => ({
          nfeExternalId: link.nfeExternalId,
          nfeNumber: link.nfeNumber,
          nfeKey: link.nfeKey,
          nfeStatus: link.nfeStatus,
          presentInLastPayload: link.presentInLastPayload,
          linkId: link.id,
        })),
        o2cFacts: order.o2cFacts,
        stockDocuments: stockDocsByOrder.get(order.salesOrderId) ?? [],
        itemRefs: itemRefsByOrder.get(order.salesOrderId) ?? [],
        foreignLinks,
        nfeStatusHints,
      })
    );
  }

  return result;
}
