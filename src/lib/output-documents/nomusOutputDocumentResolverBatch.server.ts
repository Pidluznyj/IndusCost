/**
 * FASE 2C — versão BATCH de `loadOutputDocumentsForSalesOrder`.
 *
 * POR QUE EXISTE: o Fluxo de Caixa resolve até 80 pedidos por request e o
 * caminho por pedido custa ~4 consultas de descoberta + ~7 por documento.
 * Em lote isso vira um número FIXO de consultas para o portfólio inteiro.
 *
 * O QUE **NÃO** MUDA: a regra. As mesmas evidências são montadas e a MESMA
 * função pura `resolveOutputDocument` é chamada. O I/O foi reagrupado — os
 * filtros que antes iam no `where` (runId, idNfe, nfeKey) são aplicados em
 * memória sobre o conjunto carregado, com predicado idêntico.
 *
 * DETERMINISMO: a resolução de um documento depende apenas do par
 * (documento, runId) — `resolveOutputDocument` não recebe o pedido. Por isso
 * documentos compartilhados entre pedidos do mesmo run são resolvidos uma vez
 * e reaproveitados.
 *
 * USO DE OrderToCashAuditFact: autorizado e restrito à cadeia que produz
 * `allocatedValue` — exatamente a mesma cadeia do caminho por pedido. Nenhum
 * outro bloco do audit é derivado daqui.
 */

import {
  DOCUMENT_SELECT,
  ITEM_SELECT,
  uniquePositiveInts,
  type OutputDocumentResolverPrismaLike,
} from "@/src/lib/output-documents/nomusOutputDocumentResolver.server.js";
import { NOMUS_STOCK_DOCUMENT_TIPO_SAIDA } from "@/src/lib/output-documents/auditOutputDocumentsDb.js";
import {
  mapStageDocumentHeader,
  mapStageDocumentItem,
  parseReceivableIdsJson,
  resolveOutputDocument,
  type OutputDocumentO2cFactEvidence,
  type OutputDocumentReceivableEvidence,
  type OutputDocumentSalesOrderEvidence,
  type OutputDocumentSalesOrderItemEvidence,
  type OutputDocumentSalesOrderNfeLinkEvidence,
  type ResolvedOutputDocument,
} from "@/src/lib/output-documents/nomusOutputDocumentResolver.js";

export type BatchOutputDocumentOptions = {
  /**
   * runId por pedido — mesma resolução que o audit faz hoje
   * (`facts[0]?.runId ?? findFirst(orderBy createdAt desc)`).
   * Pedido ausente do mapa equivale a `runId: null` (sem filtro de run).
   */
  runIdBySalesOrderId?: ReadonlyMap<string, string | null>;
  onlySaida?: boolean;
};

type StageDocumentRow = {
  id: string;
  externalId: number;
  idNfe: number | null;
  [key: string]: unknown;
};

export async function loadOutputDocumentsForSalesOrdersBatch(
  prisma: OutputDocumentResolverPrismaLike,
  salesOrderIds: string[],
  options: BatchOutputDocumentOptions = {}
): Promise<Map<string, ResolvedOutputDocument[]>> {
  const onlySaida = options.onlySaida !== false;
  const orderIdList = [...new Set(salesOrderIds.filter((id) => Boolean(id)))];
  const result = new Map<string, ResolvedOutputDocument[]>();
  for (const id of orderIdList) result.set(id, []);
  if (orderIdList.length === 0) return result;

  const runIdFor = (salesOrderId: string): string | null =>
    options.runIdBySalesOrderId?.get(salesOrderId)?.trim() || null;

  const tipoFilter = onlySaida
    ? { tipoDocumentoEstoque: NOMUS_STOCK_DOCUMENT_TIPO_SAIDA }
    : {};

  /* -- 1. descoberta: links do pedido → idNfe → documentos do stage ----- */
  const links = await prisma.salesOrderNfeLink.findMany({
    where: { salesOrderId: { in: orderIdList } },
    select: { salesOrderId: true, nfeExternalId: true },
  });
  const nfeIdsByOrder = new Map<string, Set<number>>();
  for (const link of links) {
    if (!Number.isFinite(link.nfeExternalId) || link.nfeExternalId <= 0) continue;
    let set = nfeIdsByOrder.get(link.salesOrderId);
    if (!set) {
      set = new Set<number>();
      nfeIdsByOrder.set(link.salesOrderId, set);
    }
    set.add(link.nfeExternalId);
  }
  const allNfeIds = uniquePositiveInts(
    [...nfeIdsByOrder.values()].flatMap((s) => [...s])
  );

  const stageRows = (
    allNfeIds.length > 0
      ? await prisma.nomusStockDocument.findMany({
          where: { idNfe: { in: allNfeIds }, ...tipoFilter },
          select: DOCUMENT_SELECT,
          orderBy: { externalId: "asc" },
        })
      : []
  ) as unknown as StageDocumentRow[];

  /* -- 2. overlay O2C: documentos citados nos facts do pedido ----------- */
  const o2cOrderRows = await prisma.orderToCashAuditFact.findMany({
    where: { salesOrderId: { in: orderIdList } },
    select: { salesOrderId: true, runId: true, stockDocumentExternalId: true },
  });

  const docsByExternalId = new Map<number, StageDocumentRow>();
  for (const row of stageRows) docsByExternalId.set(row.externalId, row);

  const overlayIdsByOrder = new Map<string, Set<number>>();
  for (const row of o2cOrderRows) {
    if (!row.salesOrderId) continue;
    const wanted = runIdFor(row.salesOrderId);
    if (wanted && row.runId !== wanted) continue;
    const docId = row.stockDocumentExternalId;
    if (typeof docId !== "number" || docId <= 0) continue;
    let set = overlayIdsByOrder.get(row.salesOrderId);
    if (!set) {
      set = new Set<number>();
      overlayIdsByOrder.set(row.salesOrderId, set);
    }
    set.add(docId);
  }

  const missingOverlayIds = uniquePositiveInts(
    [...overlayIdsByOrder.values()]
      .flatMap((s) => [...s])
      .filter((id) => !docsByExternalId.has(id))
  );
  if (missingOverlayIds.length > 0) {
    const extra = (await prisma.nomusStockDocument.findMany({
      where: { externalId: { in: missingOverlayIds }, ...tipoFilter },
      select: DOCUMENT_SELECT,
    })) as unknown as StageDocumentRow[];
    for (const row of extra) docsByExternalId.set(row.externalId, row);
  }

  /* -- 3. quais documentos pertencem a cada pedido ---------------------- */
  const docExternalIdsByOrder = new Map<string, number[]>();
  const usedDocExternalIds = new Set<number>();
  for (const salesOrderId of orderIdList) {
    const nfeIds = nfeIdsByOrder.get(salesOrderId) ?? new Set<number>();
    const chosen = new Set<number>();
    for (const [externalId, doc] of docsByExternalId) {
      if (doc.idNfe != null && nfeIds.has(doc.idNfe)) chosen.add(externalId);
    }
    for (const externalId of overlayIdsByOrder.get(salesOrderId) ?? []) {
      if (docsByExternalId.has(externalId)) chosen.add(externalId);
    }
    const sorted = [...chosen].sort((a, b) => a - b);
    docExternalIdsByOrder.set(salesOrderId, sorted);
    for (const id of sorted) usedDocExternalIds.add(id);
  }

  if (usedDocExternalIds.size === 0) return result;

  const usedDocs = [...usedDocExternalIds]
    .map((id) => docsByExternalId.get(id))
    .filter((d): d is StageDocumentRow => d != null);
  const usedDocDbIds = usedDocs.map((d) => d.id);
  const usedIdNfes = uniquePositiveInts(usedDocs.map((d) => d.idNfe));

  /* -- 4. evidências em lote -------------------------------------------- */
  const [itemRows, nfeRows, o2cDocRows] = await Promise.all([
    prisma.nomusStockDocumentItem.findMany({
      where: { stockDocumentId: { in: usedDocDbIds } },
      select: { ...ITEM_SELECT, stockDocumentId: true },
      orderBy: { createdAt: "asc" },
    }),
    usedIdNfes.length > 0
      ? prisma.nomusNfe.findMany({
          where: { externalId: { in: usedIdNfes } },
          select: {
            id: true,
            externalId: true,
            numero: true,
            chave: true,
            status: true,
          },
        })
      : Promise.resolve([]),
    prisma.orderToCashAuditFact.findMany({
      where: { stockDocumentExternalId: { in: [...usedDocExternalIds] } },
      select: {
        runId: true,
        salesOrderId: true,
        orderCode: true,
        salesOrderItemId: true,
        nfeExternalId: true,
        stockDocumentExternalId: true,
        stockDocumentIdNfe: true,
        stockDocumentItemId: true,
        allocatedValueByDocumentPrice: true,
        quantityUsedForOrder: true,
        receivableIdsJson: true,
      },
    }),
  ]);

  const itemsByDocDbId = new Map<string, typeof itemRows>();
  for (const row of itemRows) {
    const list = itemsByDocDbId.get(row.stockDocumentId);
    if (list) list.push(row);
    else itemsByDocDbId.set(row.stockDocumentId, [row]);
  }
  const nfeByExternalId = new Map(nfeRows.map((r) => [r.externalId, r]));
  const o2cByDocExternalId = new Map<number, typeof o2cDocRows>();
  for (const row of o2cDocRows) {
    const key = row.stockDocumentExternalId;
    if (typeof key !== "number") continue;
    const list = o2cByDocExternalId.get(key);
    if (list) list.push(row);
    else o2cByDocExternalId.set(key, [row]);
  }

  /* -- 5. links e recebíveis das NFs envolvidas ------------------------- */
  const allLinkNfeIds = uniquePositiveInts([
    ...usedIdNfes,
    ...o2cDocRows.map((r) => r.nfeExternalId),
    ...o2cDocRows.map((r) => r.stockDocumentIdNfe),
  ]);
  const allNfeKeys = [
    ...new Set(
      nfeRows.map((r) => r.chave?.trim()).filter((k): k is string => Boolean(k))
    ),
  ];

  const [linkRows, receivableRows] = await Promise.all([
    allLinkNfeIds.length > 0 || allNfeKeys.length > 0
      ? prisma.salesOrderNfeLink.findMany({
          where: {
            OR: [
              ...(allLinkNfeIds.length > 0
                ? [{ nfeExternalId: { in: allLinkNfeIds } }]
                : []),
              ...(allNfeKeys.length > 0 ? [{ nfeKey: { in: allNfeKeys } }] : []),
            ],
          },
          select: {
            id: true,
            salesOrderId: true,
            orderCode: true,
            nfeExternalId: true,
            nfeKey: true,
          },
        })
      : Promise.resolve([]),
    usedIdNfes.length > 0
      ? prisma.nomusAccountsReceivable.findMany({
          where: { sourceInvoiceId: { in: usedIdNfes } },
          select: {
            id: true,
            externalId: true,
            sourceInvoiceId: true,
            amountReceivable: true,
            balanceReceivable: true,
            status: true,
          },
        })
      : Promise.resolve([]),
  ]);

  const receivablesByInvoice = new Map<number, typeof receivableRows>();
  for (const row of receivableRows) {
    if (row.sourceInvoiceId == null) continue;
    const list = receivablesByInvoice.get(row.sourceInvoiceId);
    if (list) list.push(row);
    else receivablesByInvoice.set(row.sourceInvoiceId, [row]);
  }

  /* -- 6. pedidos/itens citados pelas evidências ------------------------ */
  const evidenceOrderIds = [
    ...new Set([
      ...linkRows.map((l) => l.salesOrderId),
      ...o2cDocRows
        .map((f) => f.salesOrderId)
        .filter((id): id is string => Boolean(id)),
    ]),
  ];
  const [salesOrderRows, salesOrderItemRows] = await Promise.all([
    evidenceOrderIds.length > 0
      ? prisma.salesOrder.findMany({
          where: { id: { in: evidenceOrderIds } },
          select: { id: true, orderCode: true, status: true },
        })
      : Promise.resolve([]),
    evidenceOrderIds.length > 0
      ? prisma.salesOrderItem.findMany({
          where: { salesOrderId: { in: evidenceOrderIds } },
          select: {
            id: true,
            salesOrderId: true,
            externalProductId: true,
            nomusItemExternalId: true,
          },
        })
      : Promise.resolve([]),
  ]);
  const salesOrderById = new Map(salesOrderRows.map((r) => [r.id, r]));
  const salesOrderItemsByOrder = new Map<string, typeof salesOrderItemRows>();
  for (const row of salesOrderItemRows) {
    const list = salesOrderItemsByOrder.get(row.salesOrderId);
    if (list) list.push(row);
    else salesOrderItemsByOrder.set(row.salesOrderId, [row]);
  }

  /* -- 7. resolve por (documento, runId), memoizado --------------------- */
  const resolvedCache = new Map<string, ResolvedOutputDocument>();

  function resolveDoc(
    doc: StageDocumentRow,
    runId: string | null
  ): ResolvedOutputDocument {
    const cacheKey = `${doc.externalId}::${runId ?? ""}`;
    const cached = resolvedCache.get(cacheKey);
    if (cached) return cached;

    const idNfe = doc.idNfe;
    const nfeRow = idNfe != null ? nfeByExternalId.get(idNfe) ?? null : null;

    // Mesmo predicado do where original: stockDocumentExternalId (+ runId).
    const o2cRows = (o2cByDocExternalId.get(doc.externalId) ?? []).filter(
      (row) => (runId ? row.runId === runId : true)
    );

    const nfeIds = uniquePositiveInts([
      idNfe,
      ...o2cRows.map((row) => row.nfeExternalId),
      ...o2cRows.map((row) => row.stockDocumentIdNfe),
    ]);
    const nfeKey = nfeRow?.chave?.trim() || null;

    const linksForDoc =
      nfeIds.length > 0 || nfeKey
        ? linkRows.filter(
            (l) =>
              (nfeIds.length > 0 && nfeIds.includes(l.nfeExternalId)) ||
              (nfeKey != null && l.nfeKey === nfeKey)
          )
        : [];

    const receivables =
      idNfe != null ? receivablesByInvoice.get(idNfe) ?? [] : [];

    const linkEvidence: OutputDocumentSalesOrderNfeLinkEvidence[] =
      linksForDoc.map((link) => ({
        linkId: link.id,
        salesOrderId: link.salesOrderId,
        orderCode: link.orderCode,
        nfeExternalId: link.nfeExternalId,
      }));

    const o2cEvidence: OutputDocumentO2cFactEvidence[] = o2cRows.map((row) => ({
      runId: row.runId,
      salesOrderId: row.salesOrderId,
      orderCode: row.orderCode,
      salesOrderItemId: row.salesOrderItemId,
      nfeExternalId: row.nfeExternalId,
      stockDocumentExternalId: row.stockDocumentExternalId,
      stockDocumentIdNfe: row.stockDocumentIdNfe,
      stockDocumentItemId: row.stockDocumentItemId,
      allocatedValueByDocumentPrice:
        row.allocatedValueByDocumentPrice?.toString() ?? null,
      quantityUsedForOrder: row.quantityUsedForOrder?.toString() ?? null,
      receivableIds: parseReceivableIdsJson(row.receivableIdsJson),
    }));

    const involvedOrderIds = [
      ...new Set([
        ...linkEvidence.map((l) => l.salesOrderId),
        ...o2cEvidence
          .map((f) => f.salesOrderId)
          .filter((id): id is string => Boolean(id)),
      ]),
    ];

    const salesOrderEvidence: OutputDocumentSalesOrderEvidence[] =
      involvedOrderIds
        .map((id) => salesOrderById.get(id))
        .filter((row): row is NonNullable<typeof row> => row != null)
        .map((row) => ({
          id: row.id,
          orderCode: row.orderCode,
          status: row.status != null ? String(row.status) : null,
        }));

    const salesOrderItemEvidence: OutputDocumentSalesOrderItemEvidence[] =
      involvedOrderIds
        .flatMap((id) => salesOrderItemsByOrder.get(id) ?? [])
        .map((row) => ({
          id: row.id,
          salesOrderId: row.salesOrderId,
          externalProductId: row.externalProductId,
          nomusItemExternalId: row.nomusItemExternalId,
        }));

    const receivableEvidence: OutputDocumentReceivableEvidence[] =
      receivables.map((row) => ({
        id: row.id,
        externalId: row.externalId,
        sourceInvoiceId: row.sourceInvoiceId,
        amountReceivable: row.amountReceivable?.toString() ?? null,
        balanceReceivable: row.balanceReceivable?.toString() ?? null,
        status: row.status,
      }));

    const resolved = resolveOutputDocument({
      document: mapStageDocumentHeader(doc as never),
      items: (itemsByDocDbId.get(doc.id) ?? []).map((i) =>
        mapStageDocumentItem(i as never)
      ),
      nfe:
        idNfe != null
          ? {
              externalId: idNfe,
              id: nfeRow?.id ?? null,
              numero: nfeRow?.numero ?? null,
              chave: nfeRow?.chave ?? null,
              status: nfeRow?.status ?? null,
              foundLocally: nfeRow != null,
            }
          : null,
      salesOrderNfeLinks: linkEvidence,
      salesOrders: salesOrderEvidence,
      salesOrderItems: salesOrderItemEvidence,
      o2cFacts: o2cEvidence,
      receivables: receivableEvidence,
    });
    resolvedCache.set(cacheKey, resolved);
    return resolved;
  }

  for (const salesOrderId of orderIdList) {
    const runId = runIdFor(salesOrderId);
    const docs = (docExternalIdsByOrder.get(salesOrderId) ?? [])
      .map((externalId) => docsByExternalId.get(externalId))
      .filter((d): d is StageDocumentRow => d != null);
    result.set(
      salesOrderId,
      docs.map((doc) => resolveDoc(doc, runId))
    );
  }

  return result;
}
